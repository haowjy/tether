import { Native, type Boot, type HostEntry, type NativeMsg, type SavedTab, type Viewport } from "../native/bridge";
import type { Chip, TmuxListing, WindowRef } from "../proto/generated/messages";
import { TabDriver } from "../tabs/driver";
import { initialState, type ConnectionState, type Halt } from "../tabs/connection";
import type { PromptLine, TerminalRenderer } from "../term";
import { TerminalSizer } from "../term/size";
import { FileBrowser } from "../files/browser";
import { httpFsApi } from "../files/api";
import { httpComplete, Suggester } from "../complete/suggest";
import { HostRegistry, httpOrigin } from "./hosts";
import { AskError, create, listWindows, type CreateTarget } from "./listing";
import { HostSync, listed } from "./sync";

/** How long a pill whose window went away stays, greyed, before it goes (plan.md "Layout"). */
const GONE_LINGER_MS = 1_500;
const NOTICE_MS = 5_000;

let counter = 0;
const newId = (): string => `${Date.now().toString(36)}-${String(counter++)}`;

export interface TabView extends SavedTab {
  state: ConnectionState;
  /** When the tab stopped being live, or opened, in ms since the epoch; null while live. */
  downSince: number | null;
  /** When the next automatic retry fires, null if none is due. */
  retryAt: number | null;
  /** The active pane's directory, from `watching`; null until tmux reports it. */
  cwd: string | null;
  driver: TabDriver;
}

/** A host's tmux windows as the sheets show them, or why there are none. */
export type Listing =
  | { kind: "loading" }
  | { kind: "list"; listing: TmuxListing }
  | { kind: "noServer" }
  | { kind: "halted"; halt: Halt }
  | { kind: "error"; message: string };

/** The new-window or new-session form. `null` name or dir lets tmux choose. */
export interface Draft {
  target: CreateTarget;
  /** The session's name, for a new window. */
  sessionName: string | null;
  name: string | null;
  dir: string | null;
  busy: boolean;
  error: string | null;
}

export type Sheet =
  | { kind: "home" }
  | { kind: "attach" }
  | { kind: "create"; draft: Draft }
  | { kind: "files"; host: HostEntry; browser: FileBrowser };

export interface AppView {
  tabs: readonly TabView[];
  active: string | null;
  /** The host the sheets are about: the active tab's, else the first. */
  host: HostEntry | null;
  sheet: Sheet | null;
  listing: Listing | null;
  notice: string | null;
  keyboard: boolean;
  locked: boolean;
  /** The terminal shows older lines than the newest: offer the jump to the bottom. */
  scrolledUp: boolean;
  /** The suggestion strip's chips; null hides it. */
  chips: readonly Chip[] | null;
}

export interface AppOptions {
  native: Native;
  boot: Boot;
  renderer: TerminalRenderer;
  kind: "ios" | "web";
  /** Height of the tab bar and suggestion strip over the web view's bottom. */
  chromeHeight(): number;
  /** The least gap between the terminal's text and each side of the screen. */
  edge(): number;
}

/**
 * The web UI's state: the open tabs and which is on screen, wired to native's messages.
 * Only the active tab watches; the others keep their place on the host's socket so a
 * closed window still closes its tab.
 */
export class App {
  private readonly native: Native;
  private readonly renderer: TerminalRenderer;
  private readonly hosts: HostRegistry;
  private readonly sizer: TerminalSizer;
  private readonly listeners = new Set<() => void>();
  private readonly syncs = new Map<string, HostSync>();
  private view: AppView;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  /** The file manager's hidden-files toggle, kept for the next time it opens. */
  private hiddenFiles = false;
  private readonly suggester = new Suggester((chips) => { this.update({ chips }); });
  /** The command line on screen, from the renderer. */
  private promptLine: PromptLine | null = null;

  constructor(opts: AppOptions) {
    this.native = opts.native;
    this.renderer = opts.renderer;
    this.hosts = new HostRegistry(opts.native, opts.kind, () => { opts.native.recreateWebView(); }, opts.boot.locked);
    this.sizer = new TerminalSizer({
      cell: () => opts.renderer.cellSize(),
      chromeHeight: () => opts.chromeHeight(),
      edge: () => opts.edge(),
      onChange: (size) => { this.activeTab()?.driver.resize(size); },
    });
    this.view = {
      tabs: [], active: null, host: null, sheet: null, listing: null, notice: null,
      keyboard: opts.boot.viewport.keyboard, locked: opts.boot.locked, scrolledUp: false, chips: null,
    };
    this.setViewport(opts.boot.viewport);
    this.hosts.set(opts.boot.hosts);
    opts.renderer.onScrolledUp((scrolledUp) => { this.update({ scrolledUp }); });
    opts.renderer.onPromptLine((line) => {
      this.promptLine = line;
      this.suggest();
    });
    // Tabs saved for a host native no longer lists can't open; the one last on screen
    // shows again if it can, else the first.
    const restorable = opts.boot.tabs.filter((t) => this.hosts.get(t.host));
    const shown = restorable.find((t) => t.id === opts.boot.active) ?? restorable[0];
    for (const saved of restorable) this.open(saved, saved === shown);
    this.view.host = this.sheetHost();
    // The cell can be measured only once xterm has painted.
    requestAnimationFrame(() => { this.sizer.remeasure(); });
  }

  get snapshot(): AppView {
    return this.view;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** `window.__tether.activeTab()`: the tab on screen, for native's upload targeting. */
  activeTab(): TabView | undefined {
    return this.view.tabs.find((t) => t.id === this.view.active);
  }

  receive(msg: NativeMsg): void {
    switch (msg.type) {
      case "input":
        this.activeTab()?.driver.input(msg.events);
        break;
      case "viewport":
        this.setViewport(msg);
        break;
      case "lifecycle":
        this.hosts.setActive(msg.phase === "active");
        break;
      case "network":
        if (msg.reachable) this.hosts.nudge();
        break;
      case "lock":
        this.hosts.setLocked(msg.locked);
        this.update({ locked: msg.locked });
        break;
      case "hosts":
        this.hosts.set(msg.hosts);
        this.update({ host: this.sheetHost() });
        break;
      case "upload":
        if (!msg.path) break;
        this.view.tabs.find((t) => t.id === msg.tab && t.host === msg.host)?.driver.insertPath(msg.path);
        if (this.view.sheet?.kind === "files" && this.view.sheet.host.id === msg.host) void this.view.sheet.browser.uploaded(msg.path);
        break;
    }
  }

  /** The label native gave a host, for the UI's copy. */
  hostName(id: string): string {
    return this.hosts.entries().find((h) => h.id === id)?.name ?? id;
  }

  /** A pill tap: switch to the tab, and retry now if it is waiting to reconnect. */
  activate(id: string): void {
    const next = this.view.tabs.find((t) => t.id === id);
    if (!next || next.state.kind === "closed") return;
    if (next.id !== this.view.active) {
      this.activeTab()?.driver.cover();
      next.driver.uncover();
      this.native.haptic("selection");
      this.update({ active: id, sheet: null, host: this.sheetHost(next.host) });
      this.lineGone();
      this.save();
    }
    if (next.state.kind === "reconnecting") next.driver.nudge();
  }

  close(id: string): void {
    this.view.tabs.find((t) => t.id === id)?.driver.close();
  }

  /** `[⌨]`: native owns the keyboard; this only asks. Its key row hides it again. */
  showKeyboard(): void {
    this.native.focus("terminal");
  }

  /** A chip tap types its text, as a key would (ios-shell.md "How input reaches the terminal"). */
  typeChip(chip: Chip): void {
    if (!this.activeTab()?.driver.input([{ text: chip.insert }])) return;
    this.native.haptic("selection");
    this.suggester.tapped(chip);
  }

  scrollToBottom(): void {
    this.renderer.scrollToBottom();
  }

  dismissNotice(): void {
    clearTimeout(this.noticeTimer);
    this.update({ notice: null });
  }

  /** Opens `window` as a new tab and shows it; an open one is switched to. */
  add(host: string, window: WindowRef, name: string): void {
    const open = this.view.tabs.find((t) => t.host === host && sameWindow(t.window, window) && t.state.kind !== "closed");
    this.update({ sheet: null });
    if (open) {
      this.activate(open.id);
      return;
    }
    this.activeTab()?.driver.cover();
    this.open({ id: newId(), host, window, name }, true);
    this.lineGone();
    this.save();
  }

  /** `[<]` home or the `[+]` sheet; both list the host's windows. */
  openSheet(kind: "home" | "attach"): void {
    const host = this.sheetHost();
    this.update({ sheet: { kind }, host });
    void this.refresh();
  }

  /**
   * `[⊞]` or Home's Files row: the file manager for the sheet's host, at the tab's cwd when
   * a root holds it. The keyboard stays as it is (plan.md "File manager").
   */
  openFiles(): void {
    const host = this.sheetHost();
    if (!host) return;
    const browser = new FileBrowser({ api: httpFsApi(httpOrigin(host)), hidden: this.hiddenFiles, onHidden: (hidden) => { this.hiddenFiles = hidden; } });
    const tab = this.activeTab();
    this.update({ sheet: { kind: "files", host, browser }, host });
    void browser.start(tab?.host === host.id ? tab.cwd : null);
  }

  /** The file manager's upload button: native picks a photo and uploads it for the tab on screen. */
  uploadMedia(): void {
    this.native.pickMedia();
  }

  /** Video and audio go to native's player (ios-shell.md "Web content security"). */
  playMedia(host: string, path: string): void {
    this.native.playVideo(host, path);
  }

  /** A link out of the app, from a rendered Markdown file. */
  openExternal(url: string): void {
    this.native.openURL(url);
  }

  closeSheet(): void {
    this.update({ sheet: null });
  }

  /** Lists the sheet's host again. */
  async refresh(): Promise<void> {
    const entry = this.view.host;
    const host = entry ? this.hosts.get(entry.id) : undefined;
    if (!entry || !host) {
      this.update({ listing: { kind: "error", message: "No host yet. Add one in the app's Hosts screen." } });
      return;
    }
    if (!entry.enrolled) {
      this.update({ listing: { kind: "halted", halt: "unauthorized" } });
      return;
    }
    if (this.view.listing?.kind !== "list") this.update({ listing: { kind: "loading" } });
    let next: Listing;
    try {
      const listing = await listWindows(host);
      this.prune(entry.id, listing);
      next = listing ? { kind: "list", listing } : { kind: "noServer" };
    } catch (error) {
      next = listingError(error, entry.name);
    }
    if (this.view.sheet && this.view.host?.id === entry.id) this.update({ listing: next });
  }

  /** The new-window (in `session`) or new-session form. */
  startCreate(target: CreateTarget, sessionName: string | null): void {
    this.update({ sheet: { kind: "create", draft: { target, sessionName, name: null, dir: null, busy: false, error: null } } });
  }

  /** Back from the form to the list. */
  cancelCreate(): void {
    this.update({ sheet: { kind: "attach" } });
  }

  /** Asks native for the name: the web has no text fields (plan.md "Standards"). */
  async promptName(): Promise<void> {
    const draft = this.draft();
    if (!draft) return;
    const what = draft.target.kind === "window" ? "window" : "session";
    const typed = await this.native.prompt(`Name the ${what}`, "Leave empty to let tmux choose.", draft.name ?? "");
    if (typed === null) return;
    this.patchDraft({ name: typed.trim() || null });
  }

  /** A start directory, or null for tmux's default. */
  chooseDir(dir: string | null): void {
    this.patchDraft({ dir });
  }

  /** A start directory typed into a native prompt. */
  async askDir(): Promise<void> {
    const draft = this.draft();
    if (!draft) return;
    const typed = await this.native.prompt("Start directory", "An absolute path on the server.", draft.dir ?? this.activeTab()?.cwd ?? "");
    if (typed === null) return;
    this.patchDraft({ dir: typed.trim() || null });
  }

  async submitCreate(): Promise<void> {
    const draft = this.draft();
    const entry = this.view.host;
    const host = entry ? this.hosts.get(entry.id) : undefined;
    if (!draft || draft.busy || !entry || !host) return;
    this.patchDraft({ busy: true, error: null });
    try {
      const window = await create(host, draft.target, draft.name, draft.dir);
      // `created` carries no names: a listing has them.
      const listing = await listWindows(host).catch(() => null);
      this.add(entry.id, window, titleOf(listing, window) ?? `${draft.sessionName ?? draft.name ?? "tmux"}:${draft.name ?? String(window.window)}`);
    } catch (error) {
      const message = error instanceof AskError && error.reason === "noServer" ? "tmux isn't running on the server." : String(error instanceof Error ? error.message : error);
      this.patchDraft({ busy: false, error: message });
    }
  }

  private open(saved: SavedTab, active: boolean): void {
    const host = this.hosts.get(saved.host);
    if (!host) return;
    if (!this.syncs.has(saved.host)) {
      this.syncs.set(saved.host, new HostSync({
        host,
        onListing: (listing) => {
          this.prune(saved.host, listing);
          // Keeps an open sheet current: `sessionsChanged` relists the host.
          if (this.view.sheet && this.view.host?.id === saved.host) this.update({ listing: listing ? { kind: "list", listing } : { kind: "noServer" } });
        },
        onRenamed: (window, name) => { this.rename(saved.host, window, name); },
      }));
    }
    const tab = { ...saved, state: initialState, downSince: Date.now(), retryAt: null, cwd: null } as TabView;
    tab.driver = new TabDriver({
      window: saved.window,
      renderer: this.renderer,
      host,
      size: () => this.sizer.size,
      covered: !active,
      onState: (state) => {
        const now = Date.now();
        tab.state = state;
        tab.downSince = state.kind === "live" ? null : (tab.downSince ?? now);
        tab.retryAt = state.kind === "reconnecting" && state.retryInMs !== null ? now + state.retryInMs : null;
        if (state.kind === "closed") {
          // A window that went away shows ✕ for a moment; a tab Jimmy closed just goes.
          if (state.reason === "user") queueMicrotask(() => { this.remove(tab.id); });
          else setTimeout(() => { this.remove(tab.id); }, GONE_LINGER_MS);
        }
        this.update({ tabs: [...this.view.tabs] });
        if (tab.id === this.view.active) this.suggest();
      },
      onWatching: (watching) => {
        if (tab.cwd === watching.cwd) return;
        tab.cwd = watching.cwd;
        this.update({ tabs: [...this.view.tabs] });
        if (tab.id === this.view.active) this.suggest();
      },
      onNotice: (text) => { this.notice(text); },
    });
    this.view = { ...this.view, tabs: [...this.view.tabs, tab], ...(active && { active: tab.id }) };
    this.notify();
  }

  private remove(id: string): void {
    const tabs = this.view.tabs;
    const at = tabs.findIndex((t) => t.id === id);
    if (at < 0) return;
    const rest = tabs.filter((t) => t.id !== id);
    const host = tabs[at]?.host;
    if (host !== undefined && !rest.some((t) => t.host === host)) {
      this.syncs.get(host)?.stop();
      this.syncs.delete(host);
    }
    const wasActive = this.view.active === id;
    const next = wasActive ? (rest[at] ?? rest[at - 1]) : undefined;
    this.update({ tabs: rest, ...(wasActive && { active: next?.id ?? null }) });
    next?.driver.uncover();
    if (wasActive) this.lineGone();
    this.save();
  }

  /** A listing is the truth about which windows exist: close the tabs whose window is gone. */
  private prune(host: string, listing: TmuxListing | null): void {
    for (const tab of this.view.tabs) {
      if (tab.host === host && !listed(listing, tab.window)) tab.driver.windowGone();
    }
  }

  /** Titles are `session:window`; a rename changes the window part. */
  private rename(host: string, window: WindowRef, name: string): void {
    const tab = this.view.tabs.find((t) => t.host === host && sameWindow(t.window, window));
    if (!tab) return;
    const title = `${tab.name.slice(0, tab.name.indexOf(":") + 1)}${name}`;
    if (title === tab.name) return;
    tab.name = title;
    this.update({ tabs: [...this.view.tabs] });
    this.save();
  }

  private setViewport(viewport: Viewport): void {
    this.sizer.setViewport(viewport);
    // The insets the terminal is sized from are the ones the layout pads by.
    const root = document.documentElement.style;
    for (const side of ["top", "right", "bottom", "left"] as const) root.setProperty(`--safe-${side}`, `${String(viewport.safeArea[side])}px`);
    if (this.view.keyboard !== viewport.keyboard) {
      this.update({ keyboard: viewport.keyboard });
      this.suggest();
    }
  }

  /**
   * Asks for chips for the line on screen: only with the keyboard up, where the strip sits
   * above the key row, and with the active tab live. `cwd` is the prompt's own OSC 7 path,
   * else the tab's from `watching`, which lags a `cd`.
   */
  private suggest(): void {
    const tab = this.activeTab();
    const entry = tab && this.hosts.entries().find((h) => h.id === tab.host);
    const line = this.promptLine;
    if (!line || !tab || !entry || !this.view.keyboard || tab.state.kind !== "live") {
      this.suggester.set(null, null);
      return;
    }
    this.suggester.set({ before: line.before, after: line.after, cwd: line.cwd ?? tab.cwd }, httpComplete(httpOrigin(entry)));
  }

  /** Another tab is going on screen: the line shown is the last tab's until its snapshot lands. */
  private lineGone(): void {
    this.promptLine = null;
    this.suggest();
  }

  private sheetHost(id = this.activeTab()?.host): HostEntry | null {
    const entries = this.hosts.entries();
    return entries.find((h) => h.id === id) ?? entries[0] ?? null;
  }

  private draft(): Draft | null {
    return this.view.sheet?.kind === "create" ? this.view.sheet.draft : null;
  }

  private patchDraft(patch: Partial<Draft>): void {
    const draft = this.draft();
    if (draft) this.update({ sheet: { kind: "create", draft: { ...draft, ...patch } } });
  }

  private notice(text: string): void {
    clearTimeout(this.noticeTimer);
    this.update({ notice: text });
    this.noticeTimer = setTimeout(() => { this.update({ notice: null }); }, NOTICE_MS);
  }

  private save(): void {
    this.native.saveTabs(this.view.tabs.map(({ id, host, window, name }) => ({ id, host, window, name })), this.view.active);
  }

  private update(patch: Partial<AppView>): void {
    this.view = { ...this.view, ...patch };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function sameWindow(a: WindowRef, b: WindowRef): boolean {
  return a.server === b.server && a.window === b.window;
}

/** `session:window` for a window in a listing. */
function titleOf(listing: TmuxListing | null, window: WindowRef): string | null {
  if (listing?.server !== window.server) return null;
  for (const session of listing.sessions) {
    const win = session.windows.find((w) => w.id === window.window);
    if (win) return `${session.name}:${win.name}`;
  }
  return null;
}

function listingError(error: unknown, hostName: string): Listing {
  if (error instanceof AskError) {
    if (error.reason === "unauthorized" || error.reason === "incompatible" || error.reason === "detached") return { kind: "halted", halt: error.reason };
    if (error.reason === "noServer") return { kind: "noServer" };
    if (error.reason === "timeout") return { kind: "error", message: `Can't reach ${hostName}. Is Tailscale on?` };
  }
  return { kind: "error", message: error instanceof Error ? error.message : String(error) };
}
