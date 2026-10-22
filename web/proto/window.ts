import type { TmuxListing, WindowRef } from "./generated/messages";

/** One tmux window: a restarted tmux server has a new `server` id, so none of its old windows match. */
export function sameWindow(a: WindowRef, b: WindowRef): boolean {
  return a.server === b.server && a.window === b.window;
}

/** Whether `window` is in `listing`. */
export function listed(listing: TmuxListing | null, window: WindowRef): boolean {
  return listing?.server === window.server && listing.sessions.some((s) => s.windows.some((w) => w.id === window.window));
}
