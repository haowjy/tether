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
