// The renderer boundary: nothing outside term/ imports xterm.js, so ghostty-web could
// replace it (plan.md "Layout").
import type { Snapshot } from "./pipeline";
import type { RowRange } from "./buffer";
import type { CellSize } from "./size";
import type { InputSink } from "./xterm-input";
import { createXtermRenderer } from "./xterm";

export type { CellSize, InputSink, RowRange, Snapshot };
export { createXtermRenderer };

/** xterm's mouse tracking mode: `none` until the application asks for reports (seeded by the snapshot). */
export type MouseMode = "none" | "x10" | "vt200" | "drag" | "any";

/** A cell in the visible screen, zero-based from its top-left. */
export interface CellPosition {
  col: number;
  row: number;
}

type Ansi = "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white";
type ThemeKey = "background" | "foreground" | "cursor" | "cursorAccent" | "selectionBackground" | Ansi | `bright${Capitalize<Ansi>}`;

/** Terminal colours as CSS colour strings the renderer can parse (`rgba(…)`, `#rrggbb`). */
export type TerminalTheme = Partial<Record<ThemeKey, string>>;

/**
 * The shell's command line as the terminal shows it, read from the OSC 133 marks
 * (complete.md "What the client does"). Null when there is no line to read: no input-start
 * mark since the last prompt or snapshot, a command running, the alternate screen, or a
 * cursor outside the input.
 */
export interface PromptLine {
  /** From the input start to the cursor, wrapped rows joined. */
  before: string;
  /** From the cursor to the end of the input's last row, trailing spaces dropped. */
  after: string;
  /** The path of the OSC 7 that followed this prompt's start; null if none did. */
  cwd: string | null;
}

export interface RendererOptions {
  fontFamily: string;
  fontSize: number;
  theme: TerminalTheme;
  /** A URL in the output was tapped. */
  openLink(url: string): void;
}

export interface TerminalRenderer {
  /** Queue pane output behind every earlier write. */
  output(bytes: Uint8Array): void;
  /** Reset, resize and repaint once every earlier write has parsed; resolves when restored. */
  snapshot(snapshot: Snapshot): Promise<void>;
  /** One cell's size in CSS pixels, null until the first paint; changes with font size. */
  cellSize(): CellSize | null;
  setTheme(theme: TerminalTheme): void;
  /** Calls `listener` whenever the view moves onto or off the newest line. */
  onScrolledUp(listener: (scrolledUp: boolean) => void): void;
  scrollToBottom(): void;
  /** Calls `listener` whenever the {@link PromptLine} changes. */
  onPromptLine(listener: (line: PromptLine | null) => void): void;
  /** A density change: the cell, and so tmux's size, follow it. */
  setFont(fontFamily: string, fontSize: number): void;
  /** A fallback font arrived after first paint: drop the glyph atlas so its glyphs draw. */
  refreshGlyphs(): void;
  /** Points desktop direct input (xterm's own textarea, under the key-handler contract) at a sink, or turns stdin off with `null`. */
  setInput(sink: InputSink | null): void;
  /** xterm's input element, which the focus controller holds while desktop direct input is live; null before it exists. */
  inputElement(): HTMLElement | null;
  /** The selection's logical text: soft wraps joined, as xterm marks them. Empty with no selection. */
  selectionText(): string;
  /** The rows' logical text, joined by `isWrapped` and not by length (P3b's selection and copy). */
  bufferText(rows: RowRange): string;
  /** Whether the application asked for mouse reports. */
  mouseMode(): MouseMode;
  /** The cell under a client point, from measured cell metrics and the screen's position, pan included; null outside the screen. */
  cellAt(x: number, y: number): CellPosition | null;
  /** What remains visible of the terminal, in CSS pixels, for the cursor pan; null follows the container (the default). */
  setPanArea(px: number | null): void;
}
