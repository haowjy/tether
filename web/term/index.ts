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
  dispose(): void;
}
