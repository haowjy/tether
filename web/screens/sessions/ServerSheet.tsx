// A server's full-height picker: the router overlay `{ screen: "sessions", name: "server", params:
// { host } }`, opened by "Sessions and files" on a Home card. Back instead of a Home button, no
// tab strip (Home lists the open tabs), that server's sessions and folders only. It closes and
// then acts, so a tapped row opens its tab over Home and Back from the tab lands on Home, never on
// this sheet again.
import { useEffect } from "preact/hooks";
import { useAppView, useOverlay } from "../../app/context";
import { PickerForm } from "./PickerForm";

export function ServerSheet() {
  const { open, params, close } = useOverlay("sessions", "server");
  const handle = typeof params?.["host"] === "string" ? params["host"] : undefined;
  const host = useAppView((v) => v.hosts.find((h) => h.entry.handle === handle));
  // A server removed while its sheet is open leaves nothing to show.
  useEffect(() => { if (open && !host) close(); }, [open, host]);
  return <PickerForm open={open} onClose={close} title={`Open on ${host?.name ?? "the server"}`} variant="page" back="Back to Home" only={handle} />;
}
