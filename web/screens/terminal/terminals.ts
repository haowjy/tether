// The terminal surface and every tab's driver, outside Preact (client-architecture.md §3.2,
// §6.5, §7). The renderer and its element live for the page's life: this object owns them and
// the screen only places the element, so a screen that unmounts (an admission problem
// replaces the shell) never loses the buffer or a tab's watch. It runs the pieces no
// component should: one `TabDriver` per open tab, tmux's size from the stable box, desktop
// direct input, and paste.
import type { AppController } from "../../app/controller";
import type { PasteResult } from "../../net/host";
import type { HostClient } from "../../net/hosts";
import { tabId } from "../../platform/tabKey";
import type { InputEvent, Viewport } from "../../platform/types";
import { acceptsInsert, type ConnectionState } from "../../tabs/connection";
import { TabDriver, type InsertResult } from "../../tabs/driver";
import { cannotInsert, shellQuote } from "../../tabs/input";
import { createXtermRenderer, type TerminalRenderer } from "../../term";
import { TerminalSizer } from "../../term/size";
import { Store } from "../../ui/store";
import { terminalTheme } from "../../ui/theme";
import { tabLabels } from "../../workspace/labels";
import { shownTab } from "../../workspace/state";
import { interceptClipboard, pasteRefusal, type Pasted } from "./paste";
import styles from "./Terminal.module.css";

/** What the pill and the status band read for a tab. */
export interface TabStatus {
  state: ConnectionState;
  /** When the tab stopped being live, or opened (ms since the epoch). */
  downSince: number;
  /** When the next automatic retry fires, null if none is due. */
  retryAt: number | null;
}

interface TerminalsView {
  tabs: Readonly<Record<string, TabStatus>>;
  /** The terminal has a renderer, a cell size and a tmux size: tabs can watch. */
  ready: boolean;
}

/** A few frames for xterm to paint and the cell to become measurable. */
const MEASURE_FRAMES = 30;
/**
 * Keys typed within this long go as one `input` message. The daemon refuses a burst of
 * separate messages with `busy` once enough are in flight, and a refused input has no reply
 * to tell the client, so a fast typist or a slow machine would lose characters.
 */
const INPUT_BATCH_MS = 8;

const instances = new WeakMap<AppController, Terminals>();

/** The one terminal surface of this app. */
export function terminalsOf(app: AppController): Terminals {
  let terminals = instances.get(app);
  if (!terminals) {
    terminals = new Terminals(app);
    instances.set(app, terminals);
  }
  return terminals;
}

export class Terminals extends Store<TerminalsView> {
  /** The element the renderer draws into; the screen places it and never creates it. */
  readonly element: HTMLDivElement = document.createElement("div");
  private renderer: TerminalRenderer | null = null;
  private creating = false;
  private readonly drivers = new Map<string, TabDriver>();
  private readonly sizer: TerminalSizer;
  private viewport: Viewport;
  private registered: HTMLElement | null = null;
  /** The tab whose snapshot is on the surface. Another tab's content never shows under a pill that isn't its own. Closing that tab clears it. */
  private painted: string | null = null;
  private batch: { id: string; events: InputEvent[] } | null = null;
  private batchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly app: AppController) {
    super({ tabs: {}, ready: false });
    this.viewport = app.snapshot.viewport;
    this.element.className = styles.host ?? "";
    this.element.dataset["blank"] = "true"; // until the first snapshot: no pretend-live empty terminal
    this.sizer = new TerminalSizer({
      cell: () => this.renderer?.cellSize() ?? null,
      onChange: (size) => { this.shownDriver()?.resize(size); },
    });
    interceptClipboard(this.element, {
      onPaste: (pasted) => { this.pasted(pasted); },
      selectionText: () => this.renderer?.selectionText() ?? "",
    });
    new ResizeObserver(() => { this.measure(); }).observe(this.element);
    app.subscribe(() => { this.sync(); });
    app.platform.subscribe((event) => {
      // Native's responder: only the tab on screen still takes input.
      if (event.type !== "input") return;
      const id = tabId(event.tab);
      if (id === this.shownTerminalTab()) this.drivers.get(id)?.input(event.events);
    });
    this.sizer.setViewport(this.viewport);
    this.sync();
  }

  /** Places the surface in `slot`. The renderer is created once the surface has a size. */
  mount(slot: HTMLElement): void {
    if (this.element.parentElement !== slot) slot.append(this.element);
    this.measure();
  }

  /** A pill tap on a tab that is waiting to reconnect retries it now. */
  nudge(id: string): void {
    const status = this.snapshot.tabs[id];
    if (status?.state.kind === "reconnecting" || status?.state.kind === "limited") this.drivers.get(id)?.nudge();
  }

  /** The tab's own Retry. */
  retry(id: string): void {
    this.drivers.get(id)?.nudge();
  }

  /** Whether `id`'s tab takes Insert path now (the driver's own rule, read from its state): a connecting tab does, and the path waits for its watch. */
  canInsert(id: string): boolean {
    const state = this.snapshot.tabs[id]?.state;
    return state !== undefined && acceptsInsert(state);
  }

  /**
   * The one way a path reaches a tab (Files' Insert path, an uploaded image): quoted, no
   * Enter, into that tab only, once it is watching. A refusal is reported here, once;
   * a path that is later dropped is reported by the driver.
   */
  insertPath(id: string, path: string): InsertResult {
    const driver = this.drivers.get(id);
    const result = driver?.insertPath(path) ?? "refused";
    if (result === "refused") this.app.notify(cannotInsert(path, driver ? "the tab isn't connected" : "that tab is closed") + " The file is still in Files.");
    return result;
  }

  /** Sends one paste for a live tab. A phone line field passes `enter: true`. */
  sendPaste(id: string, text: string, enter = false): boolean {
    return this.drivers.get(id)?.paste(text, enter) ?? false;
  }

  private sync(): void {
    const { viewport, workspace } = this.app.snapshot;
    if (viewport !== this.viewport) {
      const before = this.viewport;
      this.viewport = viewport;
      this.sizer.setViewport(viewport);
      if (viewport.scheme !== before.scheme) this.renderer?.setTheme(terminalTheme());
      if (viewport.density !== before.density) this.refont();
      if (viewport.directInput !== before.directInput) this.applyInput();
      this.measure();
    }
    for (const tab of workspace.tabs) {
      if (this.drivers.has(tab.id)) continue;
      const client = this.app.hosts.byHostId(tab.key.host);
      if (client) this.open(tab.id, tab.key.window, client);
    }
    for (const [id, driver] of this.drivers) {
      if (workspace.tabs.some((t) => t.id === id)) continue;
      this.drivers.delete(id);
      if (this.painted === id) this.painted = null;
      driver.close();
      this.update({ tabs: Object.fromEntries(Object.entries(this.snapshot.tabs).filter(([key]) => key !== id)) });
    }
    // The tab on screen watches once the box is measured; every other tab rests covered. Both calls are idempotent.
    const shown = this.shownTerminalTab();
    for (const [id, driver] of this.drivers) {
      if (id === shown && this.snapshot.ready) driver.uncover();
      else driver.cover();
    }
    this.showPainted();
  }

  /** On Terminal the surface shows a tab only once its own snapshot has painted; off Terminal it keeps what it holds, for the return, unless no tab is left. */
  private showPainted(): void {
    const { workspace } = this.app.snapshot;
    const blank = workspace.active === null || (workspace.onTerminal && this.painted !== workspace.active);
    if (blank) this.element.dataset["blank"] = "true";
    else if (workspace.onTerminal) this.element.removeAttribute("data-blank");
  }

  private open(id: string, window: { server: string; window: number }, client: HostClient): void {
    const hostId = client.hostId ?? "";
    const driver = new TabDriver({
      window,
      renderer: {
        output: (bytes) => { this.renderer?.output(bytes); },
        snapshot: async (snapshot) => {
          await this.renderer?.snapshot(snapshot);
          // The surface now holds this tab's content, whichever tab is on screen by the time xterm finished parsing.
          this.painted = id;
          this.showPainted();
        },
      },
      host: client.socket,
      size: () => this.sizer.claim(),
      // A tab never watches before the box is measured: tmux must not see the 80x24 placeholder.
      covered: true,
      onState: (state) => { this.stateChanged(id, hostId, window.server, state); },
      onWatching: () => { this.app.dispatch({ type: "watching", id }); },
      onNotice: (text) => { this.app.notify(text); },
      onPasteResult: (result) => { this.pasteResult(id, result); },
    });
    this.drivers.set(id, driver);
  }

  private stateChanged(id: string, hostId: string, server: string, state: ConnectionState): void {
    const now = Date.now();
    const before = this.snapshot.tabs[id];
    const down = state.kind !== "live";
    const status: TabStatus = {
      state,
      downSince: down ? (before?.state.kind !== "live" && before ? before.downSince : now) : now,
      retryAt: state.kind === "reconnecting" && state.retryInMs !== null ? now + state.retryInMs : state.kind === "limited" ? now + state.retryInMs : null,
    };
    this.update({ tabs: { ...this.snapshot.tabs, [id]: status } });
    if (state.kind !== "closed") return;
    // A window or server that went away closes the tab; a tab the user closed already left.
    if (state.reason === "windowClosed") this.app.dispatch({ type: "windowClosed", id });
    else if (state.reason === "serverExited") this.app.dispatch({ type: "serverExited", hostId, server });
  }

  /** Keystrokes for the tab on screen now, held for a few milliseconds to share a message. */
  private type(events: InputEvent[]): void {
    const id = this.shownTerminalTab();
    if (id === null) return;
    if (this.batch && this.batch.id !== id) this.flushInput();
    if (this.batch) this.batch.events.push(...events);
    else this.batch = { id, events: [...events] };
    this.batchTimer ??= setTimeout(() => { this.flushInput(); }, INPUT_BATCH_MS);
  }

  /** Sends what was typed, in order, to the tab it was typed in and no other; dropped if that tab isn't watching. */
  private flushInput(): void {
    clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
    const batch = this.batch;
    this.batch = null;
    if (batch) this.drivers.get(batch.id)?.input(batch.events);
  }

  private shownDriver(): TabDriver | undefined {
    const id = this.shownTerminalTab();
    return id === null ? undefined : this.drivers.get(id);
  }

  /** The selected tab watches only while no native screen covers Terminal. */
  private shownTerminalTab(): string | null {
    const { workspace, lifecycle } = this.app.snapshot;
    return lifecycle.covered ? null : shownTab(workspace);
  }

  /**
   * The tether chrome is whatever surrounds the surface in the keyboard-hidden layout: the
   * stable box less the surface. While the keyboard is up, a native web view's surface is
   * shorter for it, so the chrome is not measured then.
   */
  private measure(frame = 0): void {
    const { clientWidth: width, clientHeight: height } = this.element;
    if (width === 0 || height === 0) return;
    if (!this.renderer) {
      void this.createRenderer();
      return;
    }
    const { viewport } = this;
    if (!viewport.keyboard) {
      const { top, right, bottom, left } = viewport.safeArea;
      this.sizer.setChrome({ x: viewport.width - left - right - width, y: viewport.stableHeight - top - bottom - height });
    }
    this.sizer.remeasure();
    if (this.sizer.measured) {
      this.becomeReady();
    } else if (frame < MEASURE_FRAMES) {
      requestAnimationFrame(() => { this.measure(frame + 1); });
    }
  }

  private becomeReady(): void {
    if (this.snapshot.ready) return;
    this.update({ ready: true });
    this.sync();
  }

  private async createRenderer(): Promise<void> {
    if (this.creating) return;
    this.creating = true;
    // xterm measures its cell once, at open: the faces must be in.
    const style = getComputedStyle(this.element);
    const size = style.fontSize;
    await Promise.all([document.fonts.load(`${size} tether-mono`), document.fonts.load(`bold ${size} tether-mono`)]).catch(() => undefined);
    const font = getComputedStyle(this.element);
    const renderer = createXtermRenderer(this.element, {
      fontFamily: font.fontFamily,
      fontSize: parseFloat(font.fontSize),
      theme: terminalTheme(),
      openLink: (url) => { this.app.platform.openURL(url); },
    });
    this.renderer = renderer;
    // The symbols fallback arrives after first paint: its glyphs draw once the atlas is cleared.
    document.fonts.addEventListener("loadingdone", () => { renderer.refreshGlyphs(); });
    this.applyInput();
    this.measure();
  }

  private refont(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const style = getComputedStyle(this.element);
    renderer.setFont(style.fontFamily, parseFloat(style.fontSize));
    requestAnimationFrame(() => { this.measure(); });
  }

  /** Desktop direct input is xterm's own textarea, held by the focus controller; phone and native bring their own. */
  private applyInput(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const xterm = this.viewport.directInput === "xterm";
    renderer.setInput(
      xterm
        ? {
            input: (events: InputEvent[]) => { this.type(events); },
            copy: () => {
              const text = renderer.selectionText();
              if (text) void this.app.platform.clipboard.writeText(text);
            },
            // A keypress is a gesture, so this focus is allowed on a touch laptop too.
            leave: () => { this.app.focus.focusTarget("tabs", true); },
          }
        : null,
    );
    if (this.registered) this.app.focus.withdraw("terminal", this.registered);
    this.registered = xterm ? renderer.inputElement() : null;
    if (!this.registered) return;
    this.app.focus.register("terminal", this.registered);
    this.focusIfIdle();
  }

  /**
   * Arriving at Terminal puts desktop focus in it, but the first time that happens the input
   * element may not exist yet (the fonts load first): focus it once it does, unless
   * something else, a dialog or a field, has taken the focus meanwhile.
   */
  private focusIfIdle(): void {
    const { nav } = this.app.snapshot;
    const holder = document.activeElement;
    if (nav.destination !== "terminal" || nav.entry.overlay !== null || (holder && holder !== document.body)) return;
    this.app.focus.focusTarget("terminal");
  }

  private pasted(pasted: Pasted): void {
    // The tab is captured now: the upload below finishes later.
    const id = this.shownTerminalTab();
    const driver = id === null ? undefined : this.drivers.get(id);
    if (pasted.kind === "empty" || id === null || !driver) return;
    this.flushInput(); // what was typed before the paste goes first
    if (pasted.kind === "text") {
      const refusal = pasteRefusal(pasted.text);
      if (refusal) this.app.notify(refusal);
      else if (!this.sendPaste(id, pasted.text, false)) this.app.notify("Not sent: the tab isn't connected");
      return;
    }
    void this.pasteImage(id, pasted.file);
  }

  private pasteResult(id: string, result: PasteResult): void {
    if (result.type === "pasted") return;
    const tabs = this.app.snapshot.workspace.tabs;
    const tab = tabLabels(tabs, (hostId) => this.app.hosts.byHostId(hostId)?.name ?? hostId)
      .find((label) => label.id === id)?.full ?? "the closed tab";
    if (result.type === "pasteLost") {
      this.app.notify(`May not have been sent to ${tab}: the connection was lost before tmux confirmed the paste`);
      return;
    }
    const label = result.data.code === "tmux" ? "May not have been sent" : "Not sent";
    this.app.notify(`${label} to ${tab}: ${result.data.message}`);
  }

  /** Uploads the pasted image, then types its quoted path into the tab it was pasted in. */
  private async pasteImage(id: string, file: File): Promise<void> {
    const { platform } = this.app;
    const tab = this.app.snapshot.workspace.tabs.find((t) => t.id === id);
    const client = tab && this.app.hosts.byHostId(tab.key.host);
    if (!platform.uploads.send || !client) {
      this.app.notify("Paste images from Files → Upload");
      return;
    }
    this.app.notify("Uploading image…");
    for await (const event of platform.uploads.send(client.entry.handle, file, new AbortController().signal)) {
      if ("error" in event) {
        this.app.notify(`Upload failed: ${event.error}`);
      } else if ("path" in event) {
        const name = event.path.split("/").pop() ?? event.path;
        // The tab may be covered or still connecting: the path then waits for its watch. A refusal says so itself.
        const result = this.insertPath(id, event.path);
        if (result === "typed") this.app.notify(`Inserted ${shellQuote(name)}`);
        else if (result === "queued") this.app.notify(`Uploaded ${name}: its path will be inserted when that tab is on screen and connected`);
      }
    }
  }
}
