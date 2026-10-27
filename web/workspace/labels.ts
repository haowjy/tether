import { baseName } from "../files/paths";
import type { Tab } from "./state";

export interface TabLabel {
  id: string;
  /** Shown bold: a terminal tab's session, a Files tab's folder or file name ("Files" at the roots). */
  session: string;
  /** The window a terminal tab shows now, shown in regular weight after the session, set apart by spacing alone. Empty for a Files tab. */
  window: string;
  /** The pill's tooltip and accessible name, and a list row's text: the session, then its window (or "Files: " and the name), then the host when several are open. */
  full: string;
  /** Set only when tabs from more than one host are open (native). */
  host: string | null;
}

/**
 * Labels for the open tabs. The two parts are separate fields so a pill can truncate the
 * window name first and keep the session name; the host's name is added only when tabs
 * from more than one host are open.
 */
export function tabLabels(tabs: readonly Tab[], hostName: (hostId: string) => string): TabLabel[] {
  const hosts = new Set(tabs.map((t) => t.host));
  return tabs.map((t) => {
    const host = hosts.size > 1 ? hostName(t.host) : null;
    const on = host ? ` on ${host}` : "";
    if (t.kind === "files") {
      const { place } = t;
      const name = place.kind === "roots" ? "Files" : baseName(place.path);
      return { id: t.id, session: name, window: "", full: `${place.kind === "roots" ? name : `Files: ${name}`}${on}`, host };
    }
    return { id: t.id, session: t.session, window: t.window, full: `${t.session} ${t.window}${on}`, host };
  });
}
