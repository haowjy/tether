import type { TerminalTheme } from "../../../term";
import { rowText, styleCss, type Row } from "../../../term/rows";
import styles from "./Rows.module.css";

/** A row as DOM text. The container sets `--cell-height`. */
export function rowElement(row: Row, theme: TerminalTheme): HTMLDivElement {
  const element = document.createElement("div");
  element.className = styles.row ?? "";
  if (row.runs.every((run) => Object.keys(run.style).length === 0)) {
    element.textContent = rowText(row);
    return element;
  }
  for (const run of row.runs) {
    const span = document.createElement("span");
    span.textContent = run.text;
    const css = styleCss(run.style, theme);
    if (css) span.style.cssText = css;
    element.append(span);
  }
  return element;
}
