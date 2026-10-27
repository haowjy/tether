// The touch shell (client-architecture.md §7.6): pointer events in, the sans-IO recognizer in
// the middle, the terminal's side effects out. A finger on the surface is this file's alone:
// `pointerdown` is cancelled, so a touch never moves focus, lowers the keyboard, or reaches xterm
// as a mouse event; what it means is decided when it resolves (a tap near the cursor raises the keyboard).
import type { HapticKind, InputEvent } from "../../platform/types";
import type { PromptLine, TerminalRenderer } from "../../term";
import { mouseInput } from "../../term/mouse";
import { GestureRecognizer, type GestureAction } from "../../touch/gesture";
import { charsAcross } from "../../touch/selection";
import type { ScrollControl } from "./scroll";
import type { SelectionControl } from "./selection/control";

interface TouchDeps {
  element: HTMLElement;
  renderer(): TerminalRenderer | null;
  scroll: ScrollControl;
  selection: SelectionControl;
  /** Typed input for the tab this view is showing. */
  send(events: InputEvent[]): void;
  haptic(kind: HapticKind): void;
  /** Desktop direct input is xterm's textarea: a touch there is a click, which focuses it. */
  directInput(): "xterm" | "owned" | "native";
  /** Focuses the terminal's input: a desktop tap, or a touch tap on or beside the cursor row. */
  focusTerminal(): void;
  /** The shell's command line under the cursor (OSC 133), or null. */
  prompt(): PromptLine | null;
  /** The terminal's own input holds the keyboard. */
  keyboardHeld(): boolean;
  /** No input holds the keyboard. */
  keyboardDown(): boolean;
}

export class TouchControl {
  private readonly recognizer = new GestureRecognizer();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The fingers down, and the touches that belong to nobody (the one that dismissed the menu). */
  private readonly fingers = new Set<number>();
  private readonly spent = new Set<number>();
  /** Where the first finger went down: a wheel event's cell. */
  private origin = { x: 0, y: 0 };
  private scrolling = false;
  /** A long-press began a selection and the finger has not lifted. */
  private selecting = false;
  /** The touch that stopped a coasting scroll is that, and not a tap. */
  private stoppedCoast = false;

  constructor(private readonly deps: TouchDeps) {
    const { element } = deps;
    element.addEventListener("pointerdown", this.down);
    element.addEventListener("pointermove", this.move);
    element.addEventListener("pointerup", this.up);
    element.addEventListener("pointercancel", this.cancelled);
    // A finger whose pointer was taken away, or an app sent to the background mid-gesture, never lifts: end the gesture.
    element.addEventListener("lostpointercapture", this.cancelled);
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.cancel(); });
    // Android's long-press menu would fight the gesture; iOS shows no callout (CSS).
    element.addEventListener("contextmenu", (event) => { if (!this.deps.selection.owns(event.target)) event.preventDefault(); });
  }

  /** Ends any gesture in progress: a selection still being dragged goes with it. */
  cancel(): void {
    clearTimeout(this.timer);
    this.fingers.clear();
    this.spent.clear();
    this.run(this.recognizer.cancel());
    this.schedule();
  }

  private readonly down = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return; // a mouse is xterm's
    // The selection snapshot's own touches are the system's: handles, and scrolling its rows.
    if (this.deps.selection.owns(event.target)) return;
    event.preventDefault();
    if (this.fingers.size === 0 && this.deps.selection.active) {
      // The touch that closes the edit menu is that, and nothing else.
      this.deps.selection.dismiss();
      this.spent.add(event.pointerId);
      return;
    }
    if (this.fingers.size === 0) {
      this.deps.element.setPointerCapture(event.pointerId);
      this.stoppedCoast = this.deps.scroll.coasting;
      this.deps.scroll.stop();
      this.origin = { x: event.clientX, y: event.clientY };
    }
    this.fingers.add(event.pointerId);
    this.run(this.recognizer.down(event.pointerId, event.clientX, event.clientY, performance.now()));
    this.schedule();
  };

  private readonly move = (event: PointerEvent): void => {
    if (!this.fingers.has(event.pointerId)) return;
    this.run(this.recognizer.move(event.pointerId, event.clientX, event.clientY, performance.now()));
    this.schedule();
  };

  private readonly up = (event: PointerEvent): void => {
    if (this.spent.delete(event.pointerId) || !this.fingers.delete(event.pointerId)) return;
    this.run(this.recognizer.up(event.pointerId, performance.now()));
    this.schedule();
  };

  private readonly cancelled = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" || !(this.fingers.has(event.pointerId) || this.spent.has(event.pointerId))) return;
    this.cancel();
  };

  /** One timer, set to the recognizer's next deadline. */
  private schedule(): void {
    clearTimeout(this.timer);
    const deadline = this.recognizer.deadline;
    if (deadline === null) return;
    this.timer = setTimeout(() => {
      this.run(this.recognizer.advance(performance.now()));
      this.schedule();
    }, Math.max(0, deadline - performance.now()));
  }

  private run(actions: GestureAction[]): void {
    for (const action of actions) this.handle(action);
  }

  private handle(action: GestureAction): void {
    const { scroll, selection } = this.deps;
    switch (action.type) {
      case "tap":
        if (!this.stoppedCoast) this.tap(action.x, action.y);
        break;
      case "scroll":
        if (!this.scrolling) {
          this.scrolling = true;
          scroll.begin(this.deps.renderer()?.cellAt(this.origin.x, this.origin.y) ?? null);
        }
        scroll.by(action.dy);
        break;
      case "scrollEnd":
        this.scrolling = false;
        scroll.release(action.velocity);
        break;
      case "longPress":
        this.deps.haptic("rigid");
        selection.begin(action.x, action.y);
        this.selecting = true;
        break;
      case "selectMove":
        selection.extend(action.x, action.y);
        break;
      case "selectEnd":
        this.selecting = false;
        selection.release();
        break;
      case "cancel":
        this.scrolling = false;
        if (this.selecting) selection.dismiss();
        this.selecting = false;
        break;
    }
  }

  /**
   * A short press, resolved. On the cursor's row or the row above or below it, with the keyboard down, it raises the
   * keyboard for the terminal. Then a click for an application that asked for the mouse, else the prompt's cursor.
   */
  private tap(x: number, y: number): void {
    const renderer = this.deps.renderer();
    if (this.deps.directInput() === "xterm") {
      this.deps.focusTerminal();
      return;
    }
    if (!renderer || !this.deps.scroll.atLatest) return;
    const cell = renderer.cellAt(x, y);
    if (!cell) return;
    // Decided before focusing: the tap that raises the keyboard doesn't also move the cursor.
    const held = this.deps.keyboardHeld();
    if (this.deps.keyboardDown() && Math.abs(cell.row - renderer.cursor().row) <= 1) this.deps.focusTerminal();
    const mode = renderer.mouseMode();
    if (mode === "none") {
      if (held) this.moveCursorTo(cell.col, cell.row);
      return;
    }
    const events = mouseInput("tap", cell.col, cell.row, mode, renderer.mouseEncoding());
    if (events) this.deps.send(events);
  }

  /** On the prompt's input row, a tap moves the cursor there; the caller has checked that the terminal's own input held the keyboard. */
  private moveCursorTo(col: number, row: number): void {
    const renderer = this.deps.renderer();
    const line = this.deps.prompt();
    if (!renderer || !line) return;
    const cursor = renderer.cursor();
    if (row !== cursor.row || col === cursor.col) return;
    // The cursor moves a character a key, and a cell is not a character: wide text takes two cells, a combining mark none.
    const left = col < cursor.col;
    const keys = left ? charsAcross(line.before, cursor.col - col, "end") : charsAcross(line.after, col - cursor.col, "start");
    this.deps.send(Array.from({ length: keys }, () => ({ key: left ? "Left" : "Right" })));
  }
}
