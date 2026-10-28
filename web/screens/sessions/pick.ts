// What the picker's two sides and its container share: the server a pick acts on, the search text,
// how a pick commits, and how a tab opens behind a picker that stays.
import { useEffect, useState } from "preact/hooks";
import { useAppView } from "../../app/context";
import type { AppController } from "../../app/controller";
import type { HostClient } from "../../net/hosts";
import { activeTab, type Tab } from "../../workspace/state";

/** The active tab's server, or the first when no tab is open. */
export function useActiveHost(): HostClient | undefined {
  return useAppView((v) => {
    const tab = activeTab(v.workspace);
    return (tab && v.hosts.find((h) => h.hostId === tab.host)) ?? v.hosts[0];
  });
}

/** Why nothing can run on `host`, if so. */
export function reasonOf(host: HostClient | undefined): string | undefined {
  return host === undefined ? "No server to use" : host.admission.kind === "unreachable" ? `${host.name ?? "The server"} can't be reached` : host.hostId === null ? "Checking access" : undefined;
}

/** The search box's text, cleared whenever the picker closes so each opening starts fresh. */
export function useQuery(open: boolean): [string, (query: string) => void] {
  const [query, setQuery] = useState("");
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  return [query, setQuery];
}

/**
 * Every pick leaves the picker open, with the tab it puts on screen behind it. Create has a page to leave
 * first: this returns the New session page to its list, if it is still the top entry (a page the user has
 * since left is not popped), then runs `then`.
 */
export function popPage(app: AppController, then: () => void): void {
  const { overlay } = app.snapshot.entry;
  if (overlay?.screen === "sessions" && overlay.params?.["newSession"] !== undefined) app.router.closeOverlay(then);
  else then();
}

/** The Files tab on `hostId` whose place is the folder `path`, if any: a tab browsed elsewhere does not match. */
export const filesTabAt = (tabs: readonly Tab[], hostId: string | null, path: string | null): Tab | undefined =>
  tabs.find((t) => t.kind === "files" && t.host === hostId && t.place.kind === "dir" && t.place.path === path);

/** The picker's pick of a folder on `hostId`: the Files tab already there is activated, else a new one opens. */
export function openFolder(app: AppController, hostId: string, path: string): void {
  const tab = filesTabAt(app.snapshot.workspace.tabs, hostId, path);
  if (tab) app.dispatch({ type: "activated", id: tab.id });
  else app.openFiles(hostId, { kind: "dir", path });
}
