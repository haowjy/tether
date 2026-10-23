// Admission: whether the daemon lets this client in (browser-auth.md §3.8). Pure: the
// daemon's answers go in, an Admission comes out, the same in every environment. Pulling
// those answers over the wire is net/hosts.ts's job.
import { CloseCode, PROTOCOL_VERSION } from "../proto/generated/messages";

/** `GET /auth/info`. */
export interface AuthInfo {
  hostId: string;
  name: string;
  protocol: { min: number; max: number };
  /** The one origin browsers may use; null with `browserRefused` saying why. */
  browserOrigin: string | null;
  browserRefused: string | null;
}

/** A node route's answer, parsed. Status 0 is no answer at all. */
export interface SessionReply {
  status: number;
  error?: string;
  reason?: string;
  nodeName?: string;
  /** The enrolled device's name, on a 200. */
  deviceName?: string;
}

export type Admission =
  /** `deviceName` is this device's name as the daemon enrolled it; a token-admitted host has none. */
  | { kind: "admitted"; deviceName?: string }
  /** This page is not at the daemon's canonical origin. No socket opens. */
  | { kind: "wrongOrigin"; origin: string }
  | { kind: "originRefused"; reason: string }
  /** `nodeName` is null for a token-admitted host: the app's server pairing is gone. */
  | { kind: "notEnrolled"; nodeName: string | null }
  | { kind: "nodeRefused"; reason: string }
  /** The page speaks a protocol the daemon does not: never retried. */
  | { kind: "incompatible" }
  /** The daemon cannot decide now: keep the screen, retry with backoff. */
  | { kind: "deciding" }
  | { kind: "unreachable" };

/** Where a check goes next. */
export type Step = { admission: Admission } | { askSession: true };

/** A host whose token the daemon (or the transport) refused. */
export const TOKEN_REFUSED: Admission = { kind: "notEnrolled", nodeName: null };

/** Reads `/auth/info` for a host with a page origin: either decided, or the session must be asked. */
export function fromInfo(info: AuthInfo, pageOrigin: string): Step {
  if (PROTOCOL_VERSION < info.protocol.min || PROTOCOL_VERSION > info.protocol.max) return { admission: { kind: "incompatible" } };
  if (info.browserOrigin === null) return { admission: { kind: "originRefused", reason: info.browserRefused ?? "unknown" } };
  if (info.browserOrigin !== pageOrigin) return { admission: { kind: "wrongOrigin", origin: info.browserOrigin } };
  return { askSession: true };
}

export function fromSession(reply: SessionReply): Admission {
  switch (reply.status) {
    case 0:
      return { kind: "unreachable" };
    case 200:
      return { kind: "admitted", ...(reply.deviceName !== undefined && { deviceName: reply.deviceName }) };
    case 401:
      return reply.error === "not_enrolled" ? { kind: "notEnrolled", nodeName: reply.nodeName ?? "this device" } : { kind: "deciding" };
    case 403:
      return reply.error === "node_refused" ? { kind: "nodeRefused", reason: reply.reason ?? "unknown" } : { kind: "deciding" }; // bad_origin: read /auth/info again
    default:
      return { kind: "deciding" }; // 503 identity_unavailable, auth_unavailable, busy, and anything unexpected
  }
}

/**
 * A socket close that says something about admission. 4401 is not taken as `notEnrolled`
 * on its own: the node may now be refused, so the caller asks the session route why.
 */
export function fromClose(code: number): "recheck" | Admission | null {
  if (code === CloseCode.BadToken) return "recheck";
  if (code === CloseCode.AuthUnavailable) return { kind: "deciding" };
  if (code === CloseCode.Incompatible) return { kind: "incompatible" };
  return null;
}

/** A host the daemon would let in as far as we know. */
export function isAdmitted(admission: Admission): boolean {
  return admission.kind === "admitted";
}

/** Whether a later check could change the answer. The rest wait for a fix on the server or a new build. */
export function isRetryable(admission: Admission): boolean {
  return admission.kind === "deciding" || admission.kind === "unreachable";
}

export type EnrolResult =
  | { kind: "enrolled" }
  | { kind: "badCode" }
  | { kind: "nodeRefused"; reason: string }
  | { kind: "tryAgain" };

/** `POST /auth/node/enroll`'s answer. */
export function enrolResult(reply: SessionReply): EnrolResult {
  switch (reply.status) {
    case 200:
      return { kind: "enrolled" };
    case 403:
      if (reply.error === "bad_code") return { kind: "badCode" };
      if (reply.error === "node_refused") return { kind: "nodeRefused", reason: reply.reason ?? "unknown" };
      return { kind: "tryAgain" };
    default:
      return { kind: "tryAgain" }; // 503 (the code is not consumed) and no answer
  }
}
