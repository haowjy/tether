// The renderer boundary: nothing outside term/ imports xterm.js, so ghostty-web could
// replace it (plan.md "Layout").
import type { Snapshot } from "./pipeline";
import { createXtermRenderer } from "./xterm";

export type { Snapshot };
export { createXtermRenderer };

export interface TerminalRenderer {
  /** Queue pane output behind every earlier write. */
  output(bytes: Uint8Array): void;
  /** Reset, resize and repaint once every earlier write has parsed; resolves when restored. */
  snapshot(snapshot: Snapshot): Promise<void>;
  dispose(): void;
}
