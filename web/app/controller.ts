// The controller (client-architecture.md §3.2, §6): it boots the app from a Platform and
// runs the workspace reducer's effects. Everything else has its own owner: the workspace
// reducer owns tabs, `net/hosts.ts` owns sockets and admission, the router owns navigation,
// `app/focus.ts` owns focus, `app/persist.ts` owns persistence, `app/listing.ts` owns the
// listing, `sessions/cache.ts` the rows Home and the picker render. Screens reach each of them
// through `useApp()`.
import { HostRegistry, type HostClient } from "../net/hosts";
import { SessionsCache } from "../sessions/cache";
import type { BootResult, Lifecycle, Platform, UpdateState, Viewport } from "../platform/types";
import { Store } from "../ui/store";
import { reduce, initialWorkspace, savedTabs, shownTab, type WorkspaceEffect, type WorkspaceEvent, type WorkspaceState } from "../workspace/state";
import { FocusController } from "./focus";
import { ListingFetcher } from "./listing";
import { Persist } from "./persist";
import { browserHistory, Router, type HistoryPort, type Navigated } from "./router";

const NOTICE_MS = 5_000;
/** The update check on becoming visible runs at most this often. */
const UPDATE_CHECK_EVERY_MS = 60 * 60_000;

/** What a tab's driver offers the controller: the terminal lane registers one per open tab. */
export interface TabHandle {
  cover(): void;
  uncover(): void;
  /** The tab's driver quotes `path` and types it, with no Enter, once its watch is bound. */
  insertPath(path: string): boolean;
}

export interface AppView {
  viewport: Viewport;
  lifecycle: Lifecycle;
  workspace: WorkspaceState;
  nav: Navigated;
  /** A snapshot of the host registry, replaced on every change. */
  hosts: HostClient[];
  /** One message at a time, for the polite live region. */
  notice: string | null;
  /** Tabs whose connection failed (reconnecting, or refused for the session limit): Insert path is not offered for them. */
  tabsOffline: readonly string[];
  /** The database was closed for a newer build's schema upgrade: later writes stay in memory. */
  storageClosed: boolean;
  update: UpdateState;
}

export interface StartOptions {
  /** Puts a viewport where CSS reads it, before the app renders it: the page passes `applyViewport`, vitest has no document. */
  applyViewport?: (viewport: Viewport) => void;
  /** Fake the daemon's HTTP: the harness passes the test platform's. */
  fetchFn?: typeof fetch;
  /** The harness and tests stand in for `window.history`. */
  history?: HistoryPort;
}

export class AppController extends Store<AppView> {
  readonly hosts: HostRegistry;
  readonly router: Router;
  readonly focus: FocusController;
  readonly persist: Persist;
  readonly listing: ListingFetcher;
  readonly sessions: SessionsCache;
  private readonly drivers = new Map<string, TabHandle>();
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastUpdateCheck = 0;
  private readonly listed = new Set<string>();
  private onHomeOrPicker = false;

  static async start(platform: Platform, options: StartOptions = {}): Promise<AppController> {
    const boot = await platform.boot();
    return new AppController(platform, boot, options);
  }

  private readonly applyViewport: (viewport: Viewport) => void;

  private constructor(readonly platform: Platform, boot: BootResult, options: StartOptions) {
    const router = new Router(options.history ?? browserHistory(), boot.workspace?.files?.place ?? null);
    super({
      viewport: boot.viewport,
      lifecycle: boot.lifecycle,
      workspace: initialWorkspace,
      nav: { destination: router.entry.destination, entry: router.entry },
      hosts: [],
      notice: null,
      tabsOffline: [],
      storageClosed: false,
      update: "none",
    });
    this.router = router;
    this.applyViewport = options.applyViewport ?? (() => undefined);
    this.focus = new FocusController(platform.input, () => this.snapshot.viewport);
    this.hosts = new HostRegistry({
      transport: platform.transport,
      onStuck: () => {
        this.persist.persistNow();
        platform.restart("stuck");
      },
      ...(options.fetchFn && { fetchFn: options.fetchFn }),
    });
    this.persist = new Persist(platform.storage, () => savedTabs(this.snapshot.workspace), boot.workspace);
    this.persist.provideHostName(() => this.hosts.all()[0]?.name ?? null);
    this.listing = new ListingFetcher({
      restoring: () => this.snapshot.workspace.tabs.some((t) => t.restoring),
      visible: () => this.snapshot.lifecycle.visible,
    });
    this.sessions = new SessionsCache(boot.workspace?.expanded);
    this.persist.provideExpanded(() => this.sessions.saved());

    this.applyViewport(boot.viewport);
    this.hosts.subscribe(() => { this.hostsChanged(); });
    this.hosts.setLifecycle(boot.lifecycle);
    // A browser host's name is unknown until `/auth/info` answers; an offline launch names it from the last save.
    const savedName = boot.workspace?.hostName;
    this.hosts.set(boot.hosts.map((h) => (h.name === null && h.pageOrigin !== null && savedName !== undefined ? { ...h, name: savedName } : h)));
    this.dispatch({ type: "restored", saved: boot.workspace });
    this.dispatch({ type: "navigated", onTerminal: router.entry.destination === "terminal" });
    router.subscribe((nav) => { this.navigated(nav); });
    this.listing.subscribe((event) => {
      const client = this.hosts.get(event.handle);
      if (event.type === "listed") this.sessions.listed(event.handle, event.listing, client?.hostId ?? null);
      else if (event.type === "failed") this.sessions.failed(event.handle, event.reason);
      else this.sessions.renamed(event.handle, event.window, event.name);
      if (!client?.hostId) return;
      if (event.type === "listed") this.dispatch({ type: "listing", hostId: client.hostId, listing: event.listing });
      else if (event.type === "renamed") this.dispatch({ type: "renamed", hostId: client.hostId, window: event.window, name: event.name });
    });
    platform.subscribe((event) => { this.platformEvent(event); });
    this.focus.screenChanged(router.entry.destination, router.entry.overlay !== null);
    void this.checkUpdates();
  }

  /** Runs the reducer and its effects. Effects run in the caller's stack, so a focus made inside a tap stays inside the tap. */
  dispatch(event: WorkspaceEvent): void {
    const { state, effects } = reduce(this.snapshot.workspace, event);
    if (state !== this.snapshot.workspace) this.update({ workspace: state });
    for (const effect of effects) this.run(effect);
    this.syncListing();
  }

  /** The terminal lane registers each tab's driver; it follows the workspace's choice of the tab on screen. Returns the way to detach. */
  attachDriver(id: string, handle: TabHandle): () => void {
    this.drivers.set(id, handle);
    if (shownTab(this.snapshot.workspace) === id) handle.uncover();
    else handle.cover();
    return () => {
      if (this.drivers.get(id) === handle) this.drivers.delete(id);
    };
  }

  /** Hands `path` to the driver registered for tab `id`. False when none is registered. */
  insertPath(id: string, path: string): boolean {
    const handle = this.drivers.get(id);
    handle?.insertPath(path);
    return handle !== undefined;
  }

  /** The terminal lane reports each tab whose connection failed, and clears it when the tab recovers or closes. */
  setTabOffline(id: string, offline: boolean): void {
    const { tabsOffline } = this.snapshot;
    if (tabsOffline.includes(id) === offline) return;
    this.update({ tabsOffline: offline ? [...tabsOffline, id] : tabsOffline.filter((t) => t !== id) });
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

  /** "Update": persist now, then the waiting worker takes over and this page reloads. */
  applyUpdate(): void {
    this.persist.persistNow();
    this.platform.updates?.apply();
  }

  private run(effect: WorkspaceEffect): void {
    switch (effect.type) {
      case "cover":
        this.drivers.get(effect.id)?.cover();
        break;
      case "uncover":
        this.drivers.get(effect.id)?.uncover();
        break;
      case "save":
        this.persist.save();
        break;
      case "notice":
        this.notify(effect.text);
        break;
      case "navigate":
        // The router emits `navigated` at once, so the reducer sees the destination before the focus effects below.
        this.router.go(effect.to);
        break;
      case "focus":
        // The element may be on a screen this change is about to render (the terminal is hidden
        // until then, Home's search not mounted): focus after the render the change queued.
        // Desktop only: a touch screen never focuses programmatically outside the tap that asked.
        queueMicrotask(() => { this.focus.focusTarget(effect.target); });
        break;
    }
  }

  private navigated(nav: Navigated): void {
    this.update({ nav });
    this.focus.screenChanged(nav.destination, nav.entry.overlay !== null);
    this.dispatch({ type: "navigated", onTerminal: nav.destination === "terminal" });
  }

  private hostsChanged(): void {
    const hosts = this.hosts.all();
    this.update({ hosts });
    for (const client of hosts) {
      if (!this.listed.has(client.entry.handle)) {
        this.listed.add(client.entry.handle);
        this.listing.add(client.entry.handle, client.socket);
      }
    }
    for (const handle of [...this.listed]) {
      if (hosts.some((h) => h.entry.handle === handle)) continue;
      this.listed.delete(handle);
      this.listing.remove(handle);
    }
    const ids = hosts.flatMap((h) => (h.hostId === null ? [] : [h.hostId]));
    this.dispatch({ type: "hostsKnown", ids, complete: hosts.length > 0 && ids.length === hosts.length });
  }

  /** A host stays joined while Home or the picker is on screen, a tab on it exists, or one is restoring. This is the one place that asks for a listing on entering Home or the picker. */
  private syncListing(): void {
    const { nav, workspace } = this.snapshot;
    const homeOrPicker = nav.destination === "home" || nav.entry.overlay?.screen === "picker";
    const entered = homeOrPicker && !this.onHomeOrPicker;
    this.onHomeOrPicker = homeOrPicker;
    for (const client of this.hosts.all()) {
      const { handle } = client.entry;
      const admitted = client.admission.kind === "admitted";
      const hasTab = client.hostId !== null && workspace.tabs.some((t) => t.key.host === client.hostId);
      const listed = this.listing.setWanted(handle, admitted && (homeOrPicker || hasTab));
      // Entering Home or the picker lists afresh, unless joining the host just started a listing.
      if (entered && admitted && !listed) this.listing.refresh(handle);
    }
  }

  private platformEvent(event: Parameters<Parameters<Platform["subscribe"]>[0]>[0]): void {
    switch (event.type) {
      case "hosts":
        this.hosts.set(event.hosts);
        break;
      case "viewport":
        this.applyViewport(event.viewport);
        this.update({ viewport: event.viewport });
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
      case "input":
      case "composeEdit":
      case "composeInsert":
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
