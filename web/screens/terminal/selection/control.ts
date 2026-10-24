// Selection mode (client-architecture.md §7.6): a long-press released over text freezes the
// screen into a snapshot, selects the word under the finger in it, and leaves the rest to the
// system's selection handles. Released over a blank cell it opens the edit menu with Paste
// alone. New output goes on underneath; the snapshot is dropped on dismiss.
import type { TerminalRenderer, TerminalTheme } from "../../../term";
import { rowCells, rowText, type Row } from "../../../term/rows";
import { budgetStart, MAX_SNAPSHOT_HISTORY_ROWS, wordAt } from "../../../touch/selection";
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

export class SelectionControl {
  private layer: SelectionLayer | null = null;
  private menuOnly = false;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: SelectionDeps) {}

  get active(): boolean {
    return this.layer !== null || this.menuOnly;
  }

  /** The selected text, logical lines; empty with no selection. */
  text(): string {
    return this.layer?.text() ?? "";
  }

  /** Whether `target` is inside the snapshot, whose touches belong to the system's selection handles and scrolling. */
  owns(target: EventTarget | null): boolean {
    return target instanceof Node && this.layer?.element.contains(target) === true;
  }

  /** A long-press ended at the client point (`x`, `y`). */
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
    this.deps.selecting(true);
    if (!word) {
      this.menuOnly = true;
      const surface = (host.parentElement ?? host).getBoundingClientRect();
      this.deps.menu({ x: x - surface.left, top: y - surface.top - cell.height, bottom: y - surface.top + cell.height, below: y - surface.top < MENU_ROOM + cell.height, selection: false });
      return;
    }
    const layer = new SelectionLayer(rows, this.deps.theme(), cell.height);
    this.layer = layer;
    host.append(layer.element);
    layer.align(topRow);
    layer.select(index, word.from, word.to);
    this.unsubscribe = layer.onChange(() => { this.changed(); });
    document.addEventListener("keydown", this.escape);
    this.changed();
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
    this.menuOnly = false;
    if (!wasActive) return;
    this.deps.menu(null);
    this.deps.selecting(false);
  }

  private changed(): void {
    const layer = this.layer;
    if (!layer) return;
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
