// The renderer boundary: nothing outside term/ imports xterm.js, so ghostty-web could
// replace it (plan.md "Layout").
import type { Snapshot } from "./pipeline";
import type { CellSize } from "./size";
import { createXtermRenderer } from "./xterm";

export type { CellSize, Snapshot };
export { createXtermRenderer };

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
  dispose(): void;
}
