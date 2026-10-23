// The one listing fetcher (client-architecture.md §6.3): the only code that sends
// `listSessions`. It joins each host as a TabPort and reports each reply once, to whoever
// subscribes: the controller turns it into the workspace's `listing` event (pruning) and
// sessions/ renders it (Home and the picker), so both see the same listing.
import { RequestError, type Host, type TabPort } from "../net/host";
import { backoffMs } from "../tabs/connection";
import type { ServerMsg, TmuxListing, WindowRef } from "../proto/generated/messages";

const RELIST_DELAY_MS = 300;
/** The socket outlives the last reason for it by this long (Home or the picker closing, the last tab leaving). */
const LINGER_MS = 30_000;

export type ListingEvent =
  | { type: "listed"; handle: string; listing: TmuxListing | null }
  /** Nothing decided: cached rows go stale and offer Retry. */
  | { type: "failed"; handle: string; reason: RequestError["reason"] }
  | { type: "renamed"; handle: string; window: WindowRef; name: string };

interface HostState {
  host: Host;
  port: TabPort;
  wanted: boolean;
  joined: boolean;
  inFlight: boolean;
  queued: boolean;
  attempt: number;
  relist: ReturnType<typeof setTimeout> | undefined;
  retry: ReturnType<typeof setTimeout> | undefined;
  linger: ReturnType<typeof setTimeout> | undefined;
}

export interface ListingOptions {
  /** Whether any tab is `restoring`: a failed listing is retried with backoff while so. */
  restoring(): boolean;
  /** Whether the page is visible: `sessionsChanged` is acted on only then. */
  visible(): boolean;
  random?: () => number;
}

export class ListingFetcher {
  private readonly hosts = new Map<string, HostState>();
  private readonly listeners = new Set<(event: ListingEvent) => void>();

  constructor(private readonly opts: ListingOptions) {}

  subscribe(listener: (event: ListingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Starts watching a host for hints. A host is joined only while something wants it. */
  add(handle: string, host: Host): void {
    if (this.hosts.has(handle)) return;
    const state: HostState = {
      host,
      port: undefined as never,
      wanted: false,
      joined: false,
      inFlight: false,
      queued: false,
      attempt: 0,
      relist: undefined,
      retry: undefined,
      linger: undefined,
    };
    state.port = {
      linkUp: () => { this.fetch(handle); },
      linkLost: () => {
        clearTimeout(state.relist);
        // A request in flight fails on its own; with none, cached rows would otherwise stay unmarked.
        if (!state.inFlight) this.emit({ type: "failed", handle, reason: "lost" });
      },
      paused: () => { clearTimeout(state.relist); },
      frame: () => undefined,
      message: (msg: ServerMsg) => {
        if (msg.type === "windowRenamed") this.emit({ type: "renamed", handle, window: msg.data.window, name: msg.data.name });
        else if (msg.type === "sessionsChanged" && this.opts.visible()) {
          clearTimeout(state.relist);
          state.relist = setTimeout(() => { this.fetch(handle); }, RELIST_DELAY_MS);
        }
      },
    };
    this.hosts.set(handle, state);
  }

  remove(handle: string): void {
    const state = this.hosts.get(handle);
    if (!state) return;
    this.clear(state);
    if (state.joined) state.host.leave(state.port);
    this.hosts.delete(handle);
  }

  /**
   * Home or the picker is on screen, a tab exists, or a tab is restoring: the host stays
   * joined (the socket stays up, so hints keep arriving). When nothing wants it, the host is
   * left after 30 s. Returns whether it started a listing (the host became wanted while ready),
   * so a caller about to `refresh` knows one has just begun.
   */
  setWanted(handle: string, wanted: boolean): boolean {
    const state = this.hosts.get(handle);
    if (!state || state.wanted === wanted) return false;
    state.wanted = wanted;
    clearTimeout(state.linger);
    if (wanted) {
      if (!state.joined) {
        state.joined = true;
        state.host.join(state.port);
      }
      if (state.host.ready) {
        this.fetch(handle);
        return true;
      }
    } else {
      state.linger = setTimeout(() => {
        if (state.joined) state.host.leave(state.port);
        state.joined = false;
        this.clear(state);
      }, LINGER_MS);
    }
    return false;
  }

  /**
   * Entering Home, opening the picker, a user's Retry, or waiting for a new session to
   * appear: a listing that starts now. One already in flight may have started before the
   * change the caller is waiting on, so it queues exactly one more after it. A request
   * waiting for the socket is sent on `linkUp`.
   */
  refresh(handle: string): void {
    if (this.hosts.get(handle)?.host.ready) this.fetch(handle);
  }

  private clear(state: HostState): void {
    clearTimeout(state.relist);
    clearTimeout(state.retry);
    clearTimeout(state.linger);
  }

  /** At most one request per host is in flight; a trigger during it queues one more. */
  private fetch(handle: string): void {
    const state = this.hosts.get(handle);
    if (!state) return;
    if (state.inFlight) {
      state.queued = true;
      return;
    }
    state.inFlight = true;
    clearTimeout(state.retry);
    state.host
      .request(
        (req) => ({ type: "listSessions", data: { req } }),
        (reply) => (reply.type === "sessions" ? { listing: reply.data.tmux } : undefined),
      )
      .then(
        ({ listing }) => {
          state.attempt = 0;
          this.emit({ type: "listed", handle, listing });
        },
        (error: unknown) => {
          this.emit({ type: "failed", handle, reason: error instanceof RequestError ? error.reason : "lost" });
          // A busy daemon is retried soon and silently; a restoring tab retries on any failure.
          if (this.opts.restoring() || (error instanceof RequestError && error.reason === "busy")) {
            const delay = backoffMs(state.attempt++, (this.opts.random ?? Math.random)());
            state.retry = setTimeout(() => { this.fetch(handle); }, delay);
          }
        },
      )
      .finally(() => {
        state.inFlight = false;
        if (state.queued) {
          state.queued = false;
          this.fetch(handle);
        }
      });
  }

  private emit(event: ListingEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
