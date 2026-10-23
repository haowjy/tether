// The cache over the listing fetcher's events (client-architecture.md §6.3): one listing per
// host, what state it is in, and which sessions the user opened. It never fetches. Home and
// the picker render it, so both show the same rows.
import type { TmuxListing, WindowRef } from "../proto/generated/messages";
import { sessionKey } from "./groups";

/** Why cached rows are stale: the host couldn't be reached, or it answered with a refusal. */
export type Failure = "offline" | "refused";

export interface HostSessions {
  /** `undefined`: never listed. `null`: the daemon says no tmux server is running. */
  listing: TmuxListing | null | undefined;
  /** The last attempt failed: the rows above are stale. */
  failure: Failure | null;
  /** Home or the picker was entered and no answer has come since. */
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

export class SessionsCache {
  private state: SessionsState;
  private readonly listeners = new Set<() => void>();

  /** `saved` is the saved workspace's `expanded`. */
  constructor(saved: Readonly<Record<string, readonly string[]>> = {}) {
    this.state = { hosts: {}, expanded: Object.fromEntries(Object.entries(saved).map(([host, keys]) => [host, new Set(keys)])) };
  }

  get snapshot(): SessionsState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Home or the picker was entered: show what is cached, quietly "Updating", until an answer comes. */
  expectFresh(handle: string): void {
    const host = this.state.hosts[handle] ?? EMPTY;
    if (!host.updating) this.setHost(handle, { ...host, updating: true });
  }

  /** An authoritative listing. It also drops expansion keys of sessions that no longer exist. */
  listed(handle: string, listing: TmuxListing | null, hostId: string | null): void {
    this.set({ hosts: { ...this.state.hosts, [handle]: { listing, failure: null, updating: false } }, expanded: this.pruned(hostId, listing) });
  }

  /** Nothing decided: cached rows go stale. */
  failed(handle: string, reason: string): void {
    const failure = classifyFailure(reason);
    if (failure === null) return;
    const host = this.state.hosts[handle] ?? EMPTY;
    this.setHost(handle, { ...host, failure, updating: false });
  }

  /** A window's new name, applied to the cached rows so they never contradict the tab strip. */
  renamed(handle: string, window: WindowRef, name: string): void {
    const host = this.state.hosts[handle];
    const listing = host?.listing;
    if (!host || !listing || listing.server !== window.server) return;
    const sessions = listing.sessions.map((s) => (s.windows.some((w) => w.id === window.window) ? { ...s, windows: s.windows.map((w) => (w.id === window.window ? { ...w, name } : w)) } : s));
    this.setHost(handle, { ...host, listing: { ...listing, sessions } });
  }

  toggle(hostId: string, key: string): void {
    const open = new Set(this.state.expanded[hostId]);
    if (!open.delete(key)) open.add(key);
    this.set({ ...this.state, expanded: { ...this.state.expanded, [hostId]: open } });
  }

  /** For the saved workspace. */
  saved(): Record<string, string[]> {
    return Object.fromEntries(Object.entries(this.state.expanded).filter(([, keys]) => keys.size > 0).map(([host, keys]) => [host, [...keys]]));
  }

  private pruned(hostId: string | null, listing: TmuxListing | null): SessionsState["expanded"] {
    const open = hostId === null || listing === null ? undefined : this.state.expanded[hostId];
    if (hostId === null || listing === null || !open) return this.state.expanded;
    const live = new Set(listing.sessions.map((s) => sessionKey(listing.server, s)));
    const kept = new Set([...open].filter((key) => live.has(key)));
    return kept.size === open.size ? this.state.expanded : { ...this.state.expanded, [hostId]: kept };
  }

  private setHost(handle: string, host: HostSessions): void {
    this.set({ ...this.state, hosts: { ...this.state.hosts, [handle]: host } });
  }

  private set(state: SessionsState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}
