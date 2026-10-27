// The cache over the listing fetcher's events (client-architecture.md §6.3): one listing per
// host and what state it is in. It never fetches. Home, the picker and the switcher render
// it, so all three show the same rows.
import type { TmuxListing } from "../proto/generated/messages";
import { Store } from "../ui/store";

/** Why cached rows are stale: the host couldn't be reached, or it answered with a refusal. */
export type Failure = "offline" | "refused";

export interface HostSessions {
  /** `undefined`: never listed. `null`: the daemon says no tmux server is running. */
  listing: TmuxListing | null | undefined;
  /** The last attempt failed: the rows above are stale. */
  failure: Failure | null;
  /** When the last authoritative listing came, in this page's life: when the host was last reached. */
  reachedAt: number | null;
  /** A listing was requested and no answer has come since. */
  updating: boolean;
}

export interface SessionsState {
  /** By host handle, as the fetcher reports. */
  hosts: Readonly<Record<string, HostSessions>>;
}

const EMPTY: HostSessions = { listing: undefined, reachedAt: null, failure: null, updating: false };

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
  constructor() {
    super({ hosts: {} });
  }

  /** The fetcher sent a listing request: show what is cached, quietly "Updating", until an answer comes. */
  requested(handle: string): void {
    const host = this.snapshot.hosts[handle] ?? EMPTY;
    if (!host.updating) this.setHost(handle, { ...host, updating: true });
  }

  /** An authoritative listing. */
  listed(handle: string, listing: TmuxListing | null): void {
    this.setHost(handle, { listing, reachedAt: Date.now(), failure: null, updating: false });
  }

  /** Nothing decided: cached rows go stale. */
  failed(handle: string, reason: string): void {
    const failure = classifyFailure(reason);
    if (failure === null) return;
    const host = this.snapshot.hosts[handle] ?? EMPTY;
    this.setHost(handle, { ...host, failure, updating: false });
  }

  private setHost(handle: string, host: HostSessions): void {
    this.update({ hosts: { ...this.snapshot.hosts, [handle]: host } });
  }
}
