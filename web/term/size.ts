import type { Size } from "../proto/generated/messages";
import type { Viewport } from "../native/bridge";

export interface CellSize {
  width: number;
  height: number;
}

/** Before native's first `viewport`, and when the cell can't be measured yet. */
const DEFAULT_SIZE: Size = { cols: 80, rows: 24 };
const MIN_SIZE: Size = { cols: 20, rows: 4 };

/** Whole cells that fit in `width × height` CSS pixels. */
export function fitSize(width: number, height: number, cell: CellSize): Size {
  return {
    cols: Math.max(MIN_SIZE.cols, Math.floor(width / cell.width)),
    rows: Math.max(MIN_SIZE.rows, Math.floor(height / cell.height)),
  };
}

/**
 * How far to slide the terminal up, in CSS pixels, so the cursor row's bottom sits at the
 * bottom of the `visible` height: never down, never past the last row. The keyboard
 * shortens the view without resizing tmux, so the rows above are covered instead
 * (plan.md "Layout", keyboard shown).
 */
export function cursorPan(cursorRow: number, rows: number, cellHeight: number, visible: number): number {
  const overflow = rows * cellHeight - visible;
  if (overflow <= 0) return 0;
  return Math.min(overflow, Math.max(0, (cursorRow + 1) * cellHeight - visible));
}

export interface SizerOptions {
  cell(): CellSize | null;
  /** The least gap between the text and each side of the screen; a side's safe-area inset counts toward it. */
  edge(): number;
  /** Height of the tab bar and suggestion strip, without the safe-area insets. */
  chromeHeight(): number;
  onChange(size: Size): void;
}

/**
 * The tmux size from native's geometry (ios-shell.md "Keyboard geometry"): the width and
 * `collapsedHeight`, never the live height, less every safe-area inset: the terminal sits
 * inside all four (plan.md "Layout"), and at least `edge` from each side. A `keyboard`
 * viewport changes nothing, so the terminal keeps its rows and the keyboard only pans it
 * ({@link cursorPan}). Only `viewport` events and `remeasure` recompute; `onChange` fires
 * when cols or rows differ.
 */
export class TerminalSizer {
  private viewport: Viewport | null = null;
  private current: Size = DEFAULT_SIZE;

  constructor(private readonly opts: SizerOptions) {}

  get size(): Size {
    return this.current;
  }

  setViewport(viewport: Viewport): void {
    const first = this.viewport === null;
    this.viewport = viewport;
    if (first || viewport.reason !== "keyboard") this.recompute();
  }

  /** The cell is different or newly measurable: a font-size change, or the first paint. */
  remeasure(): void {
    this.recompute();
  }

  private recompute(): void {
    const { viewport } = this;
    const cell = this.opts.cell();
    if (!viewport || !cell) return;
    const { top, right, bottom, left } = viewport.safeArea;
    const edge = this.opts.edge();
    const next = fitSize(viewport.width - Math.max(left, edge) - Math.max(right, edge), viewport.collapsedHeight - top - bottom - this.opts.chromeHeight(), cell);
    if (next.cols === this.current.cols && next.rows === this.current.rows) return;
    this.current = next;
    this.opts.onChange(next);
  }
}
