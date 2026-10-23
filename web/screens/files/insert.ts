// Insert path (client-architecture.md §7.5): the quoted absolute path goes into one tab,
// captured when the action began, with no Enter. If that tab is gone, nothing is sent
// anywhere else.
import type { AppController } from "../../app/controller";
import { hasControlChars } from "../../tabs/input";
import { tabLabels } from "../../workspace/labels";

export interface InsertTarget {
  id: string;
  /** `session / window`, as the tab's pill names it. */
  label: string;
  /** Why Insert can't type into it now: a path typed after a long outage would land in whatever is then on screen. */
  blocked: string | null;
}

/** The tab named `id` if it is open and proven (not just restored from a saved workspace). Insert waits for its watch while it is connecting, and is `blocked` once its connection failed. */
export function insertTarget(app: AppController, id: string | null): InsertTarget | null {
  const { tabs } = app.snapshot.workspace;
  const tab = tabs.find((t) => t.id === id);
  if (!tab || tab.restoring) return null;
  const hosts = app.snapshot.hosts;
  const label = tabLabels(tabs, (host) => hosts.find((h) => h.hostId === host)?.name ?? host).find((l) => l.id === tab.id);
  return label ? { id: tab.id, label: label.full, blocked: app.snapshot.tabsOffline.includes(tab.id) ? "That tab isn't connected" : null } : null;
}

/** Sends `path` to the tab `id` and shows it. When the tab is gone, says so and sends nothing. */
export function insertPath(app: AppController, id: string, path: string): boolean {
  if (hasControlChars(path)) {
    app.notify("This name has control characters, so its path wasn't inserted. Open it in the terminal instead.");
    return false;
  }
  const target = insertTarget(app, id);
  if (!target || target.blocked || !app.insertPath(id, path)) {
    app.notify(`The path wasn't inserted: ${target?.blocked?.toLowerCase() ?? "that tab is closed"}. The file is still in Files.`);
    return false;
  }
  // Activating a tab opens Terminal on it.
  app.dispatch({ type: "activated", id });
  return true;
}
