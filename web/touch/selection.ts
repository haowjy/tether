// The pure rules of touch selection (client-architecture.md §7.6): which word a long-press
// lands on, which logical text a selection copies, and how much text a snapshot may hold.
// The DOM layer that shows the snapshot is `screens/terminal/selection/`.
import { cellsOf } from "../term/rows";

/** xterm's own word separators, so a word means the same on the phone as on the desktop. */
const SEPARATORS = " ()[]{}',\"`";

/** The snapshot holds the visible rows plus this many rows of scrollback and history. */
export const MAX_SNAPSHOT_HISTORY_ROWS = 2000;
export const MAX_SNAPSHOT_BYTES = 512 * 1024;

/**
 * The word under column `col` of a row, as offsets into the row's text. `cells` is the row
 * cell by cell (a wide character's second cell is the empty string). Null when the cell is
 * blank, so the long-press opens Paste alone. A separator character other than a space is a
 * one-character word.
 */
export function wordAt(cells: readonly string[], col: number): { from: number; to: number } | null {
  let at = col;
  while (at > 0 && cells[at] === "") at--; // the second half of a wide character is its first
  const here = cells[at];
  if (here === undefined || here.trim() === "") return null;
  const offsets = offsetsOf(cells);
  const length = offsets[offsets.length - 1] ?? 0;
  if (SEPARATORS.includes(here)) return { from: offsets[at] ?? 0, to: offsets[at + 1] ?? length };
  const word = (index: number): boolean => {
    const cell = cells[index];
    return cell === "" || (cell !== undefined && cell.trim() !== "" && !SEPARATORS.includes(cell));
  };
  let start = at;
  while (start > 0 && word(start - 1)) start--;
  while (start < at && cells[start] === "") start++;
  let end = at + 1;
  while (end < cells.length && word(end)) end++;
  return { from: offsets[start] ?? 0, to: offsets[end] ?? length };
}

/** Where each cell's text starts in the row's text, then the row's length. */
function offsetsOf(cells: readonly string[]): number[] {
  const offsets: number[] = [];
  let length = 0;
  for (const cell of cells) {
    offsets.push(length);
    length += cell.length;
  }
  offsets.push(length);
  return offsets;
}

/** The text of the character at column `col`, as offsets into the row's text; a column past the end is the row's end. */
export function cellSpan(cells: readonly string[], col: number): { from: number; to: number } {
  let at = Math.min(col, cells.length);
  while (at > 0 && cells[at] === "") at--; // the second half of a wide character is its first
  let next = at + 1;
  while (cells[next] === "") next++;
  const offsets = offsetsOf(cells);
  const end = offsets[offsets.length - 1] ?? 0;
  return { from: offsets[at] ?? end, to: offsets[next] ?? end };
}

export interface TextPoint {
  /** Index of the logical line. */
  line: number;
  /** Offset into that line's text. */
  offset: number;
}

/**
 * The text between two points of a snapshot's logical lines: soft wraps are already joined
 * inside a line, a break between lines is the only newline, blank lines stay, indentation
 * stays, and trailing blanks go wherever a line's end is part of the copy.
 */
export function selectedText(lines: readonly string[], from: TextPoint, to: TextPoint): string {
  const out: string[] = [];
  for (let i = from.line; i <= to.line; i++) {
    const text = lines[i] ?? "";
    const start = i === from.line ? from.offset : 0;
    const end = i === to.line ? to.offset : text.length;
    const piece = text.slice(start, end);
    out.push(end >= text.length ? piece.trimEnd() : piece);
  }
  return out.join("\n");
}

/** The index of the first of `sizes` a snapshot keeps: counting up from the last, `visibleRows` plus the row budget, and the byte budget. */
export function budgetStart(sizes: readonly { rows: number; bytes: number }[], visibleRows: number): number {
  let rows = 0;
  let bytes = 0;
  for (let i = sizes.length - 1; i >= 0; i--) {
    const size = sizes[i];
    if (!size) continue;
    rows += size.rows;
    bytes += size.bytes;
    if (rows > visibleRows + MAX_SNAPSHOT_HISTORY_ROWS || bytes > MAX_SNAPSHOT_BYTES) return i + 1;
  }
  return 0;
}

/** A snapshot's rows joined at their soft wraps. */
export interface Logical {
  /** The text of each logical line. */
  lines: string[];
  /** For each row, the logical line it belongs to. */
  lineOf: number[];
  /** For each row, where its text starts in that line. */
  startOf: number[];
}

export function logicalLines(rows: readonly { text: string; wrapped: boolean }[]): Logical {
  const logical: Logical = { lines: [], lineOf: [], startOf: [] };
  rows.forEach((row, index) => {
    if (row.wrapped && index > 0) {
      const line = logical.lines.length - 1;
      logical.lineOf.push(line);
      logical.startOf.push((logical.lines[line] ?? "").length);
      logical.lines[line] = (logical.lines[line] ?? "") + row.text;
    } else {
      logical.lineOf.push(logical.lines.length);
      logical.startOf.push(0);
      logical.lines.push(row.text);
    }
  });
  return logical;
}

/** A character `offset` into row `row`, as a point in the logical text. */
export function pointOf(logical: Logical, row: number, offset: number): TextPoint {
  return { line: logical.lineOf[row] ?? 0, offset: (logical.startOf[row] ?? 0) + offset };
}

/**
 * How many characters the cursor crosses to move `cells` columns through `text`, the text on
 * one side of it (`edge` "end": the text before the cursor, moving left; "start": after it,
 * moving right). A character the move lands inside counts whole, as the shell moves by characters.
 */
export function charsAcross(text: string, cells: number, edge: "start" | "end"): number {
  const all = cellsOf(text);
  const span = edge === "end" ? all.slice(Math.max(0, all.length - cells)) : all.slice(0, cells);
  const crossed = span.filter((cell) => cell !== "").length;
  // Landing on the second half of a wide character crosses the first half too.
  return edge === "end" && span[0] === "" ? crossed + 1 : crossed;
}
