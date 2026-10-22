import type { IBuffer, IMarker, Terminal } from "@xterm/xterm";
import type { PromptLine } from ".";

/** Where the typed input starts: a marker on its row, so scrolling keeps it right, and the column. */
interface InputStart {
  marker: IMarker;
  col: number;
}

/**
 * Follows the shell's OSC 133 and OSC 7 marks (complete.md "The shell snippet") and reads
 * the command line from the buffer between the input start (B) and the cursor. A prompt
 * (A), an accepted line (C), the end of a command (D) and a reset all forget the input
 * start, so with no fresh B there is no line rather than a guess.
 */
export class PromptTracker {
  private start: InputStart | null = null;
  private cwd: string | null = null;
  private last: PromptLine | null = null;
  private readonly listeners: ((line: PromptLine | null) => void)[] = [];

  constructor(private readonly term: Terminal) {
    term.parser.registerOscHandler(133, (data) => {
      this.mark(data.split(";", 1)[0] ?? "");
      return true;
    });
    term.parser.registerOscHandler(7, (data) => {
      this.cwd = osc7Path(data) ?? this.cwd;
      return true;
    });
    term.onWriteParsed(() => { this.check(); });
    term.onCursorMove(() => { this.check(); });
    term.buffer.onBufferChange(() => { this.check(); });
  }

  onLine(listener: (line: PromptLine | null) => void): void {
    this.listeners.push(listener);
  }

  /** The screen is about to be repainted from a snapshot, which carries no marks. */
  reset(): void {
    this.forget();
    this.cwd = null;
    this.check();
  }

  private mark(kind: string): void {
    if (kind === "A") {
      this.forget();
      this.cwd = null; // only an OSC 7 after this prompt's start counts
    } else if (kind === "B") {
      this.forget();
      const buffer = this.term.buffer.active;
      if (buffer.type === "normal") this.start = { marker: this.term.registerMarker(0), col: buffer.cursorX };
    } else if (kind === "C" || kind === "D") {
      this.forget();
    }
  }

  private forget(): void {
    this.start?.marker.dispose();
    this.start = null;
  }

  private check(): void {
    const line = this.read();
    if (line === this.last || (line && this.last && line.before === this.last.before && line.after === this.last.after && line.cwd === this.last.cwd)) return;
    this.last = line;
    for (const listener of this.listeners) listener(line);
  }

  private read(): PromptLine | null {
    const buffer = this.term.buffer.active;
    const start = this.start;
    if (buffer.type !== "normal" || !start || start.marker.isDisposed || start.marker.line < 0) return null;
    const cursorRow = buffer.baseY + buffer.cursorY;
    const before = rowsText(buffer, start.marker.line, start.col, cursorRow, buffer.cursorX, this.term.cols);
    if (before === null) return null;
    // `after` runs to the end of the cursor's row and every row wrapped onto it.
    let lastRow = cursorRow;
    while (buffer.getLine(lastRow + 1)?.isWrapped) lastRow++;
    const after = rowsText(buffer, cursorRow, buffer.cursorX, lastRow, this.term.cols, this.term.cols);
    if (after === null) return null;
    return { before, after: after.trimEnd(), cwd: this.cwd };
  }
}

/**
 * The text from (`fromRow`, `fromCol`) to (`toRow`, `toCol`), or null when that range runs
 * backwards or crosses a row that isn't wrapped from the one before it: a cursor before the
 * input start, or a continuation prompt, isn't a line this can read.
 */
function rowsText(buffer: IBuffer, fromRow: number, fromCol: number, toRow: number, toCol: number, cols: number): string | null {
  if (toRow < fromRow || (toRow === fromRow && toCol < fromCol)) return null;
  let text = "";
  for (let row = fromRow; row <= toRow; row++) {
    const line = buffer.getLine(row);
    if (!line || (row > fromRow && !line.isWrapped)) return null;
    text += line.translateToString(false, row === fromRow ? fromCol : 0, row === toRow ? toCol : cols);
  }
  return text;
}

/** `file://host/a%20b` → `/a b`; the host is ignored. Null for anything else. */
function osc7Path(data: string): string | null {
  try {
    const url = new URL(data);
    return url.protocol === "file:" && url.pathname.startsWith("/") ? decodeURIComponent(url.pathname) : null;
  } catch {
    return null;
  }
}
