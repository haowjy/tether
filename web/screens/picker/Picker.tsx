// Stub: W1 owns screens/picker/. It renders the Open session picker for the router's
// `picker` overlay: a centred dialog on desktop, a tall sheet on phone. The router owns
// when it is open, so Back, Escape and the backdrop all close it the same way.
import { useApp, useAppView } from "../../app/context";
import { Dialog } from "../../ui/primitives/Dialog";
import { EmptyState } from "../../ui/primitives/EmptyState";

export function Picker() {
  const app = useApp();
  const { nav, viewport, workspace } = useAppView();
  const open = nav.entry.overlay?.screen === "picker";
  return (
    <Dialog
      open={open}
      title="Open session"
      variant={viewport.layout === "phone" ? "sheet" : "dialog"}
      returnFocusTo={workspace.tabs.length === 0 ? "plus" : viewport.density === "touch" ? "plus" : "terminal"}
      onClose={() => { app.router.closeOverlay(); }}
    >
      <EmptyState icon="sessions" title="Sessions load here">The session list arrives with the picker screen.</EmptyState>
    </Dialog>
  );
}
