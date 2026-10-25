import type { Tab } from "./state";

export interface TabLabel {
  id: string;
  /** Shown bold. */
  session: string;
  /** The window the tab shows now, shown in regular weight after the session, set apart by spacing alone. */
  window: string;
  /** The pill's tooltip and accessible name, and a list row's text: the session, then its window, then the host when several are open. */
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
  const hosts = new Set(tabs.map((t) => t.key.host));
  return tabs.map((t) => {
    const host = hosts.size > 1 ? hostName(t.key.host) : null;
    return { id: t.id, session: t.session, window: t.window, full: `${t.session} ${t.window}${host ? ` on ${host}` : ""}`, host };
  });
}
