// The terminal surface and every tab's driver, outside Preact (client-architecture.md §3.2,
// §6.5, §7). The renderer and its element live for the page's life: this object owns them and
// the screen only places the element, so a screen that unmounts (an admission problem
// replaces the shell) never loses the buffer or a tab's watch. It runs the pieces no
// component should: one `TabDriver` per open tab, tmux's size from the stable box, desktop
// direct input, and (in `Pastes`) paste.
import type { AppController } from "../../app/controller";
import type { HostClient } from "../../net/hosts";
import { tabId } from "../../platform/tabKey";
import type { InputEvent, Viewport } from "../../platform/types";
import { acceptsInsert, type ConnectionState } from "../../tabs/connection";
import { TabDriver } from "../../tabs/driver";
import type { SessionRef, ShownWindow } from "../../proto/generated/messages";
import { createXtermRenderer, type PromptLine, type TerminalRenderer } from "../../term";
import { TerminalSizer } from "../../term/size";
import { ArmedModifiers } from "../../touch/armed";
import { routeKey } from "../../touch/keyRoute";
import { createOwnedInput } from "../../touch/owned-input";
import { Store } from "../../ui/store";
import { terminalTheme } from "../../ui/theme";
import { screenOf, shownTab } from "../../workspace/state";
import { interceptClipboard, Pastes } from "./paste";
import type { MenuState } from "./selection/control";
import styles from "./Terminal.module.css";
import { TerminalView } from "./view";

/** What the pill and the status band read for a tab. */
export interface TabStatus {
  state: ConnectionState;
  /** When the tab stopped being live, or opened (ms since the epoch). */
  downSince: number;
  /** When the next automatic retry fires, null if none is due. */
  retryAt: number | null;
  /** The window's size has differed from this tab's for longer than the driver's wait: another terminal holds the window. */
  sizedForOther: boolean;
  /** The session's current window as the tab's latest `watching` says; null before the first. */
  shown: ShownWindow | null;
}

interface TerminalsView {
  tabs: Readonly<Record<string, TabStatus>>;
  /** The terminal has a renderer, a cell size and a tmux size: tabs can watch. */
  ready: boolean;
  /** The view is above the newest line (in the buffer or the history): the jump-to-latest control shows. */
  scrolled: boolean;
  /** The edit menu, while a long-press selection or a press on a blank cell has one open. */
  menu: MenuState | null;
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

/** The viewport inputs the tether chrome depends on; a keyboard changes none of them. */
function chromeInputsChanged(a: Viewport, b: Viewport): boolean {
  const sa = a.safeArea;
  const sb = b.safeArea;
  return a.layout !== b.layout || a.density !== b.density || a.directInput !== b.directInput || a.width !== b.width ||
    a.stableHeight !== b.stableHeight || sa.top !== sb.top || sa.right !== sb.right || sa.bottom !== sb.bottom || sa.left !== sb.left;
}

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
  /** True from the start until the first measurement lands, and briefly after the chrome's inputs change. */
  private chromeWindow = true;
  private registered: HTMLElement | null = null;
  /** The tab whose snapshot is on the surface. Another tab's content never shows under a pill that isn't its own. Closing that tab clears it. */
  private painted: string | null = null;
  /** Keys typed for one tab and one window, which is the window the tab showed when they were typed. */
  private batch: { id: string; window: number | null; events: InputEvent[] } | null = null;
  private batchTimer: ReturnType<typeof setTimeout> | undefined;
  /** tether's own input on a phone browser; created the first time it is needed. */
  private owned: HTMLTextAreaElement | null = null;
  private panArea: number | null = null;
  /** The shell's command line under the cursor, for a tap on the prompt row. */
  private promptLine: PromptLine | null = null;
  /** The touch side of looking at the shown tab: scroll, history, selection, gestures. */
  private readonly view: TerminalView;
  /** Paste, copy and inserted paths. */
  readonly pastes: Pastes;
  /** The armed ctrl or alt of the touch sources; it types through this surface. */
  readonly modifiers = new ArmedModifiers((events) => { this.type(events); });

  constructor(private readonly app: AppController) {
    super({ tabs: {}, ready: false, scrolled: false, menu: null });
    this.viewport = app.snapshot.viewport;
    this.element.className = styles.host ?? "";
    this.element.dataset["blank"] = "true"; // until the first snapshot: no pretend-live empty terminal
    this.sizer = new TerminalSizer({
      cell: () => this.renderer?.cellSize() ?? null,
      onChange: (size) => { this.shownDriver()?.resize(size); },
    });
    this.pastes = new Pastes({
      app,
      driver: (id) => this.drivers.get(id),
      shown: () => this.shownTerminalTab(),
      flushInput: () => { this.flushInput(); },
      takeSelection: () => this.view.takeSelection(),
      dismissSelection: () => { this.view.dismissSelection(); },
    });
    interceptClipboard(this.element, {
      onPaste: (pasted) => { this.pastes.paste(pasted); },
      selectionText: () => this.renderer?.selectionText() ?? "",
    });
    this.view = new TerminalView({
      element: this.element,
      renderer: () => this.renderer,
      theme: terminalTheme,
      fetchHistory: (start, end) => this.shownDriver()?.history(start, end) ?? null,
      send: (id, events) => { this.typeTo(id, events); },
      haptic: (kind) => { this.app.platform.haptic(kind); },
      directInput: () => this.viewport.directInput,
      focusTerminal: () => { this.app.focus.focusTarget("terminal", true); },
      prompt: () => this.promptLine,
      owner: () => this.app.focus.snapshot.owner,
      selecting: (on) => { this.app.focus.selecting(on); },
      onScrolled: (scrolled) => { this.update({ scrolled }); },
      onMenu: (menu) => { this.update({ menu }); },
    });
    new ResizeObserver(() => { this.measure(); }).observe(this.element);
    app.subscribe(() => { this.sync(); });
    app.focus.subscribe(() => { this.drawCursor(); });
    app.platform.subscribe((event) => {
      // Native's responder: only the tab on screen still takes input.
      if (event.type !== "input") return;
      const id = tabId(event.tab);
      if (id !== this.shownTerminalTab()) return;
      if (this.viewport.directInput === "native") {
        const line = this.app.focus.snapshot.owner === "line";
        for (const input of event.events) {
          if (line && "text" in input) {
            if (!this.modifiers.chord([input])) this.app.platform.input.insertLine(input.text);
          } else if (line && "key" in input && routeKey({ name: input.key }, "line", this.modifiers.snapshot.armed).to === "focusTerminal") {
            // A hardware Esc does what the key row's esc does.
            this.app.focus.focusTarget("terminal", true);
          } else this.modifiers.input([input]);
        }
      } else this.drivers.get(id)?.input(event.events);
    });
    this.sizer.setViewport(this.viewport);
    this.sync();
  }

  /** Places the surface in `slot`. The renderer is created once the surface has a size. */
  mount(slot: HTMLElement): void {
    if (this.element.parentElement !== slot) slot.append(this.element);
    this.measure();
  }

  /** Selects a tab. A tab that is waiting to reconnect retries now: a tap on its pill is the user asking. */
  activate(id: string): void {
    this.app.dispatch({ type: "activated", id });
    const status = this.snapshot.tabs[id];
    if (status?.state.kind === "reconnecting" || status?.state.kind === "limited") this.drivers.get(id)?.nudge();
  }

  /** Makes `window` the tab's session's current window; the tab follows with the next `watching`. */
  selectWindow(id: string, window: number): void {
    if (!this.drivers.get(id)?.selectWindow(window)) this.app.notify("Couldn't switch window: the tab isn't connected");
  }

  /** The band's Fit: sizes the window to this tab and so takes it from the other terminal. */
  fit(id: string): void {
    this.drivers.get(id)?.fit();
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
   * The line field's Return: one paste with Enter, run in the same tmux group by the daemon
   * (daemon-core.md §3.4). Returns the paste's `req`, or null, with nothing sent, when the tab
   * isn't live. Its one answer goes to {@link Pastes.claim}' claimant, not to a notice.
   */
  sendLine(id: string, text: string): number | null {
    this.flushInput(); // what was typed before goes first
    return this.drivers.get(id)?.paste(text, true) ?? null;
  }

  /** Named keys for one tab, now (the line field's empty Return). False when the tab isn't live. */
  sendKeys(id: string, events: InputEvent[]): boolean {
    this.flushInput();
    return this.drivers.get(id)?.input(events) ?? false;
  }

  /** The jump-to-latest control. */
  toLatest(): void {
    this.view.scroll.toLatest();
  }

  /** What remains visible of the terminal above the dock, for the cursor pan; null follows the surface. */
  setPanArea(px: number | null): void {
    this.panArea = px;
    this.renderer?.setPanArea(px);
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
      if (chromeInputsChanged(before, viewport)) this.openChromeWindow();
      this.measure();
    }
    for (const tab of workspace.tabs) {
      if (tab.kind !== "terminal" || this.drivers.has(tab.id)) continue;
      const client = this.app.hosts.byHostId(tab.host);
      if (client) this.open(tab.id, tab.key.session, client);
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
    // What one tab had going on the surface (a coast, a held drag, a selection) is not the next tab's.
    this.view.show(shown);
  }

  private patchStatus(id: string, patch: Partial<Pick<TabStatus, "sizedForOther" | "shown">>): void {
    const status = this.snapshot.tabs[id];
    if (status) this.update({ tabs: { ...this.snapshot.tabs, [id]: { ...status, ...patch } } });
  }

  /** On Terminal the surface shows a tab only once its own snapshot has painted; off Terminal it keeps what it holds, for the return, unless no tab is left. */
  private showPainted(): void {
    const { workspace } = this.app.snapshot;
    const onTerminal = screenOf(workspace) === "terminal";
    const blank = !workspace.tabs.some((t) => t.kind === "terminal") || (onTerminal && this.painted !== workspace.active);
    if (blank) this.element.dataset["blank"] = "true";
    else if (onTerminal) this.element.removeAttribute("data-blank");
  }

  private open(id: string, session: SessionRef, client: HostClient): void {
    const hostId = client.hostId ?? "";
    const driver = new TabDriver({
      session,
      renderer: {
        output: (bytes) => { this.renderer?.output(bytes); },
        snapshot: async (snapshot) => {
          // The renderer follows the snapshot's pane alone, never the tab's own resizes: DOM before xterm grows to a pane larger
          // than the box (a canvas that size runs the phone out of memory), WebGL again only once a fitting pane is in place.
          const box = this.sizer.sizeForWatch();
          const large = snapshot.cols > box.cols || snapshot.rows > box.rows;
          if (large) this.renderer?.setWebgl(false);
          await this.renderer?.snapshot(snapshot);
          if (!large) this.renderer?.setWebgl(true);
          // What was fetched or selected sat above the buffer this snapshot replaced.
          this.view.reset();
          // The surface now holds this tab's content, whichever tab is on screen by the time xterm finished parsing.
          this.painted = id;
          this.showPainted();
        },
      },
      host: client.socket,
      size: () => this.sizer.sizeForWatch(),
      // A tab never watches before the box is measured: tmux must not see the 80x24 placeholder.
      covered: true,
      onState: (state) => { this.stateChanged(id, hostId, session.server, state); },
      onSizedForOther: (sizedForOther) => { this.patchStatus(id, { sizedForOther }); },
      onWatching: (watching) => {
        this.patchStatus(id, { shown: watching.window });
        this.app.dispatch({ type: "watching", id, window: watching.window.name });
      },
      onNotice: (text) => { this.app.notify(text); },
      onPasteResult: (result) => { this.pastes.result(id, result); },
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
      sizedForOther: before?.sizedForOther ?? false,
      shown: before?.shown ?? null,
    };
    this.update({ tabs: { ...this.snapshot.tabs, [id]: status } });
    if (state.kind !== "closed") return;
    // A session or server that went away closes the tab; a tab the user closed already left.
    if (state.reason === "sessionClosed") this.app.dispatch({ type: "sessionClosed", id });
    else if (state.reason === "serverExited") this.app.dispatch({ type: "serverExited", hostId, server });
  }

  /** Keystrokes for the tab on screen now. */
  private type(events: InputEvent[]): void {
    const id = this.shownTerminalTab();
    if (id !== null) this.typeTo(id, events);
  }

  /** Keystrokes for tab `id`, held for a few milliseconds to share a message; dropped if it is not the tab on screen any more. */
  private typeTo(id: string, events: InputEvent[]): void {
    if (id !== this.shownTerminalTab()) return;
    // Typing returns to the newest line.
    if (!this.view.scroll.atLatest) this.view.scroll.toLatest();
    // Keys go to the window the tab showed when they were typed, even if it follows its session to another within the batch.
    const window = this.drivers.get(id)?.windowId ?? null;
    if (this.batch && (this.batch.id !== id || this.batch.window !== window)) this.flushInput();
    if (this.batch) this.batch.events.push(...events);
    else this.batch = { id, window, events: [...events] };
    this.batchTimer ??= setTimeout(() => { this.flushInput(); }, INPUT_BATCH_MS);
  }

  /** Sends what was typed, in order, to the tab it was typed in and no other; dropped if that tab isn't watching. */
  private flushInput(): void {
    clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
    const batch = this.batch;
    this.batch = null;
    if (batch) this.drivers.get(batch.id)?.input(batch.events, batch.window);
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
   * The tether chrome is whatever surrounds the surface in the keyboard-hidden layout: the stable
   * box less the surface. It changes only when layout, density, width or the safe area do
   * (client-architecture.md §5.4), so it is measured in a short window after such a change and
   * at the start; a keyboard shrinking a native web view's surface never opens one.
   */
  private openChromeWindow(): void {
    this.chromeWindow = true;
    // Two frames: the change renders, then the surface lays out against it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.measure();
        this.chromeWindow = false;
      });
    });
  }

  private measure(frame = 0): void {
    const { clientWidth: width, clientHeight: height } = this.element;
    if (width === 0 || height === 0) return;
    if (!this.renderer) {
      void this.createRenderer();
      return;
    }
    if (this.chromeWindow) {
      const { viewport } = this;
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
    this.chromeWindow = false;
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
    renderer.setPanArea(this.panArea);
    renderer.onPromptLine((line) => { this.promptLine = line; });
    renderer.onScrolledUp(() => { this.view.scroll.scrolledChanged(); });
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

  /** Desktop direct input is xterm's own textarea, held by the focus controller; a phone browser's is tether's owned input; native brings its own. */
  private applyInput(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const { directInput } = this.viewport;
    const xterm = directInput === "xterm";
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
    // Where tether's own input (or native's) takes the keyboard, xterm's helper textarea is inert: out of the accessibility tree, so VoiceOver cannot land on it.
    const helper = renderer.inputElement();
    if (xterm) helper?.removeAttribute("aria-hidden");
    else helper?.setAttribute("aria-hidden", "true");
    this.registered = xterm ? renderer.inputElement() : directInput === "owned" ? this.ownedInput() : this.app.focus.nativeTerminal();
    this.drawCursor();
    if (!this.registered) return;
    this.app.focus.register("terminal", this.registered);
    if (xterm) this.focusIfIdle();
  }

  /** The owned input lives in the surface, so the capture-phase paste listener sees its pastes; the keyboard toggle focuses it. */
  private ownedInput(): HTMLTextAreaElement {
    if (!this.owned) {
      this.owned = createOwnedInput((events) => { this.modifiers.input(events); });
      this.element.append(this.owned);
    }
    return this.owned;
  }

  /** Solid block while the terminal holds the keyboard, hollow otherwise (§7.4); a desktop's real xterm focus draws itself. */
  private drawCursor(): void {
    const solid = this.viewport.directInput !== "xterm" && this.app.focus.snapshot.owner === "terminal";
    this.renderer?.setInactiveCursor(solid ? "block" : "outline");
  }

  /**
   * Arriving at Terminal puts desktop focus in it, but the first time that happens the input
   * element may not exist yet (the fonts load first): focus it once it does, unless
   * something else, a dialog or a field, has taken the focus meanwhile.
   */
  private focusIfIdle(): void {
    const { entry, workspace } = this.app.snapshot;
    const holder = document.activeElement;
    if (screenOf(workspace) !== "terminal" || entry.overlay !== null || (holder && holder !== document.body)) return;
    this.app.focus.focusTarget("terminal");
  }
}
