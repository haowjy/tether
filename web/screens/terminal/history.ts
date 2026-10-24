// The history view (client-architecture.md §7.6, plan.md "Scroll"): xterm.js cannot prepend
// lines, so the scrollback above its buffer, which only tmux has, is fetched on demand and
// drawn as DOM rows directly above the terminal. Scrolling past the buffer's top slides the
// terminal down and these rows in; nothing is fetched until someone scrolls there.
import type { HistoryRow } from "../../tabs/driver";
import type { TerminalTheme } from "../../term";
import { historyRows, rowText, type Row } from "../../term/rows";
import { ANCHOR_ROWS, locateRun } from "./anchor";
import { rowElement } from "./rows/rowsDom";
import styles from "./rows/Rows.module.css";

/** Rows per request ("about 200 lines a request"). */
const CHUNK = 200;
/** Fetch the next chunk when less than this many screens of fetched rows remain above the view. */
const PREFETCH_SCREENS = 2;
/** The most rows kept; a phone doesn't need more DOM than this. */
const MAX_ROWS = 10_000;
/** A request that failed (the watch ended, or the daemon was busy) is not repeated sooner than this. */
const RETRY_MS = 1500;

export interface HistoryDeps {
  /** Rows `start..=end` of the tab on screen (tmux line numbers), or null with no live tab. */
  fetch(start: number, end: number): Promise<HistoryRow[]> | null;
  /** Scrollback rows xterm holds now: tmux's history above them is what this view shows. */
  scrollbackRows(): number;
  /** The text of the first `count` rows of xterm's buffer. */
  bufferHead(count: number): string[];
  theme(): TerminalTheme;
  /** Rows were added or dropped: the owner may now scroll further, or must scroll back. */
  onRows(): void;
}

const texts = (row: Row): string => rowText(row).trimEnd();

export class HistoryView {
  readonly element: HTMLDivElement = document.createElement("div");
  private rows: Row[] = [];
  /** The newest row continues into the buffer's first row: a soft wrap across the seam. */
  private joinsBuffer = false;
  private loading = false;
  private retryAt = 0;
  /** Reached tmux's oldest row, or the cap. */
  private exhausted = false;
  /** The tmux line number of the oldest row fetched, and how many scrollback rows xterm held then. */
  private top = 0;
  private baseThen = 0;
  private generation = 0;
  private height = 0;

  constructor(private readonly deps: HistoryDeps) {
    this.element.className = styles.history ?? "";
    this.element.style.display = "none";
    this.element.setAttribute("aria-hidden", "true");
    this.element.dataset["history"] = "";
  }

  /** Rows fetched so far, in px. */
  get px(): number {
    return this.height;
  }

  /**
   * The fetched rows above `buffer`'s rows, joined to them: the selection snapshot's text.
   * `buffer` must start at the top of xterm's buffer, which the newest history row sits above;
   * a soft wrap across that seam is kept.
   */
  join(buffer: readonly Row[]): Row[] {
    const [first, ...rest] = buffer;
    return first && this.joinsBuffer ? [...this.rows, { ...first, wrapped: true }, ...rest] : [...this.rows, ...buffer];
  }

  /** The pane was repainted from a snapshot, or the tab changed: what was fetched no longer sits above this buffer. */
  reset(): void {
    this.generation++;
    this.rows = [];
    this.joinsBuffer = false;
    this.loading = false;
    this.retryAt = 0;
    this.exhausted = false;
    this.height = 0;
    this.element.replaceChildren();
    this.element.style.display = "none";
  }

  /** Where the view sits: its bottom edge on the terminal's top edge, which `shift` px below the host's. */
  place(shift: number, cellHeight: number): void {
    this.element.style.setProperty("--cell-height", `${String(cellHeight)}px`);
    this.element.style.display = shift > 0 ? "" : "none";
    this.element.style.translate = `0 ${String(shift - this.height)}px`;
  }

  /** The view is `shift` px into the history, with `buffer` px of xterm's scrollback above it: fetch before it runs out. */
  want(shift: number, buffer: number, cellHeight: number, screenRows: number): void {
    if (this.loading || this.exhausted || performance.now() < this.retryAt) return;
    if (buffer + this.height - shift < PREFETCH_SCREENS * screenRows * cellHeight) void this.load(cellHeight);
  }

  private async load(cellHeight: number): Promise<void> {
    const generation = this.generation;
    const base = this.deps.scrollbackRows();
    const first = this.rows.length === 0;
    // Lines are numbered from the newest, so what was fetched has moved up by the rows tmux gained since.
    // The chunk reaches ANCHOR_ROWS past where the known rows should end, and finds them there: the first
    // chunk's newest rows against xterm's first, the later ones against the oldest fetched.
    const anchor = first ? this.deps.bufferHead(Math.min(ANCHOR_ROWS, base)) : this.rows.slice(0, ANCHOR_ROWS).map(rowText);
    const expectedTop = first ? -(base + 1) : this.top - (base - this.baseThen);
    const end = expectedTop + anchor.length - (first ? 0 : 1);
    const pending = this.deps.fetch(end - CHUNK + 1, end);
    if (!pending) return;
    this.loading = true;
    let fetched: HistoryRow[];
    try {
      fetched = await pending;
    } catch {
      if (generation === this.generation) {
        this.loading = false;
        this.retryAt = performance.now() + RETRY_MS;
      }
      return;
    }
    if (generation !== this.generation) return;
    this.loading = false;
    const all = historyRows(fetched);
    // Where the anchor starts in the chunk, and where it would if nothing moved. A first chunk that does not
    // show xterm's rows (its text differs) is taken as it falls; a later one that does not show the known rows
    // means they no longer line up.
    const expected = fetched.length - anchor.length;
    const found = anchor.length === 0 ? expected : locateRun(all.map(texts), anchor, expected);
    if (found === null && !first) {
      // tmux trimmed its history, or xterm its own, while we sat here. Start over from the buffer.
      this.reset();
      this.deps.onRows();
      return;
    }
    const split = found ?? expected;
    const added = all.slice(0, split);
    if (fetched.length < CHUNK || this.rows.length + added.length >= MAX_ROWS) this.exhausted = true;
    if (first) this.joinsBuffer = fetched[split - 1]?.continues ?? false;
    const oldest = this.rows[0];
    const copy = all[split];
    if (oldest && copy) oldest.wrapped = copy.wrapped; // a soft wrap across the seam between chunks
    if (added.length > 0) {
      const theme = this.deps.theme();
      this.element.style.setProperty("--cell-height", `${String(cellHeight)}px`);
      this.element.prepend(...added.map((row) => rowElement(row, theme)));
      this.rows = [...added, ...this.rows];
      this.height = this.rows.length * cellHeight;
    }
    this.top = end - fetched.length + 1;
    this.baseThen = base;
    this.deps.onRows();
  }
}
