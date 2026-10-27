// New session and Browse files, both on the active tab's server (the first one when no tab is
// open). A tab whose server is unknown or unreachable disables them with the reason: they never act
// on another server. `commit` runs Browse files once the form is ready for it; `onPick` runs first
// on either (the sheet's + menu closes itself).
import { useApp, useAppView } from "../../app/context";
import { Button } from "../../ui/primitives/Button";
import { activeTab } from "../../workspace/state";
import type { Commit } from "./SessionPicks";

export function NewActions({ commit, onPick, role }: { commit: Commit; onPick?: () => void; role?: "menuitem" }) {
  const app = useApp();
  const host = useAppView((v) => {
    const tab = activeTab(v.workspace);
    return tab ? v.hosts.find((h) => h.hostId === tab.host) : v.hosts[0];
  });
  const reason = host === undefined ? "No server to use" : host.admission.kind === "unreachable" ? `${host.name ?? "The server"} can't be reached` : undefined;
  return (
    <>
      <Button
        variant="quiet"
        icon="plus"
        {...(role && { role })}
        disabledReason={reason}
        onClick={(e) => {
          if (!host || reason) return;
          onPick?.();
          app.openOverlay({ screen: "home", name: "newSession", params: { handle: host.entry.handle } }, e.currentTarget);
        }}
      >
        New session
      </Button>
      <Button
        variant="quiet"
        icon="folder"
        {...(role && { role })}
        disabledReason={reason}
        onClick={() => {
          if (!host?.hostId || reason) return;
          const { hostId } = host;
          onPick?.();
          commit(() => { app.openFiles(hostId); });
        }}
      >
        Browse files
      </Button>
    </>
  );
}
