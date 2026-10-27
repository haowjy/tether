// Selection mode (client-architecture.md §7.6): a long-press over text freezes the screen
// into a snapshot and selects the word under the finger in it at once; the finger, still down,
// drags the far end of the selection along; lifting it shows the edit menu and leaves the rest
// to the system's selection handles. A long-press over a blank cell opens the edit menu with
// Paste alone on release. New output goes on underneath; the snapshot is dropped on dismiss.
import type { TerminalRenderer, TerminalTheme } from "../../../term";
import { rowCells, rowText, type Row } from "../../../term/rows";
import { budgetStart, cellSpan, MAX_SNAPSHOT_HISTORY_ROWS, wordAt } from "../../../touch/selection";
import { SelectionLayer } from "./SelectionLayer";

/** The edit menu: where it points, in the surface's coordinates, and whether there is a selection to copy. */
export interface MenuState {
  x: number;
  /** The menu sits above `top`, or below `bottom` when there is no room above. */
  top: number;
  bottom: number;
  below: boolean;
  selection: boolean;
}

/** Room the menu needs above the selection, in px. */
const MENU_ROOM = 56;

interface SelectionDeps {
  host: HTMLElement;
  renderer(): TerminalRenderer | null;
  /** The history view's rows above the buffer's, joined to them. */
  joinHistory(buffer: readonly Row[]): Row[];
  theme(): TerminalTheme;
  menu(menu: MenuState | null): void;
  /** Native keeps the web view's selection while this is on (`setFocus("select")`). */
  selecting(on: boolean): void;
}

/** What a drag needs of the long-press that began the selection. */
interface Drag {
  rows: readonly Row[];
  /** The (fractional) row at the top of the host, and the screen's left edge and cell size, to turn a finger into a cell. */
  topRow: number;
  hostTop: number;
  left: number;
  cell: { width: number; height: number };
  /** The word the long-press landed on: one end of the selection stays inside it. */
  anchor: { row: number; from: number; to: number };
}

export class SelectionControl {
  private layer: SelectionLayer | null = null;
  private menuOnly: { x: number; y: number } | null = null;
  private drag: Drag | null = null;
  /** The finger has lifted: until then the menu stays down. */
  private released = false;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: SelectionDeps) {}

  get active(): boolean {
    return this.layer !== null || this.menuOnly !== null;
  }

  /** The selected text, logical lines; empty with no selection. */
  text(): string {
    return this.layer?.text() ?? "";
  }

  /** Whether `target` is inside the snapshot, whose touches belong to the system's selection handles and scrolling. */
  owns(target: EventTarget | null): boolean {
    return target instanceof Node && this.layer?.element.contains(target) === true;
  }

  /** A long-press fired at the client point (`x`, `y`): select the word there. */
  begin(x: number, y: number): void {
    const { host } = this.deps;
    const renderer = this.deps.renderer();
    const cell = renderer?.cellSize();
    const origin = renderer?.screenOrigin();
    if (!renderer || !cell || !origin) return;
    this.dismiss();
    const alt = renderer.altScreen();
    const top = renderer.viewportTop();
    const hostRect = host.getBoundingClientRect();
    const visible = Math.ceil(hostRect.height / cell.height);
    // The window is anchored on what is in view: from MAX_SNAPSHOT_HISTORY_ROWS above its top to a row below its bottom.
    // On the normal screen with the whole buffer in, what was fetched above it joins in.
    const { rows: buffer, from } = renderer.rows(alt ? 0 : Math.max(0, top - MAX_SNAPSHOT_HISTORY_ROWS), alt ? undefined : top + visible + 1);
    let rows = alt || from > 0 ? buffer : this.deps.joinHistory(buffer);
    const history = rows.length - buffer.length;
    const keep = keepFrom(rows, visible);
    rows = rows.slice(keep);
    // The row at the top of the host: the screen's first, less the rows the history slide or the pan moved it by.
    const topRow = history + (top - from) - keep + (hostRect.top - origin.top) / cell.height;
    const index = Math.floor(topRow + (y - hostRect.top) / cell.height);
    const row = rows[index];
    const word = row && wordAt(rowCells(row), Math.floor((x - origin.left) / cell.width));
    this.released = false;
    if (!word) {
      this.menuOnly = { x, y };
      return;
    }
    const layer = new SelectionLayer(rows, this.deps.theme(), cell.height);
    this.layer = layer;
    this.drag = { rows, topRow, hostTop: hostRect.top, left: origin.left, cell, anchor: { row: index, from: word.from, to: word.to } };
    host.append(layer.element);
    layer.align(topRow);
    layer.select({ row: index, offset: word.from }, { row: index, offset: word.to });
    this.unsubscribe = layer.onChange(() => { this.changed(); });
    document.addEventListener("keydown", this.escape);
  }

  /** The held finger moved to (`x`, `y`): the selection's far end follows it, by cell. */
  extend(x: number, y: number): void {
    const { layer, drag } = this;
    if (!layer || !drag) return;
    const { anchor } = drag;
    const last = drag.rows.length - 1;
    const row = Math.max(0, Math.min(last, Math.floor(drag.topRow + (y - drag.hostTop) / drag.cell.height)));
    const cells = rowCells(drag.rows[row] as Row);
    const at = cellSpan(cells, Math.max(0, Math.floor((x - drag.left) / drag.cell.width)));
    const before = row < anchor.row || (row === anchor.row && at.from < anchor.from);
    layer.select(before ? { row, offset: at.from } : { row: anchor.row, offset: anchor.from }, before ? { row: anchor.row, offset: anchor.to } : { row, offset: row === anchor.row ? Math.max(at.to, anchor.to) : at.to });
  }

  /** The finger lifted: the edit menu opens on what is selected, or over a blank cell. */
  release(): void {
    this.released = true;
    // Native hands the touch to the web view's selection only now: while the finger is down the host owns it.
    this.deps.selecting(true);
    this.layer?.element.removeAttribute("data-held");
    const { menuOnly } = this;
    if (!menuOnly) {
      this.changed();
      return;
    }
    const { host } = this.deps;
    const height = this.deps.renderer()?.cellSize()?.height ?? 0;
    const surface = (host.parentElement ?? host).getBoundingClientRect();
    this.deps.menu({ x: menuOnly.x - surface.left, top: menuOnly.y - surface.top - height, bottom: menuOnly.y - surface.top + height, below: menuOnly.y - surface.top < MENU_ROOM + height, selection: false });
  }

  dismiss(): void {
    const wasActive = this.active;
    this.unsubscribe?.();
    this.unsubscribe = null;
    document.removeEventListener("keydown", this.escape);
    if (this.layer) {
      getSelection()?.removeAllRanges();
      this.layer.element.remove();
    }
    this.layer = null;
    this.drag = null;
    this.menuOnly = null;
    if (!wasActive) return;
    this.deps.menu(null);
    this.deps.selecting(false);
  }

  private changed(): void {
    const layer = this.layer;
    if (!layer || !this.released) return;
    // A tap on the snapshot, or anywhere that clears the selection, ends the mode.
    if (!layer.hasSelection()) {
      this.dismiss();
      return;
    }
    const rect = layer.rect();
    if (!rect) return;
    const surface = (this.deps.host.parentElement ?? this.deps.host).getBoundingClientRect();
    const top = rect.top - surface.top;
    this.deps.menu({ x: (rect.left + rect.right) / 2 - surface.left, top, bottom: rect.bottom - surface.top, below: top < MENU_ROOM, selection: true });
  }

  private readonly escape = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.dismiss();
  };
}

/** Where the snapshot starts: `rows` end at the view's bottom, so this is the budget's worth of rows above it, never inside a wrapped line. */
function keepFrom(rows: readonly Row[], visibleRows: number): number {
  let keep = budgetStart(rows.map((row) => ({ rows: 1, bytes: rowText(row).length })), visibleRows);
  while (rows[keep]?.wrapped) keep++;
  return keep;
}
