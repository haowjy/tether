// The button for New session where it is a button (Home's empty card): it opens that server's
// full-height picker on the New session page, and Back from the page lands on the list. The picker's
// own entry is the row at the end of each server's list (`Picker`).
import { useApp } from "../../app/context";
import type { AppController } from "../../app/controller";
import type { HostClient } from "../../net/hosts";
import { Button } from "../../ui/primitives/Button";
import { pickerMemoryOf } from "./pickerMemory";
import { reasonOf } from "./pick";

export function openNewSession(app: AppController, host: HostClient, opener: HTMLElement): void {
  const server = { screen: "sessions", name: "server", params: { host: host.entry.handle } };
  pickerMemoryOf(app).setSide("sessions");
  app.openOverlay(server, opener);
  app.router.openOverlay({ ...server, params: { ...server.params, newSession: host.entry.handle, name: "" } });
}

export function NewSession({ host }: { host: HostClient }) {
  const app = useApp();
  return (
    <Button variant="quiet" icon="plus" disabledReason={reasonOf(host)} onClick={(e) => { openNewSession(app, host, e.currentTarget); }}>
      New session
    </Button>
  );
}
