// The controller (client-architecture.md §3.2, §6): it boots the app from a Platform and
// runs the workspace reducer's effects. Everything else has its own owner: the workspace
// reducer owns tabs, `net/hosts.ts` owns sockets and admission, the router owns navigation,
// `app/focus.ts` owns focus, `app/persist.ts` owns persistence, `app/listing.ts` owns the
// listing, `sessions/cache.ts` the rows Home and the sessions overlay render. Screens reach each of them
// through `useApp()`.
import { HostRegistry, type HostClient } from "../net/hosts";
import { BellMarks } from "../sessions/bells";
import { SessionsCache } from "../sessions/cache";
import { samePlace, type BootResult, type FilesPlace, type Lifecycle, type Platform, type Preferences, type UpdateState, type Viewport } from "../platform/types";
import { Store } from "../ui/store";
import { parseSavedWorkspace } from "../workspace/saved";
import { activeTab, initialWorkspace, reduce, savedTabs, screenOf, shownTab, type Route, type Screen, type WorkspaceEffect, type WorkspaceEvent, type WorkspaceState } from "../workspace/state";
import { FocusController } from "./focus";
import { ListingFetcher } from "./listing";
import { Persist } from "./persist";
import { browserHistory, enrolCodeFromHash, Router, type Entry, type HistoryPort, type Overlay } from "./router";
import { lineDraftsOf } from "../screens/terminal/dock/lineDrafts";
import { startNativeLine } from "../screens/terminal/dock/nativeLine";

const NOTICE_MS = 5_000;
/** The update check on becoming visible runs at most this often. */
const UPDATE_CHECK_EVERY_MS = 60 * 60_000;
export interface AppView {
  viewport: Viewport;
  preferences: Preferences;
  lifecycle: Lifecycle;
  workspace: WorkspaceState;
  /** The history entry on screen. */
  entry: Entry;
  /** A snapshot of the host registry, replaced on every change. */
  hosts: HostClient[];
  /** One message at a time, for the polite live region. */
  notice: string | null;
  /** The origin to hand to the tether app; null when no offer is showing. The handoff adds the setup link's code while this page still holds it. Held in memory. */
  appOffer: string | null;
  /** The database was closed for a newer build's schema upgrade: later writes stay in memory. */
  storageClosed: boolean;
  update: UpdateState;
}

export interface StartOptions {
  /** Puts a viewport where CSS reads it, before the app renders it: the page passes `applyViewport`, vitest has no document. */
  applyViewport?: (viewport: Viewport) => void;
  /** Puts the preferences where CSS reads them (the text size), likewise. */
  applyPreferences?: (preferences: Preferences) => void;
  /** Fake the daemon's HTTP: the harness passes the test platform's. */
  fetchFn?: typeof fetch;
  /** The harness and tests stand in for `window.history`. */
  history?: HistoryPort;
}

/** The listing surface on screen: Home, or one sessions overlay (the picker, the sheet). */
interface ListingSurface {
  kind: "home" | "sessions";
  name: string;
}

export class AppController extends Store<AppView> {
  readonly hosts: HostRegistry;
  readonly router: Router;
  readonly focus: FocusController;
  readonly persist: Persist;
  readonly listing: ListingFetcher;
  readonly sessions: SessionsCache;
  readonly bells: BellMarks;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastUpdateCheck = 0;
  /** The listing surface on screen when the last listing was asked for; null when none is. */
  private listingSurface: ListingSurface | null = null;
  /** The active tab native was last told: undefined until the first dispatch. */
  private sentActive: string | null | undefined;
  /** The screen and overlay state the focus controller was last told. */
  private sentScreen: { screen: Screen; overlay: boolean } | null = null;
  static async start(platform: Platform, options: StartOptions = {}): Promise<AppController> {
    const boot = await platform.boot();
    const app = new AppController(platform, boot, options);
    startNativeLine(app, lineDraftsOf(app), boot.lineSnapshot);
    app.startPlatformEvents();
    return app;
  }

  private readonly applyViewport: (viewport: Viewport) => void;
  private readonly applyPreferences: (preferences: Preferences) => void;

  /** A setup link's unspent enrolment code: kept for the life of the page and dropped only when this page's own enrolment spends it. The enrolment screen prefills with it and waits for a tap. Read-only outside `enrolled`. */
  enrolCode: string | null;
  /** A setup link has not been handed to the app yet: it is fired at the app as soon as the page knows its origin. */
  private linkHandoffPending: boolean;
  /** The banner offer for an already-enrolled device with a link code is made once, so a dismissal stays dismissed. */
  private linkOfferPending: boolean;

  private constructor(readonly platform: Platform, boot: BootResult, options: StartOptions) {
    const history = options.history ?? browserHistory();
    // Read before the Router: it replaces the link's `#code=…` with the entry hash, so a reload or Back cannot replay the code.
    const enrolCode = enrolCodeFromHash(history.current().hash);
    const saved = parseSavedWorkspace(boot.workspace);
    const router = new Router(history, () => this.snapshot.workspace.active);
    super({
      viewport: boot.viewport,
      preferences: boot.preferences,
      lifecycle: boot.lifecycle,
      workspace: initialWorkspace,
      entry: router.entry,
      hosts: [],
      notice: null,
      appOffer: null,
      storageClosed: false,
      update: "none",
    });
    this.router = router;
    this.enrolCode = enrolCode;
    this.linkHandoffPending = enrolCode !== null;
    this.linkOfferPending = enrolCode !== null;
    this.applyViewport = options.applyViewport ?? (() => undefined);
    this.applyPreferences = options.applyPreferences ?? (() => undefined);
    const initialOwner = boot.viewport.directInput === "native" && (boot.focusMode === "line" || boot.focusMode === "terminal")
      ? boot.focusMode
      : "none";
    this.focus = new FocusController(platform.input, () => this.snapshot.viewport, initialOwner, boot.focusMode);
    this.hosts = new HostRegistry({
      transport: platform.transport,
      onStuck: () => {
        this.persist.persistNow();
        platform.restart("stuck");
      },
      ...(options.fetchFn && { fetchFn: options.fetchFn }),
    });
    this.persist = new Persist(platform.storage, () => savedTabs(this.snapshot.workspace), () => this.bells.toSave(this.hosts.all().map((h) => h.hostId)));
    this.persist.provideHostName(() => this.hosts.all()[0]?.name ?? null);
    this.listing = new ListingFetcher({
      restoring: () => this.snapshot.workspace.tabs.some((t) => t.kind === "terminal" && t.restoring),
      visible: () => this.snapshot.lifecycle.visible,
    });
    this.sessions = new SessionsCache();
    // The tab on screen on a visible page counts as seen: a hidden page, a backgrounded app and Home show nothing.
    this.bells = new BellMarks(saved?.bellSeen ?? {}, () => (this.snapshot.lifecycle.visible ? shownTab(this.snapshot.workspace) : null));
    this.persist.onClear(() => { this.bells.forget(); });

    this.applyViewport(boot.viewport);
    this.applyPreferences(boot.preferences);
    this.hosts.subscribe(() => { this.hostsChanged(); });
    this.hosts.setLifecycle(boot.lifecycle);
    // A browser host's name is unknown until `/auth/info` answers; an offline launch names it from the last save.
    const savedName = saved?.hostName;
    this.hosts.set(boot.hosts.map((h) => (h.name === null && h.pageOrigin !== null && savedName !== undefined ? { ...h, name: savedName } : h)));
    this.dispatch({ type: "restored", saved });
    this.dispatch({ type: "navigated", entry: router.entry });
    router.subscribe((entry) => { this.navigated(entry); });
    this.listing.subscribe((event) => {
      const client = this.hosts.get(event.handle);
      const hostId = client?.hostId;
      if (event.type === "requested") this.sessions.requested(event.handle);
      else if (event.type === "listed") this.sessions.listed(event.handle, event.listing);
      else if (event.type === "failed") this.sessions.failed(event.handle, event.reason);
      if (!hostId) return;
      if (event.type === "listed") {
        this.bells.listed(hostId, event.listing);
        this.dispatch({ type: "listing", hostId, listing: event.listing });
      } else if (event.type === "bell") this.bells.changed(hostId, event.bell);
      else if (event.type === "failed" && event.reason === "tmux") this.bells.unreadable(hostId);
    });
    this.subscribe(() => { this.bells.shownChanged(); });
    void this.checkUpdates();
  }

  /** Runs the reducer and its effects. Effects run in the caller's stack, so a focus made inside a tap stays inside the tap. */
  dispatch(event: WorkspaceEvent): void {
    const { state, effects } = reduce(this.snapshot.workspace, event);
    if (state !== this.snapshot.workspace) this.update({ workspace: state });
    // On a tab route the current entry names the active tab, so a switch rewrites it (a replace: no history is added).
    const tab = activeTab(state);
    const { entry } = this.router;
    if (state.route === "tab" && tab && entry.route === "tab" && entry.tab !== tab.id) this.router.switchTab(tab.id, tab.kind === "files" ? tab.place : null);
    if (state.active !== this.sentActive) {
      this.sentActive = state.active;
      this.platform.input.setActiveTab(tab?.kind === "terminal" ? tab.key : null);
    }
    this.syncScreen();
    for (const effect of effects) this.run(effect);
    this.syncListing();
  }

  /** Opens an overlay from `opener`, the control that asked: closing the dialog returns focus to it. */
  openOverlay(overlay: Overlay, opener?: Element): void {
    this.focus.noteOpener(opener ?? null);
    this.router.openOverlay(overlay);
  }

  /** Looks at a host again: admission when it is unreachable, a fresh listing otherwise. The one Retry. */
  retryHost(handle: string): void {
    if (this.hosts.get(handle)?.admission.kind === "unreachable") this.hosts.recheck(handle);
    else this.listing.refresh(handle);
  }

  /** A new Files tab on `hostId`, at `place` (every time: the tab is the place). */
  openFiles(hostId: string, place: FilesPlace): void {
    this.dispatch({ type: "filesOpened", id: `files-${crypto.randomUUID()}`, host: hostId, place });
    // Desktop focus lands on the new tab's pill, once it has rendered; touch never focuses outside a tap.
    queueMicrotask(() => { this.focus.focusTarget("tabs"); });
  }

  /** Drills into `to` in the active Files tab: a new history entry, which writes the tab's place once it lands. */
  openPlace(to: FilesPlace): void {
    const tab = activeTab(this.snapshot.workspace);
    if (tab?.kind === "files") this.router.pushPlace(tab.id, to);
  }

  /** The active Files tab's in-app back: to `place`, the enclosing one. */
  toPlace(place: FilesPlace): void {
    const tab = activeTab(this.snapshot.workspace);
    if (tab?.kind === "files") this.router.toPlace(tab.id, place);
  }

  /** The daemon answered for a place the active Files tab asked for with the canonical `to`: the tab follows it, if it is still there. */
  resolvedPlace(from: FilesPlace, to: FilesPlace): void {
    const tab = activeTab(this.snapshot.workspace);
    if (tab?.kind === "files" && samePlace(tab.place, from)) this.router.replacePlace(tab.id, to);
  }

  /** A message for the polite live region, replaced by the next. */
  notify(text: string): void {
    clearTimeout(this.noticeTimer);
    this.update({ notice: text });
    this.noticeTimer = setTimeout(() => { this.update({ notice: null }); }, NOTICE_MS);
  }

  dismissNotice(): void {
    clearTimeout(this.noticeTimer);
    this.update({ notice: null });
  }

  /** Native line delivery must have its app-started owner before other subscribers drain startup events. */
  private startPlatformEvents(): void {
    this.platform.subscribe((event) => { this.platformEvent(event); });
  }

  /** This page's enrolment just spent the link's code: the app mints from the node enrolment, so the handoff carries no code. */
  enrolled(origin: string | null): void {
    this.enrolCode = null;
    this.offerApp(origin);
  }

  private offerApp(origin: string | null): void {
    this.linkOfferPending = false;
    if (this.platform.openInApp && origin) this.update({ appOffer: origin });
  }

  dismissAppOffer(): void {
    this.update({ appOffer: null });
  }

  /** "Update": persist now, then the waiting worker takes over and this page reloads. */
  applyUpdate(): void {
    this.persist.persistNow();
    this.platform.updates?.apply();
  }

  private run(effect: WorkspaceEffect): void {
    switch (effect.type) {
      case "save":
        this.persist.save();
        break;
      case "notice":
        this.notify(effect.text);
        break;
      case "navigate":
        // The router emits `navigated` at once, so the reducer sees the route before the focus effects below.
        this.navigate(effect.to);
        break;
      case "focus":
        // The element may be on a screen this change is about to render (the terminal is hidden
        // until then, Home's search not mounted): focus after the render the change queued.
        // Desktop only: a touch screen never focuses programmatically outside the tap that asked.
        queueMicrotask(() => { this.focus.focusTarget(effect.target); });
        break;
    }
  }

  private navigate(to: Route): void {
    const tab = activeTab(this.snapshot.workspace);
    if (to === "home" || !tab) this.router.goHome();
    else this.router.openTab(tab.id, tab.kind === "files" ? tab.place : null);
  }

  private navigated(entry: Entry): void {
    this.update({ entry });
    this.dispatch({ type: "navigated", entry });
  }

  /** Focus follows the screen on screen, which changes with a route, an overlay, or a switch between tabs of different kinds. */
  private syncScreen(): void {
    const screen = screenOf(this.snapshot.workspace);
    const overlay = this.snapshot.entry.overlay !== null;
    if (this.sentScreen?.screen === screen && this.sentScreen.overlay === overlay) return;
    this.sentScreen = { screen, overlay };
    this.focus.screenChanged(screen, overlay);
  }

  private hostsChanged(): void {
    const hosts = this.hosts.all();
    this.update({ hosts });
    const own = hosts.find((h) => h.entry.pageOrigin !== null);
    // A setup link on a phone that has the app belongs to the app: fire the scheme as soon as the
    // page knows the host's origin, and leave the page usable when nothing handles it. The browser
    // never spends the code — the app redeems it, so the phone is set up once, in the app.
    if (this.linkHandoffPending && own?.entry.pageOrigin) {
      this.linkHandoffPending = false;
      this.platform.openInApp?.(own.entry.pageOrigin, this.enrolCode);
    }
    // A device already enrolled when the link opened never spent its code: hand it to the app.
    // Nothing here enrols by itself, so holding the code past this point is safe.
    if (this.linkOfferPending && own?.admission.kind === "admitted") this.offerApp(own.entry.pageOrigin);
    this.listing.setHosts(hosts.map((h) => ({ handle: h.entry.handle, host: h.socket })));
    const ids = hosts.flatMap((h) => (h.hostId === null ? [] : [h.hostId]));
    this.dispatch({ type: "hostsKnown", ids, complete: hosts.length > 0 && ids.length === hosts.length });
  }

  /** A host stays joined while Home or the sessions overlay is on screen, a tab on it exists, or one is restoring. This is the one place that asks for a listing on entering one of them. */
  private syncListing(): void {
    const { entry, workspace } = this.snapshot;
    const home = screenOf(workspace) === "home";
    const { overlay } = entry;
    const sessionsOverlay = overlay?.screen === "sessions" ? overlay : null;
    const listingShown = home || sessionsOverlay !== null;
    // Each surface asks afresh when it is entered, for every host it shows: the picker, the sheet and
    // Home all list every listable server. Returning from an overlay to the screen under it is not entering.
    const surface: ListingSurface | null = sessionsOverlay ? { kind: "sessions", name: sessionsOverlay.name } : home ? { kind: "home", name: "" } : null;
    const before = this.listingSurface;
    const returning = surface?.kind === "home" && before?.kind === "sessions";
    const same = surface?.kind === before?.kind && surface?.name === before?.name;
    const entered = surface !== null && !same && !returning;
    this.listingSurface = surface;
    for (const client of this.hosts.all()) {
      const { handle } = client.entry;
      const admitted = client.admission.kind === "admitted";
      const hasTab = client.hostId !== null && workspace.tabs.some((t) => t.host === client.hostId);
      const listed = this.listing.setWanted(handle, admitted && (listingShown || hasTab));
      // Entering a listing surface lists afresh, unless joining the host just started a listing.
      if (entered && admitted && !listed) this.listing.refresh(handle);
    }
  }

  private platformEvent(event: Parameters<Parameters<Platform["subscribe"]>[0]>[0]): void {
    switch (event.type) {
      case "hosts":
        this.hosts.set(event.hosts);
        break;
      case "viewport":
        this.focus.viewportChanged(this.snapshot.viewport, event.viewport);
        this.applyViewport(event.viewport);
        this.update({ viewport: event.viewport });
        break;
      case "preferences":
        this.applyPreferences(event.preferences);
        this.update({ preferences: event.preferences });
        break;
      case "lifecycle":
        if (!event.lifecycle.visible) this.persist.persistNow();
        this.update({ lifecycle: event.lifecycle });
        this.hosts.setLifecycle(event.lifecycle);
        if (event.lifecycle.visible) void this.checkUpdates();
        break;
      case "storage":
        if (event.state === "closing") this.persist.persistNow();
        else this.update({ storageClosed: true });
        break;
      case "update":
        this.update({ update: event.state });
        break;
      case "lineEdit":
      case "lineReturn":
        break; // The app-started native line owner subscribes directly to the platform.
      case "input":
      case "draftChanged":
        break; // owned by the terminal and draft lanes, which subscribe on the platform themselves
    }
  }

  private async checkUpdates(): Promise<void> {
    const updates = this.platform.updates;
    if (!updates || Date.now() - this.lastUpdateCheck < UPDATE_CHECK_EVERY_MS) return;
    this.lastUpdateCheck = Date.now();
    await updates.check().catch(() => undefined);
  }
}
