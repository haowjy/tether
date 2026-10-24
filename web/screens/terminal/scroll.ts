// Touch scrolling (client-architecture.md §7.6). The finger drives it and a release carries on
// with momentum; a mouse wheel past the buffer's top joins it. On the normal screen the buffer
// scrolls, and past its top the terminal slides down onto the history view; in a full-screen
// or mouse-aware application the same motion becomes wheel events, or ↑/↓ when the application
// has no mouse mode, since that application owns its own scrolling. Swiping down shows older
// content in both.
import type { InputEvent } from "../../platform/types";
import type { CellPosition, TerminalRenderer } from "../../term";
import { mouseInput } from "../../term/mouse";
import type { CellSize } from "../../term/size";
import { Momentum } from "../../touch/momentum";
import type { HistoryView } from "./history";

/** Wheel events or arrows sent in one frame at most, so a hard flick never floods the pane. */
const MAX_EVENTS_PER_FRAME = 4;

interface ScrollDeps {
  renderer(): TerminalRenderer | null;
  history: HistoryView;
  /** Typed input for the tab this view is showing. */
  send(events: InputEvent[]): void;
  /** The view moved onto or off the newest line. */
  onScrolled(scrolled: boolean): void;
  /** The height of the surface the terminal and the history share, in px. */
  surfaceHeight(): number;
}

export class ScrollControl {
  /** How far the terminal is slid down onto the history, in px. */
  private shift = 0;
  /** The part of a row not yet scrolled, in px; the buffer moves whole rows. */
  private remainder = 0;
  private momentum: Momentum | null = null;
  private frame = 0;
  private last = 0;
  /** Where the gesture began, for a wheel event's cell. */
  private anchor: CellPosition = { col: 0, row: 0 };
  private app = false;
  /** The cell and the screen's row count, measured when a gesture begins: a frame of momentum measures nothing. */
  private cell: CellSize | null = null;
  private screenRows = 0;
  /** Whether the view was above the newest line when last reported. */
  private scrolled = false;

  constructor(private readonly deps: ScrollDeps) {}

  /** Whether a fling is still coasting: a touch then stops it, and is not a tap. */
  get coasting(): boolean {
    return this.momentum !== null;
  }

  /** A finger went down on the scrolling surface. */
  begin(anchor: CellPosition | null): void {
    this.stop();
    this.remainder = 0;
    this.measure();
    if (anchor) this.anchor = anchor;
    const renderer = this.deps.renderer();
    this.app = renderer !== null && (renderer.altScreen() || renderer.mouseMode() !== "none");
  }

  /** The finger moved `dy` px downward. */
  by(dy: number): void {
    if (!this.cell) return;
    if (this.app) this.wheel(dy, this.cell, Infinity);
    else this.buffer(dy, this.cell);
  }

  /**
   * A mouse wheel turned `dy` px toward older content. The buffer scrolls itself; this takes
   * the wheel only once it is past the buffer's top or already in the history, and says so.
   */
  wheelPastTop(dy: number): boolean {
    const renderer = this.deps.renderer();
    if (!renderer || renderer.altScreen() || renderer.mouseMode() !== "none") return false;
    const { rows, up } = renderer.scrollback();
    if (this.shift === 0 && !(dy > 0 && up === rows)) return false;
    this.stop();
    this.measure();
    this.app = false;
    this.by(dy);
    return true;
  }

  /** The finger lifted at `velocity` px/s downward: coast. */
  release(velocity: number): void {
    const momentum = new Momentum(velocity);
    if (momentum.done) return;
    this.momentum = momentum;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  /** Leaves history for the newest line. */
  toLatest(): void {
    this.stop();
    this.measure();
    this.shift = 0;
    this.remainder = 0;
    this.deps.renderer()?.scrollToBottom();
    this.apply();
  }

  /** A snapshot repainted the pane, or another tab came to the surface: nothing slid or fetched belongs to it. */
  reset(): void {
    this.stop();
    this.shift = 0;
    this.remainder = 0;
    this.cell = null;
    this.deps.history.reset();
    this.scrolled = false;
    this.deps.renderer()?.shift(0);
    this.scrolledChanged();
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.momentum = null;
  }

  /** The view is on the newest line. */
  get atLatest(): boolean {
    return this.shift === 0 && (this.deps.renderer()?.scrollback().up ?? 0) === 0;
  }

  /**
   * The view may have moved onto or off the newest line, by a finger, a wheel, a key or new
   * output: the jump-to-latest control follows. Back on the newest line the fetched rows are
   * dead weight, and scrolling up again fetches them afresh.
   */
  scrolledChanged(): void {
    const scrolled = !this.atLatest;
    if (this.scrolled && !scrolled) this.deps.history.reset();
    this.scrolled = scrolled;
    this.deps.onScrolled(scrolled);
  }

  private measure(): void {
    this.cell = this.deps.renderer()?.cellSize() ?? null;
    this.screenRows = this.cell ? Math.ceil(this.deps.surfaceHeight() / this.cell.height) : 0;
  }

  private readonly tick = (now: number): void => {
    const momentum = this.momentum;
    const cell = this.cell;
    if (!momentum || !cell) return;
    const moved = this.app ? this.wheel(momentum.step(now - this.last), cell, MAX_EVENTS_PER_FRAME) : this.buffer(momentum.step(now - this.last), cell);
    this.last = now;
    if (momentum.done || !moved) this.momentum = null;
    else this.frame = requestAnimationFrame(this.tick);
  };

  /** The distance from the newest line, in px: the buffer's rows, the part row, and the slide onto the history. */
  private position(renderer: TerminalRenderer, cell: CellSize): number {
    return renderer.scrollback().up * cell.height + this.remainder + this.shift;
  }

  /** Scrolls the buffer, then the history. False when `dy` could not move anything: an edge. */
  private buffer(dy: number, cell: CellSize): boolean {
    const renderer = this.deps.renderer();
    if (!renderer || dy === 0) return true;
    const before = this.position(renderer, cell);
    let pending = dy;
    if (pending < 0 && this.shift > 0) {
      // Newer: back out of the history first.
      const back = Math.min(this.shift, -pending);
      this.shift -= back;
      pending += back;
    }
    if (pending !== 0 && this.shift === 0) {
      this.remainder += pending;
      const rows = Math.trunc(this.remainder / cell.height);
      if (rows !== 0) {
        this.remainder -= rows * cell.height;
        const short = rows + renderer.scrollRows(-rows); // rows the buffer could not take
        if (short > 0) {
          // Past the buffer's top: the rest slides the terminal onto the history.
          this.shift = Math.min(short * cell.height + this.remainder, this.deps.history.px);
          this.remainder = 0;
        } else if (short < 0) {
          this.remainder = 0; // the newest line
        }
      }
    } else if (pending > 0) {
      this.shift = Math.min(this.shift + pending, this.deps.history.px);
    }
    this.apply();
    return this.position(renderer, cell) !== before;
  }

  /** The slide, the history rows' place and the fetch ahead of the view, after any of them changed. */
  apply(): void {
    const renderer = this.deps.renderer();
    const cell = this.cell;
    if (!renderer || !cell) return;
    // The history may have been dropped under the view (its rows no longer lined up).
    this.shift = Math.min(this.shift, this.deps.history.px);
    renderer.shift(this.shift);
    this.deps.history.place(this.shift, cell.height);
    // A first swipe up on a short buffer is still at latest and needs the fetch; coming back to latest does not.
    const returned = this.scrolled && this.atLatest;
    this.scrolledChanged();
    if (!returned) this.deps.history.want(this.shift, renderer.viewportTop() * cell.height, cell.height, this.screenRows);
  }

  /** Wheel events (or arrows) for `dy` px; returns whether any row's worth was due. */
  private wheel(dy: number, cell: CellSize, cap: number): boolean {
    const renderer = this.deps.renderer();
    if (!renderer) return false;
    this.remainder += dy;
    let rows = Math.trunc(this.remainder / cell.height);
    this.remainder -= rows * cell.height;
    if (rows === 0) return true;
    const up = rows > 0; // the finger moved down: older content, the wheel turns up
    rows = Math.min(Math.abs(rows), cap);
    const events = mouseInput(up ? "wheelUp" : "wheelDown", this.anchor.col, this.anchor.row, renderer.mouseMode(), renderer.mouseEncoding()) ?? [{ key: up ? "Up" : "Down" }];
    this.deps.send(Array.from({ length: rows }, () => events).flat());
    return true;
  }
}
