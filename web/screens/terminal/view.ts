// How the shown tab is looked at by touch (client-architecture.md §7.6): the recognizer, the
// scroll with its momentum, the history rows above the buffer and the selection snapshot. All
// of it is state of one tab on a surface every tab shares, so it lives in one object that is
// told which tab is shown and drops everything when that changes or a snapshot repaints the
// pane. Nothing here outlives the view it began on: a coast, a held drag or a
// selection never reaches another tab's pane.
import type { HapticKind, InputEvent } from "../../platform/types";
import type { HistoryRow } from "../../tabs/driver";
import type { PromptLine, TerminalRenderer, TerminalTheme } from "../../term";
import { rowText } from "../../term/rows";
import { HistoryView } from "./history";
import { ScrollControl } from "./scroll";
import { SelectionControl, type MenuState } from "./selection/control";
import { TouchControl } from "./touchControl";

interface ViewDeps {
  /** The surface: the host of the renderer, the history rows and the snapshot. */
  element: HTMLElement;
  renderer(): TerminalRenderer | null;
  theme(): TerminalTheme;
  /** Scrollback rows `start..=end` of the tab shown, or null when none is live. */
  fetchHistory(start: number, end: number): Promise<HistoryRow[]> | null;
  /** Typed input for `tab`; dropped when it is no longer the one shown. */
  send(tab: string, events: InputEvent[]): void;
  haptic(kind: HapticKind): void;
  /** Desktop direct input is xterm's textarea: a touch there is a click, which focuses it. */
  directInput(): "xterm" | "owned" | "native";
  focusTerminal(): void;
  /** The shell's command line under the cursor (OSC 133), or null. */
  prompt(): PromptLine | null;
  /** The terminal's own input holds the keyboard. */
  keyboardHeld(): boolean;
  /** No input holds the keyboard. */
  keyboardDown(): boolean;
  /** Native keeps the web view's selection while a snapshot is up (`setFocus("select")`). */
  selecting(on: boolean): void;
  /** The view is above the newest line. */
  onScrolled(scrolled: boolean): void;
  /** The edit menu opened, moved or closed. */
  onMenu(menu: MenuState | null): void;
}

export class TerminalView {
  private tab: string | null = null;
  private readonly history: HistoryView;
  readonly scroll: ScrollControl;
  private readonly selection: SelectionControl;
  private readonly touch: TouchControl;

  constructor(private readonly deps: ViewDeps) {
    const { element } = deps;
    this.history = new HistoryView({
      fetch: (start, end) => deps.fetchHistory(start, end),
      scrollbackRows: () => deps.renderer()?.scrollback().rows ?? 0,
      theme: () => deps.theme(),
      onRows: () => { this.scroll.apply(); },
      bufferHead: (count) => deps.renderer()?.rows(0, count).rows.slice(0, count).map((row) => rowText(row).trimEnd()) ?? [],
    });
    element.append(this.history.element);
    this.scroll = new ScrollControl({
      renderer: () => deps.renderer(),
      history: this.history,
      send: (events) => { this.send(events); },
      onScrolled: (scrolled) => { deps.onScrolled(scrolled); },
      surfaceHeight: () => element.clientHeight,
    });
    this.selection = new SelectionControl({
      host: element,
      renderer: () => deps.renderer(),
      joinHistory: (buffer) => this.history.join(buffer),
      theme: () => deps.theme(),
      menu: (menu) => { deps.onMenu(menu); },
      selecting: (on) => { deps.selecting(on); },
    });
    // The recognizer owns every touch on the surface (§7.6): none moves focus, and what a touch means is decided when it resolves.
    this.touch = new TouchControl({ ...deps, scroll: this.scroll, selection: this.selection, send: (events) => { this.send(events); } });
    // A mouse wheel past the buffer's top goes on into the history, as a swipe does.
    element.addEventListener("wheel", this.wheel, { capture: true, passive: false });
  }

  /** The tab on screen changed: everything the last one had going stops. */
  show(tab: string | null): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.reset();
  }

  /** A snapshot repainted the pane, or the tab changed: stop the coast and any gesture, and drop the selection and the fetched history. */
  reset(): void {
    this.touch.cancel();
    this.selection.dismiss();
    this.scroll.reset();
  }

  /** Closes the selection and returns its logical text: the edit menu's Copy. */
  takeSelection(): string {
    const text = this.selection.text();
    this.selection.dismiss();
    return text;
  }

  dismissSelection(): void {
    this.selection.dismiss();
  }

  private send(events: InputEvent[]): void {
    if (this.tab !== null) this.deps.send(this.tab, events);
  }

  private readonly wheel = (event: WheelEvent): void => {
    const cell = this.deps.renderer()?.cellSize();
    if (!cell || event.deltaY === 0 || this.selection.active) return;
    // A wheel up (negative) shows older content; some wheels report lines, not pixels.
    const dy = -event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? cell.height : 1);
    if (this.scroll.wheelPastTop(dy)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
}
