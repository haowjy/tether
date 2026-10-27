// New session and Browse files on `host`, a server the caller chose: the active tab's for the
// sessions overlay, a card's on Home. An unreachable one disables both with the reason; neither
// acts on another server. Both go through `commit`, so the form decides when they run: at once
// behind the sheet, after the picker or a server's sheet has closed.
import { useApp, useAppView } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { Button } from "../../ui/primitives/Button";
import { activeTab } from "../../workspace/state";
import type { Commit } from "./SessionPicks";

/** The active tab's server, or the first when no tab is open. */
export function useActiveHost(): HostClient | undefined {
  return useAppView((v) => {
    const tab = activeTab(v.workspace);
    return tab ? v.hosts.find((h) => h.hostId === tab.host) : v.hosts[0];
  });
}

export function NewActions({ host, commit }: { host: HostClient | undefined; commit: Commit }) {
  const app = useApp();
  const reason = host === undefined ? "No server to use" : host.admission.kind === "unreachable" ? `${host.name ?? "The server"} can't be reached` : undefined;
  return (
    <>
      <Button
        variant="quiet"
        icon="plus"
        disabledReason={reason}
        onClick={(e) => {
          if (!host || reason) return;
          const opener = e.currentTarget;
          commit(() => { app.openOverlay({ screen: "home", name: "newSession", params: { handle: host.entry.handle } }, opener); });
        }}
      >
        New session
      </Button>
      <Button
        variant="quiet"
        icon="folder"
        disabledReason={reason}
        onClick={() => {
          if (!host?.hostId || reason) return;
          const { hostId } = host;
          commit(() => { app.openFiles(hostId); });
        }}
      >
        Browse files
      </Button>
    </>
  );
}
