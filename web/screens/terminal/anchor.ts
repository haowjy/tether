// Where two lists of rows meet (client-architecture.md §7.6). A history chunk is asked for with
// a few rows that are already known, as an anchor: tmux's line numbers shift as it gains
// rows, so where the anchor lands in the chunk says how far.

/** Rows of overlap a chunk is asked for. */
export const ANCHOR_ROWS = 8;

/**
 * Where `run` sits in `rows`, as the index of its first row: the match nearest `expected`, the
 * older one when two are equally near (so output that repeated a row is not mistaken for the
 * anchor). Null when it is not there.
 */
export function locateRun(rows: readonly string[], run: readonly string[], expected: number): number | null {
  let best: number | null = null;
  for (let at = 0; at + run.length <= rows.length; at++) {
    if (!run.every((text, i) => rows[at + i] === text)) continue;
    if (best === null || Math.abs(at - expected) < Math.abs(best - expected)) best = at;
  }
  return best;
}
