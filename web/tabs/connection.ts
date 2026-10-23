// Per-tab connection state machine (plan.md "Reconnect"). A pure reducer: no timers, no
// randomness, no I/O. The host owns the socket's backoff and reports each loss with its
// `retryInMs`; a failed watch backs off here, and the driver arms one timer for it.
//
//   connecting --bound--> live --linkLost/watchEnded--> reconnecting --retry/nudge/linkUp--> connecting
//   connecting --watchEnded(limit)--> limited --retry/nudge--> connecting
//   any state ------------- windowClosed / serverExited / userClosed ----------------> closed

import type { WatchEndReason } from "../proto/generated/messages";

export type Halt = "incompatible" | "unauthorized" | "detached";

export type ConnectionState =
  /** Waiting for the socket and the daemon's `watching`. `attempt` counts failures so far. */
  | { kind: "connecting"; attempt: number }
  | { kind: "live" }
  /** `retryInMs` is null when only a nudge (visible, online, pill tap) can resume. */
  | { kind: "reconnecting"; attempt: number; retryInMs: number | null; halt: Halt | null }
  /** The daemon refused the watch for its session limit (resource-limits.md §3.6); `attempt` climbs the backoff. */
  | { kind: "limited"; attempt: number; retryInMs: number; message: string | undefined }
  | { kind: "closed"; reason: "windowClosed" | "serverExited" | "user" };

export type ConnectionEvent =
  | { type: "bound" } // `watching` arrived
  | { type: "linkLost"; retryInMs: number | null; halt?: Halt } // socket closed, or never opened
  | { type: "linkUp" } // the host's socket is welcomed again
  | { type: "watchEnded"; reason: WatchEndReason; message?: string; jitter: number }
  | { type: "retry" } // the backoff timer fired
  | { type: "nudge" } // became visible, came online, or the pill was tapped
  | { type: "rewatch" } // the tab returned to the screen: a new `watch`, a fresh snapshot
  | { type: "windowClosed" }
  | { type: "serverExited" }
  | { type: "userClosed" };

export const initialState: ConnectionState = { kind: "connecting", attempt: 0 };

const BASE_MS = 500;
const CAP_MS = 30_000;
const JITTER = 0.2;

/** 0.5 s, 1, 2, 4… capped at 30 s, spread ±20% by `jitter` in [0, 1). */
export function backoffMs(attempt: number, jitter: number): number {
  const base = Math.min(BASE_MS * 2 ** attempt, CAP_MS);
  return Math.min(Math.round(base * (1 - JITTER + 2 * JITTER * jitter)), CAP_MS);
}

function lost(attempt: number, retryInMs: number | null, halt: Halt | null): ConnectionState {
  return { kind: "reconnecting", attempt, retryInMs, halt };
}

export function reduce(state: ConnectionState, event: ConnectionEvent): ConnectionState {
  if (state.kind === "closed") return state;
  switch (event.type) {
    case "windowClosed":
    case "serverExited":
      return { kind: "closed", reason: event.type };
    case "userClosed":
      return { kind: "closed", reason: "user" };
    case "bound":
      return state.kind === "connecting" ? { kind: "live" } : state;
    case "linkLost":
      // A drop after a working connection starts the backoff over; a failed attempt climbs it.
      if (state.kind === "live") return lost(0, event.retryInMs, event.halt ?? null);
      if (state.kind === "connecting") return lost(state.attempt + 1, event.retryInMs, event.halt ?? null);
      // A lost socket supersedes the refusal: the host reconnects, and the watch is asked again.
      if (state.kind === "limited") return lost(state.attempt, event.retryInMs, event.halt ?? null);
      // Already waiting: a failed retry refreshes the countdown, but never undoes a wait for a tap.
      if (event.halt) return lost(state.attempt, null, event.halt);
      return state.halt === null ? lost(state.attempt + 1, event.retryInMs, null) : state;
    case "linkUp":
      return state.kind === "reconnecting" && state.halt === null ? { kind: "connecting", attempt: state.attempt } : state;
    case "watchEnded":
      // Another client detached us: retrying on a timer would fight it, so wait for a tap.
      if (state.kind === "reconnecting" || state.kind === "limited") return state;
      if (event.reason === "limit") {
        const attempt = state.kind === "connecting" ? state.attempt : 0;
        return { kind: "limited", attempt: attempt + 1, retryInMs: backoffMs(attempt, event.jitter), message: event.message };
      }
      return event.reason === "detached" ? lost(0, null, "detached") : lost(0, backoffMs(0, event.jitter), null);
    case "retry":
      if (state.kind === "limited") return { kind: "connecting", attempt: state.attempt };
      return state.kind === "reconnecting" && state.retryInMs !== null
        ? { kind: "connecting", attempt: state.attempt }
        : state;
    case "nudge":
      // Retry on a limited tab asks again now but keeps its attempt count, so the next refusal waits longer.
      if (state.kind === "limited") return { kind: "connecting", attempt: state.attempt };
      return state.kind === "reconnecting" ? { kind: "connecting", attempt: 0 } : state;
    case "rewatch":
      return state.kind === "live" ? { kind: "connecting", attempt: 0 } : state;
  }
}
