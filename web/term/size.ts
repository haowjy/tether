import type { Size } from "../proto/generated/messages";
import type { Viewport } from "../platform/types";

export interface CellSize {
  width: number;
  height: number;
}

/** The tether chrome in flow around the terminal in the keyboard-hidden layout, in CSS pixels. */
export interface Chrome {
  x: number;
  y: number;
}

const MIN_SIZE: Size = { cols: 20, rows: 4 };
/** Only the trailing size is sent, so dragging a window edge doesn't resize tmux for every cell. */
const SETTLE_MS = 150;

/** Whole cells that fit in `width x height` CSS pixels. */
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
 * (plan.md "Layout", keyboard shown). `visible` is the pan area: what remains visible of
 * the terminal, not its container's height, which in the browser never shrinks.
 */
export function cursorPan(cursorRow: number, rows: number, cellHeight: number, visible: number): number {
  const overflow = rows * cellHeight - visible;
  if (overflow <= 0) return 0;
  return Math.min(overflow, Math.max(0, (cursorRow + 1) * cellHeight - visible));
}

/**
 * The one sizing formula, in every environment (client-architecture.md §5.4): the window
 * less its safe-area insets and the tether chrome around the terminal, from `stableHeight`,
 * which no software keyboard shortens. Nothing that only shows or hides changes an input.
 */
export function terminalSize(viewport: Viewport, chrome: Chrome, cell: CellSize): Size {
  const { top, right, bottom, left } = viewport.safeArea;
  return fitSize(viewport.width - left - right - chrome.x, viewport.stableHeight - top - bottom - chrome.y, cell);
}

export interface SizerOptions {
  cell(): CellSize | null;
  /** The size changed and has been stable for 150 ms. */
  onChange(size: Size): void;
  settleMs?: number;
}

/**
 * Turns the viewport, the chrome and the cell into tmux's size. Only these inputs change
 * it, so a keyboard opening never does. `claim` is always current; `onChange` fires on the
 * trailing edge, and not at all for a size a consumer already claimed.
 */
export class TerminalSizer {
  private viewport: Viewport | null = null;
  private chrome: Chrome | null = null;
  private current: Size | null = null;
  private applied: Size | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly opts: SizerOptions) {}

  /** False until the viewport, the chrome and the cell are all known: no `watch` should name a size before. */
  get measured(): boolean {
    return this.current !== null;
  }

  /** The size to watch with: the current one, which the trailing `onChange` will not repeat. */
  claim(): Size {
    const size = this.current ?? { cols: 80, rows: 24 };
    this.applied = size;
    return size;
  }

  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
    this.recompute();
  }

  setChrome(chrome: Chrome): void {
    if (this.chrome?.x === chrome.x && this.chrome.y === chrome.y) return;
    this.chrome = chrome;
    this.recompute();
  }

  /** The cell is different or newly measurable: a font-size change, or the first paint. */
  remeasure(): void {
    this.recompute();
  }

  private recompute(): void {
    const cell = this.opts.cell();
    if (!this.viewport || !this.chrome || !cell) return;
    const next = terminalSize(this.viewport, this.chrome, cell);
    const before = this.current;
    this.current = next;
    if (before?.cols === next.cols && before.rows === next.rows) return;
    clearTimeout(this.timer);
    // The first measurement is claimed by the first `watch`; later ones settle first.
    if (before === null) return;
    this.timer = setTimeout(() => {
      const size = this.current;
      if (!size || (this.applied?.cols === size.cols && this.applied.rows === size.rows)) return;
      this.applied = size;
      this.opts.onChange(size);
    }, this.opts.settleMs ?? SETTLE_MS);
  }
}
