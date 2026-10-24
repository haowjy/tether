// Styled terminal text outside xterm: the rows the selection snapshot and the history view
// draw as DOM. A row is a list of runs; a run is text in one style. Pure: the DOM that draws
// them lives in the screens.
import type { TerminalTheme } from ".";

/** A palette index (0 to 255) or a CSS colour for 24-bit colour. Undefined is the default colour. */
export type Color = number | string;

export interface Style {
  fg?: Color;
  bg?: Color;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface Run {
  text: string;
  style: Style;
}

/** One physical row of the grid, as the terminal drew it. */
export interface Row {
  runs: Run[];
  /** This row continues the one above it: a soft wrap, not a line break. */
  wrapped: boolean;
  /** The row cell by cell, as the terminal laid it out (see {@link rowCells}); absent for rows read from text. */
  cells?: string[];
}

export function rowText(row: Row): string {
  return row.runs.map((run) => run.text).join("");
}

// Characters xterm gives two cells: East Asian wide and fullwidth forms, Hangul, and the
// emoji that default to emoji presentation (not © ® ™ and the like, which take one).
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]|\p{Emoji_Presentation}|[\u{20000}-\u{3fffd}]/u;

/** A row's text cell by cell: a wide character is followed by an empty cell, a combining mark joins its base. */
export function cellsOf(text: string): string[] {
  const cells: string[] = [];
  for (const char of text) {
    if (/^\p{M}$/u.test(char) && cells.length > 0) {
      let at = cells.length - 1;
      while (at > 0 && cells[at] === "") at--;
      cells[at] = (cells[at] ?? "") + char;
      continue;
    }
    cells.push(char);
    if (WIDE.test(char)) cells.push("");
  }
  return cells;
}

/** The row's cells: the terminal's own where it gave them, else worked out from the text (history rows). */
export function rowCells(row: Row): string[] {
  return row.cells ?? cellsOf(rowText(row));
}

/** Drops the blanks at the end of a row that nothing paints: a colour behind them keeps them. */
export function trimRow(runs: Run[]): void {
  const last = runs[runs.length - 1];
  if (last && last.style.bg === undefined && !last.style.inverse) {
    last.text = last.text.trimEnd();
    if (last.text === "") runs.pop();
  }
}

export function sameStyle(a: Style, b: Style): boolean {
  return a.fg === b.fg && a.bg === b.bg && !a.bold === !b.bold && !a.dim === !b.dim && !a.italic === !b.italic && !a.underline === !b.underline && !a.inverse === !b.inverse;
}

/** Appends text in a style, merging with the last run when the style is the same. */
export function pushRun(runs: Run[], text: string, style: Style): void {
  if (!text) return;
  const last = runs[runs.length - 1];
  if (last && sameStyle(last.style, style)) last.text += text;
  else runs.push({ text, style });
}

const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
const CUBE = [0, 95, 135, 175, 215, 255];

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** A colour as CSS, the first sixteen from the theme so the DOM matches the canvas. */
export function cssColor(color: Color, theme: TerminalTheme): string | undefined {
  if (typeof color === "string") return color;
  if (color < 8) return theme[ANSI[color] ?? "black"];
  if (color < 16) {
    const name = ANSI[color - 8] ?? "black";
    return theme[`bright${name[0]?.toUpperCase() ?? ""}${name.slice(1)}` as keyof TerminalTheme];
  }
  if (color < 232) {
    const n = color - 16;
    return hex(CUBE[Math.floor(n / 36)] ?? 0, CUBE[Math.floor(n / 6) % 6] ?? 0, CUBE[n % 6] ?? 0);
  }
  const gray = 8 + 10 * (color - 232);
  return hex(gray, gray, gray);
}

/** The run's look as a CSS declaration list. Inverse swaps the colours, the defaults being the theme's. */
export function styleCss(style: Style, theme: TerminalTheme): string {
  let fg = style.fg === undefined ? undefined : cssColor(style.fg, theme);
  let bg = style.bg === undefined ? undefined : cssColor(style.bg, theme);
  if (style.inverse) [fg, bg] = [bg ?? theme.background, fg ?? theme.foreground];
  const out: string[] = [];
  if (fg) out.push(`color:${fg}`);
  if (bg) out.push(`background:${bg}`);
  if (style.bold) out.push("font-weight:bold");
  if (style.dim) out.push("opacity:.6");
  if (style.italic) out.push("font-style:italic");
  if (style.underline) out.push("text-decoration:underline");
  return out.join(";");
}

const CSI = /\x1b\[([0-9;:]*)([\x40-\x7e])/g;
const decoder = new TextDecoder();

/** Applies one SGR parameter list to `style`; unknown parameters are ignored. */
function applySgr(style: Style, params: string): Style {
  let next: Style = { ...style };
  const codes = params === "" ? [0] : params.split(/[;:]/).map((p) => (p === "" ? 0 : Number(p)));
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i] ?? 0;
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 22) { delete next.bold; delete next.dim; }
    else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code === 27) delete next.inverse;
    else if ((code >= 30 && code <= 37) || (code >= 40 && code <= 47)) next[code < 40 ? "fg" : "bg"] = code % 10;
    else if ((code >= 90 && code <= 97) || (code >= 100 && code <= 107)) next[code < 100 ? "fg" : "bg"] = (code % 10) + 8;
    else if (code === 39) delete next.fg;
    else if (code === 49) delete next.bg;
    else if (code === 38 || code === 48) {
      const key = code === 38 ? "fg" : "bg";
      if (codes[i + 1] === 5) {
        next[key] = codes[i + 2] ?? 0;
        i += 2;
      } else if (codes[i + 1] === 2) {
        next[key] = hex(codes[i + 2] ?? 0, codes[i + 3] ?? 0, codes[i + 4] ?? 0);
        i += 4;
      }
    }
  }
  return next;
}

/** One row of `capture-pane -e` (history chunks): text with SGR sequences; any other escape is dropped. */
export function parseSgrRow(bytes: Uint8Array): Run[] {
  const text = decoder.decode(bytes);
  const runs: Run[] = [];
  let style: Style = {};
  let at = 0;
  for (const match of text.matchAll(CSI)) {
    pushRun(runs, text.slice(at, match.index), style);
    at = match.index + match[0].length;
    if (match[2] === "m") style = applySgr(style, match[1] ?? "");
  }
  pushRun(runs, text.slice(at), style);
  return runs;
}

/** History rows (`capture-pane -e`, one per physical row) as rows; a row wraps when the one before it continued. */
export function historyRows(rows: readonly { bytes: Uint8Array; continues: boolean }[]): Row[] {
  return rows.map((row, index) => {
    const runs = parseSgrRow(row.bytes);
    if (!row.continues) trimRow(runs);
    return { runs, wrapped: rows[index - 1]?.continues ?? false };
  });
}
