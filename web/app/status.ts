import type { ConnectionState } from "../tabs/connection";

/** Past this, a lost host is probably Tailscale being off (ios-shell.md "Lifecycle and reconnect"). */
const UNREACHABLE_AFTER_MS = 10_000;
/** A first connect quicker than this shows no strip, so a normal switch doesn't flash one. */
const SLOW_CONNECT_MS = 1_500;

/** `idle`: a tab off screen whose host is up; only the tab on screen watches, so only it is "live". */
export type Tone = "live" | "idle" | "connecting" | "waiting" | "halted" | "gone";

/** How a tab's connection reads on its pill and, when it is on screen, in the status strip. */
export interface Status {
  tone: Tone;
  /** Shown on the pill after the name: the countdown, or a word for a halt. */
  short: string | null;
  /** The strip's headline; null shows no strip. */
  detail: string | null;
  /** The strip's second line. */
  hint: string | null;
  /** What a tap does, when it does something. */
  action: string | null;
}

/** Why a host can't be used, in every place that says so. */
export type HostProblem = "unreachable" | "unauthorized" | "incompatible";

/** The copy for a {@link HostProblem}: a headline and, when there is a way out, a hint. */
export function hostProblem(kind: HostProblem, host: string): { title: string; hint: string | null } {
  switch (kind) {
    case "unreachable":
      return { title: `Can't reach ${host}. Is Tailscale on?`, hint: null };
    case "unauthorized":
      return { title: `This iPhone isn't enrolled on ${host}`, hint: "Enrol it from the app's Hosts screen, with a code from tether device add on the server." };
    case "incompatible":
      return { title: `tether on ${host} is a different version`, hint: "Update the app or the daemon so they speak the same protocol." };
  }
}

/** `downSince`: when the tab stopped being live, or opened. `onScreen`: the active tab. */
export function describe(state: ConnectionState, downSince: number, retryAt: number | null, now: number, host: string, onScreen: boolean): Status {
  // Off screen, a tab has no watch: it rests in whichever of these it was in when it left,
  // and a lost host moves it on to `reconnecting`.
  if (!onScreen && (state.kind === "live" || state.kind === "connecting")) {
    return { tone: "idle", short: null, detail: null, hint: null, action: null };
  }
  switch (state.kind) {
    case "live":
      return { tone: "live", short: null, detail: null, hint: null, action: null };
    case "connecting": {
      const slow = now - downSince >= SLOW_CONNECT_MS;
      return { tone: "connecting", short: null, detail: slow ? `Connecting to ${host}…` : null, hint: null, action: null };
    }
    case "closed":
      return {
        tone: "gone",
        short: null,
        detail: state.reason === "serverExited" ? "tmux server exited" : state.reason === "windowClosed" ? "Window closed" : null,
        hint: null,
        action: null,
      };
    case "reconnecting":
      break;
  }
  switch (state.halt) {
    case "unauthorized":
    case "incompatible": {
      const { title, hint } = hostProblem(state.halt, host);
      return { tone: "halted", short: state.halt === "unauthorized" ? "not enrolled" : "update", detail: title, hint, action: "Retry" };
    }
    case "detached":
      return { tone: "waiting", short: "detached", detail: "Detached by another tmux client", hint: null, action: "Reattach" };
    case null:
      break;
  }
  const unreachable = now - downSince >= UNREACHABLE_AFTER_MS;
  const detail = unreachable ? hostProblem("unreachable", host).title : `Reconnecting to ${host}`;
  if (retryAt === null) return { tone: "waiting", short: "retry", detail, hint: null, action: "Retry" };
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const when = seconds === 0 ? "now" : `${String(seconds)}s`;
  return { tone: "waiting", short: when, detail, hint: seconds === 0 ? "Retrying now" : `Retrying in ${when}`, action: "Retry now" };
}
