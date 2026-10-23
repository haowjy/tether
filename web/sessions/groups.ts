// Search and expansion over one host's listing (client-architecture.md §6.3), as pure
// functions. Filtering is local: nothing here asks the daemon, so a keystroke costs no
// round trip.
import type { SessionListing, TmuxListing, WindowListing, WindowRef } from "../proto/generated/messages";

export interface SessionGroup {
  session: SessionListing;
  /** What the expansion set holds for this session. */
  key: string;
  expanded: boolean;
  /** The windows to show: all of them, or only the matching ones when search matched windows alone. */
  windows: WindowListing[];
}

/**
 * A session's expansion key. It carries the tmux run (`server`), so a restarted tmux, which
 * reuses `$0`, `$1`, never inherits the old run's open groups.
 */
export function sessionKey(server: string, session: SessionListing): string {
  return `${server}/${String(session.id)}`;
}

/**
 * The groups to draw for `query`. With no query, every session, open or closed as the user
 * left it. A query keeps sessions whose name matches (all their windows) or that hold a
 * matching window (only those windows, group opened for the search). Matching ignores
 * case. `expanded` is never changed: clearing the query restores what the user chose.
 */
export function groups(listing: TmuxListing, query: string, expanded: ReadonlySet<string>): SessionGroup[] {
  const needle = query.trim().toLowerCase();
  const out: SessionGroup[] = [];
  for (const session of listing.sessions) {
    const key = sessionKey(listing.server, session);
    const chosen = expanded.has(key);
    if (needle === "") {
      out.push({ session, key, expanded: chosen, windows: session.windows });
      continue;
    }
    const byName = session.name.toLowerCase().includes(needle);
    const matching = session.windows.filter((w) => w.name.toLowerCase().includes(needle));
    if (!byName && matching.length === 0) continue;
    out.push({ session, key, expanded: chosen || matching.length > 0, windows: byName ? session.windows : matching });
  }
  return out;
}

/** The session and window a `WindowRef` names in this listing, if the listing has it. */
export function findWindow(listing: TmuxListing, ref: WindowRef): { session: SessionListing; window: WindowListing } | undefined {
  if (listing.server !== ref.server) return undefined;
  for (const session of listing.sessions) {
    const window = session.windows.find((w) => w.id === ref.window);
    if (window) return { session, window };
  }
  return undefined;
}

/** "1 window", "3 windows". */
export function windowCount(n: number): string {
  return `${String(n)} ${n === 1 ? "window" : "windows"}`;
}
