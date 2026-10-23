import type { Tab } from "./state";

export interface TabLabel {
  id: string;
  session: string;
  /** The window part, with `index: ` ahead of it when another open tab's window has the same name. */
  window: string;
  /** Shown as the pill's tooltip and its accessible name: `session / window`, plus the host when several are open. */
  full: string;
  /** Set only when tabs from more than one host are open (native). */
  host: string | null;
}

/**
 * Pill labels for the open tabs. The label is `session / window`; the real window index is
 * appended when two open tabs' window names collide; the host's name is appended only when
 * tabs from more than one host are open. The window part is a separate field so a pill can
 * keep it visible when the session part is truncated.
 */
export function tabLabels(tabs: readonly Tab[], hostName: (hostId: string) => string): TabLabel[] {
  const counts = new Map<string, number>();
  for (const t of tabs) counts.set(t.window, (counts.get(t.window) ?? 0) + 1);
  const hosts = new Set(tabs.map((t) => t.key.host));
  return tabs.map((t) => {
    const collides = (counts.get(t.window) ?? 0) > 1 && t.index !== null;
    const window = collides ? `${String(t.index)}: ${t.window}` : t.window;
    const host = hosts.size > 1 ? hostName(t.key.host) : null;
    const full = `${t.session} / ${window}${host ? ` on ${host}` : ""}`;
    return { id: t.id, session: t.session, window, full, host };
  });
}
