import type { Boot, HostEntry, Native, NativeMsg, SavedTab, Viewport } from "../native/bridge";
import type { Chip, TmuxListing, WindowRef } from "../proto/generated/messages";
import { sameWindow, listed } from "../proto/window";
import { TabDriver } from "../tabs/driver";
import { initialState, type ConnectionState } from "../tabs/connection";
import type { PromptLine, TerminalRenderer } from "../term";
import { TerminalSizer } from "../term/size";
import { FileBrowser } from "../files/browser";
import { Suggester } from "../complete/suggest";
import { Store } from "../ui/store";
import { HostRegistry, type HostClient } from "./hosts";
import { HostSync } from "./sync";
import { WindowsSheet } from "./windows";

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
}

/** An open sheet; each is about the host it opened for. */
export type Sheet =
  | { kind: "home" | "attach"; windows: WindowsSheet }
  | { kind: "files"; host: HostEntry; browser: FileBrowser };

export interface AppView {
  tabs: readonly TabView[];
  active: string | null;
  sheet: Sheet | null;
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
export class App extends Store<AppView> {
  private readonly native: Native;
  private readonly renderer: TerminalRenderer;
  private readonly hosts: HostRegistry;
  private readonly sizer: TerminalSizer;
  private readonly drivers = new Map<string, TabDriver>();
  private readonly syncs = new Map<string, HostSync>();
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  /** The file manager's hidden-files toggle, kept for the next time it opens. */
  private hiddenFiles = false;
  private readonly suggester = new Suggester((chips) => { this.update({ chips }); });
  /** The command line on screen, from the renderer. */
  private promptLine: PromptLine | null = null;

  constructor(opts: AppOptions) {
    super({
      tabs: [], active: null, sheet: null, notice: null,
      keyboard: opts.boot.viewport.keyboard, locked: opts.boot.locked, scrolledUp: false, chips: null,
    });
    this.native = opts.native;
    this.renderer = opts.renderer;
    this.hosts = new HostRegistry(opts.native, () => { opts.native.recreateWebView(); }, opts.boot.locked);
    this.sizer = new TerminalSizer({
      cell: () => opts.renderer.cellSize(),
      chromeHeight: () => opts.chromeHeight(),
      edge: () => opts.edge(),
      onChange: (size) => { this.activeDriver()?.resize(size); },
    });
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
    // The cell can be measured only once xterm has painted.
    requestAnimationFrame(() => { this.sizer.remeasure(); });
  }

  /** `window.__tether.activeTab()`: the tab on screen, for native's upload targeting. */
  activeTab(): TabView | undefined {
    return this.snapshot.tabs.find((t) => t.id === this.snapshot.active);
  }

  receive(msg: NativeMsg): void {
    switch (msg.type) {
      case "input":
        this.activeDriver()?.input(msg.events);
        break;
      case "viewport":
        this.setViewport(msg);
        break;
      case "lifecycle":
        this.hosts.setActive(msg.phase === "active");
        // A listing cut short by the background is asked for again.
        if (msg.phase === "active" && this.snapshot.sheet && this.snapshot.sheet.kind !== "files") void this.snapshot.sheet.windows.refresh();
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
        break;
      case "upload": {
        if (!msg.path) break;
        const tab = this.snapshot.tabs.find((t) => t.id === msg.tab && t.host === msg.host);
        if (tab) this.drivers.get(tab.id)?.insertPath(msg.path);
        const { sheet } = this.snapshot;
        if (sheet?.kind === "files" && sheet.host.id === msg.host) void sheet.browser.uploaded(msg.path);
        break;
      }
    }
  }

  /** The label native gave a host, for the UI's copy. */
  hostName(id: string): string {
    return this.hosts.get(id)?.entry.name ?? id;
  }

  /** A pill tap: switch to the tab, and retry now if it is waiting to reconnect. */
  activate(id: string): void {
    const next = this.snapshot.tabs.find((t) => t.id === id);
    if (!next || next.state.kind === "closed") return;
    if (next.id !== this.snapshot.active) {
      this.activeDriver()?.cover();
      this.drivers.get(id)?.uncover();
      this.native.haptic("selection");
      this.update({ active: id, sheet: null });
      this.lineGone();
      this.save();
    }
    if (next.state.kind === "reconnecting") this.drivers.get(id)?.nudge();
  }

  close(id: string): void {
    this.drivers.get(id)?.close();
  }

  /** `[⌨]`: native owns the keyboard; this only asks. Its key row hides it again. */
  showKeyboard(): void {
    this.native.focus("terminal");
  }

  /** A chip tap types its text, as a key would (ios-shell.md "How input reaches the terminal"). */
  typeChip(chip: Chip): void {
    if (!this.activeDriver()?.input([{ text: chip.insert }])) return;
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
    const open = this.snapshot.tabs.find((t) => t.host === host && sameWindow(t.window, window) && t.state.kind !== "closed");
    this.update({ sheet: null });
    if (open) {
      this.activate(open.id);
      return;
    }
    this.activeDriver()?.cover();
    this.open({ id: newId(), host, window, name }, true);
    this.lineGone();
    this.save();
  }

  /** `[<]` home or the `[+]` sheet; both list the host's windows. */
  openSheet(kind: "home" | "attach"): void {
    const client = this.sheetHost();
    const tab = this.activeTab();
    const windows = new WindowsSheet({
      host: client ?? null,
      native: this.native,
      cwd: tab && tab.host === client?.entry.id ? tab.cwd : null,
      onListing: (listing) => { if (client) this.prune(client.entry.id, listing); },
      onCreated: (window, title) => { if (client) this.add(client.entry.id, window, title); },
    });
    this.update({ sheet: { kind, windows } });
    void windows.refresh();
  }

  /**
   * `[⊞]` or Home's Files row: the file manager for the sheet's host, at the tab's cwd when
   * a root holds it. The keyboard stays as it is (plan.md "File manager").
   */
  openFiles(): void {
    const client = this.sheetHost();
    if (!client) return;
    const browser = new FileBrowser({ api: client.fs, hidden: this.hiddenFiles, onHidden: (hidden) => { this.hiddenFiles = hidden; } });
    const tab = this.activeTab();
    this.update({ sheet: { kind: "files", host: client.entry, browser } });
    void browser.start(tab?.host === client.entry.id ? tab.cwd : null);
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

  private open(saved: SavedTab, active: boolean): void {
    const client = this.hosts.get(saved.host);
    if (!client) return;
    const host = client.socket;
    if (!this.syncs.has(saved.host)) {
      this.syncs.set(saved.host, new HostSync({
        host,
        onListing: (listing) => {
          this.prune(saved.host, listing);
          // Keeps an open sheet current: `sessionsChanged` relists the host.
          const { sheet } = this.snapshot;
          if (sheet && sheet.kind !== "files" && sheet.windows.hostId === saved.host) sheet.windows.listed(listing);
        },
        onRenamed: (window, name) => { this.rename(saved.host, window, name); },
      }));
    }
    const { id } = saved;
    this.update({
      tabs: [...this.snapshot.tabs, { ...saved, state: initialState, downSince: Date.now(), retryAt: null, cwd: null }],
      ...(active && { active: id }),
    });
    this.drivers.set(id, new TabDriver({
      window: saved.window,
      renderer: this.renderer,
      host,
      size: () => this.sizer.size,
      covered: !active,
      onState: (state) => {
        const now = Date.now();
        this.patchTab(id, (tab) => ({
          state,
          downSince: state.kind === "live" ? null : (tab.downSince ?? now),
          retryAt: state.kind === "reconnecting" && state.retryInMs !== null ? now + state.retryInMs : null,
        }));
        if (state.kind === "closed") {
          // A window that went away shows ✕ for a moment; a tab Jimmy closed just goes.
          if (state.reason === "user") queueMicrotask(() => { this.remove(id); });
          else setTimeout(() => { this.remove(id); }, GONE_LINGER_MS);
        }
        if (id === this.snapshot.active) this.suggest();
      },
      onWatching: (watching) => {
        if (this.snapshot.tabs.find((t) => t.id === id)?.cwd === watching.cwd) return;
        this.patchTab(id, () => ({ cwd: watching.cwd }));
        if (id === this.snapshot.active) this.suggest();
      },
      onNotice: (text) => { this.notice(text); },
    }));
  }

  private remove(id: string): void {
    const tabs = this.snapshot.tabs;
    const at = tabs.findIndex((t) => t.id === id);
    if (at < 0) return;
    const rest = tabs.filter((t) => t.id !== id);
    this.drivers.delete(id);
    const host = tabs[at]?.host;
    if (host !== undefined && !rest.some((t) => t.host === host)) {
      this.syncs.get(host)?.stop();
      this.syncs.delete(host);
    }
    const wasActive = this.snapshot.active === id;
    const next = wasActive ? (rest[at] ?? rest[at - 1]) : undefined;
    this.update({ tabs: rest, ...(wasActive && { active: next?.id ?? null }) });
    if (next) this.drivers.get(next.id)?.uncover();
    if (wasActive) this.lineGone();
    this.save();
  }

  /** A listing is the truth about which windows exist: close the tabs whose window is gone. */
  private prune(host: string, listing: TmuxListing | null): void {
    for (const tab of this.snapshot.tabs) {
      if (tab.host === host && !listed(listing, tab.window)) this.drivers.get(tab.id)?.windowGone();
    }
  }

  /** Titles are `session:window`; a rename changes the window part. */
  private rename(host: string, window: WindowRef, name: string): void {
    const tab = this.snapshot.tabs.find((t) => t.host === host && sameWindow(t.window, window));
    if (!tab) return;
    const title = `${tab.name.slice(0, tab.name.indexOf(":") + 1)}${name}`;
    if (title === tab.name) return;
    this.patchTab(tab.id, () => ({ name: title }));
    this.save();
  }

  private patchTab(id: string, patch: (tab: TabView) => Partial<TabView>): void {
    this.update({ tabs: this.snapshot.tabs.map((t) => (t.id === id ? { ...t, ...patch(t) } : t)) });
  }

  private activeDriver(): TabDriver | undefined {
    const { active } = this.snapshot;
    return active === null ? undefined : this.drivers.get(active);
  }

  private setViewport(viewport: Viewport): void {
    this.sizer.setViewport(viewport);
    // The insets the terminal is sized from are the ones the layout pads by.
    const root = document.documentElement.style;
    for (const side of ["top", "right", "bottom", "left"] as const) root.setProperty(`--safe-${side}`, `${String(viewport.safeArea[side])}px`);
    if (this.snapshot.keyboard !== viewport.keyboard) {
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
    const client = tab && this.hosts.get(tab.host);
    const line = this.promptLine;
    if (!line || !tab || !client || !this.snapshot.keyboard || tab.state.kind !== "live") {
      this.suggester.set(null, null);
      return;
    }
    this.suggester.set({ before: line.before, after: line.after, cwd: line.cwd ?? tab.cwd }, client.complete);
  }

  /** Another tab is going on screen: the line shown is the last tab's until its snapshot lands. */
  private lineGone(): void {
    this.promptLine = null;
    this.suggest();
  }

  /** The host a sheet opens for: the open sheet's, else the active tab's, else the first. */
  private sheetHost(): HostClient | undefined {
    const { sheet } = this.snapshot;
    const id = sheet ? (sheet.kind === "files" ? sheet.host.id : sheet.windows.hostId) : this.activeTab()?.host;
    return (id ? this.hosts.get(id) : undefined) ?? this.hosts.all()[0];
  }

  private notice(text: string): void {
    clearTimeout(this.noticeTimer);
    this.update({ notice: text });
    this.noticeTimer = setTimeout(() => { this.update({ notice: null }); }, NOTICE_MS);
  }

  private save(): void {
    this.native.saveTabs(this.snapshot.tabs.map(({ id, host, window, name }) => ({ id, host, window, name })), this.snapshot.active);
  }
}
