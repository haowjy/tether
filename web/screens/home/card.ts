// What one server's card says (browser-behaviors.md "Home"): its state, derived once from the host and
// its sessions cache. The body decides the status word, so a card can't read "live" over an offline body.
import type { HostClient } from "../../net/hosts";
import type { HostSessions } from "../../sessions/cache";

export type CardStatus = "live" | "checking" | "offline" | "attention";

/** What sits under the tab rows: one per way a server can be. */
export type CardBody =
  /** The host can't be reached; `reachedAt` is when this page last did, if it has. */
  | { kind: "offline"; reachedAt: number | null }
  /** Admission needs the user (the banner above says what); nothing here acts on it. */
  | { kind: "attention" }
  /** Admission is being decided. */
  | { kind: "checking" }
  | { kind: "loading" }
  | { kind: "failed" }
  /** The daemon says no tmux server is running. tether never starts one, so the only action is looking again. */
  | { kind: "noTmux" }
  /** A live server with no sessions. */
  | { kind: "empty" }
  | { kind: "ready"; count: number };

export const STATUS: Record<CardBody["kind"], CardStatus> = {
  offline: "offline",
  attention: "attention",
  checking: "checking",
  loading: "live",
  failed: "live",
  noTmux: "live",
  empty: "live",
  ready: "live",
};

export interface Card {
  body: CardBody;
  /** A Files tab can be opened here: the host admits this page and a listing has told its id. */
  files: boolean;
}

function bodyOf(host: HostClient, sessions: HostSessions | undefined): CardBody {
  switch (host.admission.kind) {
    case "unreachable":
      return { kind: "offline", reachedAt: sessions?.reachedAt ?? null };
    case "deciding":
      return { kind: "checking" };
    case "admitted":
      break;
    default:
      return { kind: "attention" };
  }
  const listing = sessions?.listing;
  if (listing === undefined) return sessions?.failure ? { kind: "failed" } : { kind: "loading" };
  if (listing === null) return { kind: "noTmux" };
  return listing.sessions.length === 0 ? { kind: "empty" } : { kind: "ready", count: listing.sessions.length };
}

export function cardOf(host: HostClient, sessions: HostSessions | undefined): Card {
  return { body: bodyOf(host, sessions), files: host.admission.kind === "admitted" && host.hostId !== null };
}
