// Per-tab connection state machine (plan.md "Reconnect"). A pure reducer: no timers, no
// randomness, no I/O. The driver feeds events (jitter included) and arms one timer for
// `reconnecting.retryInMs` whenever it is non-null.
//
//   connecting --bound--> live --linkLost/watchEnded--> reconnecting --retry/nudge--> connecting
//   any state ------------- windowClosed / serverExited / userClosed ----------------> closed

export type Halt = "incompatible" | "unauthorized" | "detached";

export type ConnectionState =
  /** Waiting for the socket and the daemon's `watching`. `attempt` counts failures so far. */
  | { kind: "connecting"; attempt: number }
  | { kind: "live" }
  /** `retryInMs` is null when only a nudge (visible, online, pill tap) can resume. */
  | { kind: "reconnecting"; attempt: number; retryInMs: number | null; halt: Halt | null }
  | { kind: "closed"; reason: "windowClosed" | "serverExited" | "user" };

export type ConnectionEvent =
  | { type: "bound" } // `watching` arrived
  | { type: "linkLost"; jitter: number; halt?: Halt } // socket closed, or never opened
  | { type: "watchEnded"; reason: "detached" | "error"; jitter: number }
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

function lost(attempt: number, jitter: number, halt: Halt | null): ConnectionState {
  return { kind: "reconnecting", attempt, retryInMs: halt ? null : backoffMs(attempt, jitter), halt };
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
      if (state.kind === "live") return lost(0, event.jitter, event.halt ?? null);
      if (state.kind === "connecting") return lost(state.attempt + 1, event.jitter, event.halt ?? null);
      return event.halt ? lost(state.attempt, event.jitter, event.halt) : state;
    case "watchEnded":
      // Another client detached us: retrying on a timer would fight it, so wait for a tap.
      if (state.kind === "reconnecting") return state;
      return lost(0, event.jitter, event.reason === "detached" ? "detached" : null);
    case "retry":
      return state.kind === "reconnecting" && state.retryInMs !== null
        ? { kind: "connecting", attempt: state.attempt }
        : state;
    case "nudge":
      return state.kind === "reconnecting" ? { kind: "connecting", attempt: 0 } : state;
    case "rewatch":
      return state.kind === "live" ? { kind: "connecting", attempt: 0 } : state;
  }
}
