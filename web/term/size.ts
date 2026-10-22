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

export interface SizerOptions {
  cell(): CellSize | null;
  /** Height of the tab bar and suggestion strip, which sit over the web view's bottom. */
  chromeHeight(): number;
  onChange(size: Size): void;
}

/**
 * The tmux size from native's geometry (ios-shell.md "Keyboard geometry"): the width and
 * `collapsedHeight`, never the live height. A `keyboard` viewport changes nothing, so
 * the terminal keeps its rows and the keyboard only pans it. Only `viewport` events and
 * `remeasure` recompute; `onChange` fires when cols or rows differ.
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
    const width = viewport.width - viewport.safeArea.left - viewport.safeArea.right;
    const next = fitSize(width, viewport.collapsedHeight - this.opts.chromeHeight(), cell);
    if (next.cols === this.current.cols && next.rows === this.current.rows) return;
    this.current = next;
    this.opts.onChange(next);
  }
}
