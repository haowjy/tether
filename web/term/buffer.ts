import type { IBuffer } from "@xterm/xterm";

/** Buffer rows `from` up to, not including, `to`, counted from the top of the scrollback. */
export interface RowRange {
  from: number;
  to: number;
}

/**
 * The rows' logical text (terminal-interaction-design.md "Copy logical terminal text"): a
 * row marked `isWrapped` continues the line above it, so soft wraps join with no newline
 * and trailing blanks are dropped only where a logical line ends. A hard break at the exact
 * last column stays a break, because only a wrap marks `isWrapped`.
 */
export function bufferText(buffer: Pick<IBuffer, "getLine">, { from, to }: RowRange): string {
  const lines: string[] = [];
  let logical = "";
  for (let y = from; y < to; y++) {
    const row = buffer.getLine(y);
    if (!row) break;
    logical += row.translateToString(false);
    if (y + 1 < to && buffer.getLine(y + 1)?.isWrapped) continue;
    lines.push(logical.trimEnd());
    logical = "";
  }
  return lines.join("\n");
}
