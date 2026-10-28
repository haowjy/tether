// The server a "New session" acts on, and the button for it where it is a button (Home's empty
// card). The picker's + is the same action, as an icon. An unreachable server shows its reason in
// place of the action; nothing acts on another server.
import { useApp, useAppView } from "../../app/context";
import type { AppController } from "../../app/controller";
import type { HostClient } from "../../net/hosts";
import { Button } from "../../ui/primitives/Button";
import { activeTab } from "../../workspace/state";

/** The active tab's server, or the first when no tab is open. */
export function useActiveHost(): HostClient | undefined {
  return useAppView((v) => {
    const tab = activeTab(v.workspace);
    return tab ? v.hosts.find((h) => h.hostId === tab.host) : v.hosts[0];
  });
}

/** Why nothing can run on `host`, if so. */
export function reasonOf(host: HostClient | undefined): string | undefined {
  return host === undefined ? "No server to use" : host.admission.kind === "unreachable" ? `${host.name ?? "The server"} can't be reached` : host.hostId === null ? "Checking access" : undefined;
}

/** Opens the New session dialog for `host`; the opener gets focus back when it closes. */
export function openNewSession(app: AppController, host: HostClient, opener: HTMLElement): void {
  app.openOverlay({ screen: "home", name: "newSession", params: { handle: host.entry.handle } }, opener);
}

export function NewSession({ host }: { host: HostClient }) {
  const app = useApp();
  const reason = reasonOf(host);
  return (
    <Button variant="quiet" icon="plus" disabledReason={reason} onClick={(e) => { openNewSession(app, host, e.currentTarget); }}>
      New session
    </Button>
  );
}
