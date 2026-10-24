import type { TerminalTheme } from "../../../term";
import { rowText, type Row } from "../../../term/rows";
import { logicalLines, pointOf, selectedText, type Logical } from "../../../touch/selection";
import { rowElement } from "../rows/rowsDom";
import styles from "./SelectionLayer.module.css";

/** A boundary of the DOM selection, as a row and a character offset in that row's text. */
interface RowPoint {
  row: number;
  offset: number;
}

/**
 * The snapshot as DOM: one element per row, text only the system's selection handles can
 * work on. It holds the rows it was made from and nothing live, so new output cannot reach
 * it, and dropping it frees them.
 */
export class SelectionLayer {
  readonly element: HTMLDivElement = document.createElement("div");
  private readonly rows: HTMLDivElement[];
  private readonly logical: Logical;

  constructor(rows: readonly Row[], theme: TerminalTheme, readonly cellHeight: number) {
    this.element.className = styles.layer ?? "";
    this.element.style.setProperty("--cell-height", `${String(cellHeight)}px`);
    this.element.setAttribute("role", "document");
    this.element.setAttribute("aria-label", "Terminal text for selection");
    this.rows = rows.map((row, index) => {
      const element = rowElement(row, theme);
      element.dataset["row"] = String(index);
      return element;
    });
    this.element.append(...this.rows);
    this.logical = logicalLines(rows.map((row) => ({ text: rowText(row), wrapped: row.wrapped })));
  }

  /**
   * Scrolls so the row `top` (fractional) is at the layer's top edge. The rows end where the
   * screen's do, so below them it pads out whatever the scroll needs to get there.
   */
  align(top: number): void {
    const scroll = top * this.cellHeight;
    this.element.style.paddingBottom = `${String(Math.max(0, scroll + this.element.clientHeight - this.rows.length * this.cellHeight))}px`;
    this.element.scrollTop = scroll;
  }

  /** Selects characters `from` to `to` of one row's text. */
  select(row: number, from: number, to: number): void {
    const element = this.rows[row];
    const start = element && locate(element, from);
    const end = element && locate(element, to);
    const selection = getSelection();
    if (!start || !end || !selection) return;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /** The selection's logical text, soft wraps joined; empty when nothing inside the snapshot is selected. */
  text(): string {
    const range = this.range();
    if (!range) return "";
    const start = this.pointOf(range.startContainer, range.startOffset);
    const end = this.pointOf(range.endContainer, range.endOffset);
    if (!start || !end) return "";
    return selectedText(this.logical.lines, pointOf(this.logical, start.row, start.offset), pointOf(this.logical, end.row, end.offset));
  }

  /** Where the selection is on screen, or null with none. */
  rect(): DOMRect | null {
    return this.range()?.getBoundingClientRect() ?? null;
  }

  /** Calls `listener` whenever the selection inside the snapshot changes or is lost. */
  onChange(listener: () => void): () => void {
    const handler = (): void => { listener(); };
    document.addEventListener("selectionchange", handler);
    this.element.addEventListener("scroll", handler, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", handler);
      this.element.removeEventListener("scroll", handler);
    };
  }

  /** Whether the selection is a non-empty range inside the snapshot. */
  hasSelection(): boolean {
    return this.range() !== null;
  }

  private range(): Range | null {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    return this.element.contains(range.commonAncestorContainer) ? range : null;
  }

  /** A DOM boundary as a row and a character offset; boundaries on the layer itself or a row element count children. */
  private pointOf(node: Node, offset: number): RowPoint | null {
    if (node === this.element) return offset >= this.rows.length ? { row: this.rows.length - 1, offset: this.rows[this.rows.length - 1]?.textContent.length ?? 0 } : { row: offset, offset: 0 };
    const element = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-row]");
    if (!element || !this.element.contains(element)) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(node, offset);
    return { row: Number(element.dataset["row"]), offset: range.toString().length };
  }
}

/** The text node and offset where character `offset` of the element's text is. */
function locate(element: HTMLElement, offset: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    last = text;
    if (remaining <= text.length) return { node: text, offset: remaining };
    remaining -= text.length;
  }
  return last ? { node: last, offset: last.length } : { node: element, offset: 0 };
}
