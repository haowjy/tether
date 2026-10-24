import type { IBuffer, IBufferCell } from "@xterm/xterm";
import { pushRun, trimRow, type Color, type Row, type Run, type Style } from "./rows";

function colorOf(cell: IBufferCell, side: "fg" | "bg"): Color | undefined {
  const [isDefault, isPalette, isRgb, value] =
    side === "fg"
      ? [cell.isFgDefault(), cell.isFgPalette(), cell.isFgRGB(), cell.getFgColor()]
      : [cell.isBgDefault(), cell.isBgPalette(), cell.isBgRGB(), cell.getBgColor()];
  if (isDefault) return undefined;
  if (isPalette) return value;
  return isRgb ? `#${value.toString(16).padStart(6, "0")}` : undefined;
}

function styleOf(cell: IBufferCell): Style {
  const style: Style = {};
  const fg = colorOf(cell, "fg");
  const bg = colorOf(cell, "bg");
  if (fg !== undefined) style.fg = fg;
  if (bg !== undefined) style.bg = bg;
  if (cell.isBold()) style.bold = true;
  if (cell.isDim()) style.dim = true;
  if (cell.isItalic()) style.italic = true;
  if (cell.isUnderline()) style.underline = true;
  if (cell.isInverse()) style.inverse = true;
  return style;
}

/**
 * The buffer's rows from `from` (moved up to the start of its logical line, and returned, so
 * a wrapped line is never cut) up to `to` exclusive, styled run by run. A row that nothing continues loses the blanks at its end.
 */
export function bufferRows(buffer: IBuffer, from: number, to = buffer.length): { rows: Row[]; from: number } {
  let start = Math.max(0, from);
  while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
  const rows: Row[] = [];
  let cell: IBufferCell | undefined;
  for (let y = start; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    // Past `to` only to finish a wrapped line.
    if (!line || (y >= to && !line.isWrapped)) break;
    const runs: Run[] = [];
    const cells: string[] = [];
    for (let x = 0; x < line.length; x++) {
      cell = line.getCell(x, cell);
      if (!cell) continue;
      const width = cell.getWidth();
      // The second cell of a wide character is empty in the cells and absent from the text.
      if (width === 0) {
        cells.push("");
        continue;
      }
      const chars = cell.getChars() || " ";
      cells.push(chars);
      pushRun(runs, chars, styleOf(cell));
    }
    if (!buffer.getLine(y + 1)?.isWrapped) trimRow(runs);
    rows.push({ runs, wrapped: line.isWrapped, cells });
  }
  return { rows, from: start };
}
