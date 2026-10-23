import { hostProblem } from "../ui/hostProblem";
import type { ConnectionState } from "./connection";

/** Past this, a lost host is probably Tailscale being off (ios-shell.md "Lifecycle and reconnect"). */
const UNREACHABLE_AFTER_MS = 10_000;
/** A first connect quicker than this shows no strip, so a normal switch doesn't flash one. */
const SLOW_CONNECT_MS = 1_500;

/** `idle`: a tab off screen whose host is up; only the tab on screen watches, so only it is "live". */
export type Tone = "live" | "idle" | "connecting" | "waiting" | "halted" | "gone" | "limited";

/** How a tab's connection reads on its pill and, when it is on screen, in the status strip. */
export interface Status {
  tone: Tone;
  /** The strip's headline; null shows no strip. */
  detail: string | null;
  /** The strip's second line. */
  hint: string | null;
  /** What a tap does, when it does something. */
  action: string | null;
}

/** `downSince`: when the tab stopped being live, or opened. `onScreen`: the active tab. */
export function describe(state: ConnectionState, downSince: number, retryAt: number | null, now: number, host: string, onScreen: boolean): Status {
  // Off screen, a tab has no watch: it rests in whichever of these it was in when it left,
  // and a lost host moves it on to `reconnecting`.
  if (!onScreen && (state.kind === "live" || state.kind === "connecting")) {
    return { tone: "idle", detail: null, hint: null, action: null };
  }
  switch (state.kind) {
    case "live":
      return { tone: "live", detail: null, hint: null, action: null };
    case "connecting": {
      const slow = now - downSince >= SLOW_CONNECT_MS;
      return { tone: "connecting", detail: slow ? `Connecting to ${host}…` : null, hint: null, action: null };
    }
    case "closed":
      return {
        tone: "gone",
       
        detail: state.reason === "serverExited" ? "tmux server exited" : state.reason === "windowClosed" ? "Window closed" : null,
        hint: null,
        action: null,
      };
    case "limited":
      return limitedStatus(state.message, host);
    case "reconnecting":
      break;
  }
  switch (state.halt) {
    case "unauthorized":
    case "incompatible": {
      const { title, hint } = hostProblem(state.halt, host);
      return { tone: "halted", detail: title, hint, action: "Retry" };
    }
    case "detached":
      return { tone: "waiting", detail: "Detached by another tmux client", hint: null, action: "Reattach" };
    case null:
      break;
  }
  const unreachable = now - downSince >= UNREACHABLE_AFTER_MS;
  // A failed watch on a live socket: the daemon's reason, not a network blame.
  const detail = state.message ?? (unreachable ? hostProblem("unreachable", host).title : `Reconnecting to ${host}`);
  if (retryAt === null) return { tone: "waiting", detail, hint: null, action: "Retry" };
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const when = seconds === 0 ? "now" : `${String(seconds)}s`;
  return { tone: "waiting", detail, hint: seconds === 0 ? "Retrying now" : `Retrying in ${when}`, action: "Retry now" };
}

/**
 * A tab the daemon refused for its session limit (`watchEnded { reason: "limit" }`,
 * resource-limits.md §3.6): the error colour, the daemon's message, and what to do. Nothing is
 * closed for the user; Retry climbs the backoff.
 */
export function limitedStatus(message: string | undefined, host: string): Status {
  return {
    tone: "limited",
   
    detail: message ?? `tether on ${host} is at its session limit`,
    hint: "Close tabs from other sessions, in this or another tether window or the app, to open this one.",
    action: "Retry",
  };
}
