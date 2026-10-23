// The cache over the listing fetcher's events (client-architecture.md §6.3): one listing per
// host, what state it is in, and which sessions the user opened. It never fetches. Home and
// the picker render it, so both show the same rows.
import type { TmuxListing, WindowRef } from "../proto/generated/messages";
import { Store } from "../ui/store";
import { sessionKey } from "./groups";

/** Why cached rows are stale: the host couldn't be reached, or it answered with a refusal. */
export type Failure = "offline" | "refused";

export interface HostSessions {
  /** `undefined`: never listed. `null`: the daemon says no tmux server is running. */
  listing: TmuxListing | null | undefined;
  /** The last attempt failed: the rows above are stale. */
  failure: Failure | null;
  /** A listing was requested and no answer has come since. */
  updating: boolean;
}

export interface SessionsState {
  /** By host handle, as the fetcher reports. */
  hosts: Readonly<Record<string, HostSessions>>;
  /** Session keys the user opened, by `hostId`. */
  expanded: Readonly<Record<string, ReadonlySet<string>>>;
}

const EMPTY: HostSessions = { listing: undefined, failure: null, updating: false };

/**
 * `null` when the failure says nothing about the host (the page was hidden; the daemon was
 * busy and a `sessionsChanged` hint will follow). Everything the daemon refused is
 * `refused`; everything that never got an answer is `offline`.
 */
export function classifyFailure(reason: string): Failure | null {
  switch (reason) {
    case "busy":
    case "background":
      return null;
    case "lost":
    case "timeout":
      return "offline";
    default:
      return "refused";
  }
}

export class SessionsCache extends Store<SessionsState> {
  /** `saved` is the saved workspace's `expanded`. */
  constructor(saved: Readonly<Record<string, readonly string[]>> = {}) {
    super({ hosts: {}, expanded: Object.fromEntries(Object.entries(saved).map(([host, keys]) => [host, new Set(keys)])) });
  }

  /** The fetcher sent a listing request: show what is cached, quietly "Updating", until an answer comes. */
  requested(handle: string): void {
    const host = this.snapshot.hosts[handle] ?? EMPTY;
    if (!host.updating) this.setHost(handle, { ...host, updating: true });
  }

  /** An authoritative listing. It also drops expansion keys of sessions that no longer exist. */
  listed(handle: string, listing: TmuxListing | null, hostId: string | null): void {
    this.update({ hosts: { ...this.snapshot.hosts, [handle]: { listing, failure: null, updating: false } }, expanded: this.pruned(hostId, listing) });
  }

  /** Nothing decided: cached rows go stale. */
  failed(handle: string, reason: string): void {
    const failure = classifyFailure(reason);
    if (failure === null) return;
    const host = this.snapshot.hosts[handle] ?? EMPTY;
    this.setHost(handle, { ...host, failure, updating: false });
  }

  /** A window's new name, applied to the cached rows so they never contradict the tab strip. */
  renamed(handle: string, window: WindowRef, name: string): void {
    const host = this.snapshot.hosts[handle];
    const listing = host?.listing;
    if (!host || !listing || listing.server !== window.server) return;
    const sessions = listing.sessions.map((s) => (s.windows.some((w) => w.id === window.window) ? { ...s, windows: s.windows.map((w) => (w.id === window.window ? { ...w, name } : w)) } : s));
    this.setHost(handle, { ...host, listing: { ...listing, sessions } });
  }

  toggle(hostId: string, key: string): void {
    const open = new Set(this.snapshot.expanded[hostId]);
    if (!open.delete(key)) open.add(key);
    this.update({ expanded: { ...this.snapshot.expanded, [hostId]: open } });
  }

  /** For the saved workspace. */
  saved(): Record<string, string[]> {
    return Object.fromEntries(Object.entries(this.snapshot.expanded).filter(([, keys]) => keys.size > 0).map(([host, keys]) => [host, [...keys]]));
  }

  private pruned(hostId: string | null, listing: TmuxListing | null): SessionsState["expanded"] {
    const open = hostId === null || listing === null ? undefined : this.snapshot.expanded[hostId];
    if (hostId === null || listing === null || !open) return this.snapshot.expanded;
    const live = new Set(listing.sessions.map((s) => sessionKey(listing.server, s)));
    const kept = new Set([...open].filter((key) => live.has(key)));
    return kept.size === open.size ? this.snapshot.expanded : { ...this.snapshot.expanded, [hostId]: kept };
  }

  private setHost(handle: string, host: HostSessions): void {
    this.update({ hosts: { ...this.snapshot.hosts, [handle]: host } });
  }
}
