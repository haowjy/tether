import type { Admission } from "../net/admission";

/** Why a host can't be used, in every place that says so. */
export type HostProblem = "unreachable" | "unauthorized" | "incompatible" | "overCap";

export interface ProblemCopy {
  title: string;
  hint: string | null;
}

/**
 * The copy for a {@link HostProblem}: a headline and, when there is a way out, a hint.
 * Worded by how the host admits this client (as a tailnet node, or by a native token),
 * never by environment name.
 */
export function hostProblem(kind: HostProblem, host: string, byToken = false): ProblemCopy {
  switch (kind) {
    case "unreachable":
      return { title: `Can't reach ${host}`, hint: "Check that Tailscale is on, then retry." };
    case "unauthorized":
      return byToken
        ? { title: `This app isn't paired with ${host}`, hint: "Pair it again from Settings > Servers, with a code from tether enroll on the server." }
        : { title: `This device isn't enrolled on ${host}`, hint: "Run tether enroll on the server for a code." };
    case "incompatible":
      return { title: `tether on ${host} speaks a different version`, hint: "Update the page or the daemon so they use the same protocol." };
    case "overCap":
      return { title: `Too many connections to ${host}`, hint: "Close tether in another browser or the app, then retry." };
  }
}

const NODE_REFUSALS: Record<string, string> = {
  tagged: "This device is tagged in Tailscale, so tether can't tell who is using it.",
  login_mismatch: "This device belongs to another Tailscale login than the server's owner.",
  shared: "This device is shared into the tailnet from another one.",
  routes: "This device is a subnet router, so requests through it can't be traced to one device.",
  self: "This is the server itself. Open tether from another device.",
  unknown_node: "Tailscale doesn't recognise this device.",
};

const ORIGIN_REFUSALS: Record<string, string> = {
  ambiguous_origin: "tailscale serve has more than one HTTPS entry for tether, so browsers can't tell which address is right.",
  not_https: "tailscale serve isn't publishing tether over HTTPS yet.",
};

/** The reason, in words, a node can never be admitted. Unknown reasons are shown as sent. */
export function nodeRefusalText(reason: string): string {
  return NODE_REFUSALS[reason] ?? `The server refused this device (${reason}).`;
}

export function originRefusalText(reason: string): string {
  return ORIGIN_REFUSALS[reason] ?? `Browsers can't use this server yet (${reason}). Run tether enroll on the server for the fix.`;
}

/** What an {@link Admission} that blocks the app says, or null when the app may run. */
export function admissionCopy(admission: Admission, host: string, byToken: boolean): ProblemCopy | null {
  switch (admission.kind) {
    case "admitted":
      return null;
    case "wrongOrigin":
      return { title: `Open tether at ${admission.origin}`, hint: "This page isn't at the server's address." };
    case "originRefused":
      return { title: `Browsers can't use ${host} yet`, hint: originRefusalText(admission.reason) };
    case "notEnrolled":
      return hostProblem("unauthorized", host, byToken);
    case "nodeRefused":
      return { title: `${host} can't admit this device`, hint: nodeRefusalText(admission.reason) };
    case "incompatible":
      return hostProblem("incompatible", host);
    case "deciding":
      return { title: "Checking access…", hint: null };
    case "unreachable":
      return hostProblem("unreachable", host);
  }
}
