import { Native, type Boot, type NativeMsg, type SavedTab } from "../native/bridge";
import type { TmuxListing, WindowRef } from "../proto/generated/messages";
import { TabDriver } from "../tabs/driver";
import { initialState, type ConnectionState } from "../tabs/connection";
import type { TerminalRenderer } from "../term";
import { TerminalSizer } from "../term/size";
import { HostRegistry } from "./hosts";
import { listWindows } from "./listing";
import { HostSync, listed } from "./sync";

let counter = 0;
const newId = (): string => `${Date.now().toString(36)}-${String(counter++)}`;

export interface TabView extends SavedTab {
  state: ConnectionState;
  driver: TabDriver;
}

/** What the picker shows: windows to open, or why there are none. */
export type Picker = { kind: "loading" } | { kind: "error"; message: string } | { kind: "list"; host: string; listing: TmuxListing };

export interface AppView {
  tabs: readonly TabView[];
  active: string | null;
  picker: Picker | null;
  notice: string | null;
}

export interface AppOptions {
  native: Native;
  boot: Boot;
  renderer: TerminalRenderer;
  kind: "ios" | "web";
  /** Height of the tab bar and suggestion strip over the web view's bottom. */
  chromeHeight(): number;
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
  private view: AppView = { tabs: [], active: null, picker: null, notice: null };

  constructor(opts: AppOptions) {
    this.native = opts.native;
    this.renderer = opts.renderer;
    this.hosts = new HostRegistry(opts.native, opts.kind, () => { opts.native.recreateWebView(); }, opts.boot.locked);
    this.sizer = new TerminalSizer({
      cell: () => opts.renderer.cellSize(),
      chromeHeight: () => opts.chromeHeight(),
      onChange: (size) => { this.activeTab()?.driver.resize(size); },
    });
    this.sizer.setViewport(opts.boot.viewport);
    this.hosts.set(opts.boot.hosts);
    for (const saved of opts.boot.tabs) {
      this.open(saved, this.view.active === null);
    }
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
        this.sizer.setViewport(msg);
        break;
      case "lifecycle":
        this.hosts.setActive(msg.phase === "active");
        break;
      case "network":
        if (msg.reachable) this.hosts.nudge();
        break;
      case "lock":
        this.hosts.setLocked(msg.locked);
        break;
      case "hosts":
        this.hosts.set(msg.hosts);
        break;
      case "upload":
        if (msg.path) this.view.tabs.find((t) => t.id === msg.tab && t.host === msg.host)?.driver.insertPath(msg.path);
        break;
    }
  }

  activate(id: string): void {
    const next = this.view.tabs.find((t) => t.id === id);
    if (!next) return;
    if (next.id === this.view.active) {
      next.driver.nudge();
      return;
    }
    this.activeTab()?.driver.cover();
    next.driver.uncover();
    this.update({ active: id });
    this.save();
  }

  close(id: string): void {
    this.view.tabs.find((t) => t.id === id)?.driver.close();
  }

  /** Opens `window` as a new tab and shows it. */
  add(host: string, window: WindowRef, name: string): void {
    const open = this.view.tabs.find((t) => t.host === host && t.window.server === window.server && t.window.window === window.window);
    this.update({ picker: null });
    if (open) {
      this.activate(open.id);
      return;
    }
    this.activeTab()?.driver.cover();
    this.open({ id: newId(), host, window, name }, true);
    this.save();
  }

  /** The `[+]` sheet: the windows of the active tab's host, else the first host's. */
  async openPicker(): Promise<void> {
    const id = this.activeTab()?.host ?? this.hosts.entries()[0]?.id;
    const host = id === undefined ? undefined : this.hosts.get(id);
    if (id === undefined || !host) {
      this.update({ picker: { kind: "error", message: "No host. Add one in the app." } });
      return;
    }
    this.update({ picker: { kind: "loading" } });
    try {
      const listing = await listWindows(host);
      if (this.view.picker?.kind !== "loading") return; // dismissed meanwhile
      this.update({ picker: listing ? { kind: "list", host: id, listing } : { kind: "error", message: "tmux isn't running on that host." } });
    } catch (error) {
      if (this.view.picker?.kind === "loading") this.update({ picker: { kind: "error", message: String(error) } });
    }
  }

  closePicker(): void {
    this.update({ picker: null });
  }

  private open(saved: SavedTab, active: boolean): void {
    const host = this.hosts.get(saved.host);
    if (!host) return; // saved for a host native no longer lists
    if (!this.syncs.has(saved.host)) {
      this.syncs.set(saved.host, new HostSync({
        host,
        onListing: (listing) => { this.prune(saved.host, listing); },
        onRenamed: (window, name) => { this.rename(saved.host, window, name); },
      }));
    }
    const tab = { ...saved, state: initialState } as TabView;
    tab.driver = new TabDriver({
      window: saved.window,
      renderer: this.renderer,
      host,
      size: () => this.sizer.size,
      covered: !active,
      onState: (state) => {
        tab.state = state;
        if (state.kind === "closed") queueMicrotask(() => { this.remove(tab.id); });
        else this.update({});
      },
      onNotice: (text) => { this.update({ notice: text }); },
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
    const tab = this.view.tabs.find((t) => t.host === host && t.window.server === window.server && t.window.window === window.window);
    if (!tab) return;
    const title = `${tab.name.slice(0, tab.name.indexOf(":") + 1)}${name}`;
    if (title === tab.name) return;
    tab.name = title;
    this.update({ tabs: [...this.view.tabs] });
    this.save();
  }

  private save(): void {
    this.native.saveTabs(this.view.tabs.map(({ id, host, window, name }) => ({ id, host, window, name })));
  }

  private update(patch: Partial<AppView>): void {
    this.view = { ...this.view, ...patch };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
