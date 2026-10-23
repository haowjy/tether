// Stub: W1 owns screens/picker/. It renders the Open session picker for the router's
// `picker` overlay: a centred dialog on desktop, a tall sheet on phone. The router owns
// when it is open, so Back, Escape and the backdrop all close it the same way.
import { useApp, useAppView } from "../../app/context";
import { Dialog } from "../../ui/primitives/Dialog";
import { EmptyState } from "../../ui/primitives/EmptyState";

export function Picker() {
  const app = useApp();
  const open = useAppView((v) => v.nav.entry.overlay?.screen === "picker");
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const touch = useAppView((v) => v.viewport.density === "touch");
  const noTabs = useAppView((v) => v.workspace.tabs.length === 0);
  return (
    <Dialog
      open={open}
      title="Open session"
      variant={phone ? "sheet" : "dialog"}
      returnFocusTo={noTabs || touch ? "plus" : "terminal"}
      onClose={() => { app.router.closeOverlay(); }}
    >
      <EmptyState icon="sessions" title="Sessions load here">The session list arrives with the picker screen.</EmptyState>
    </Dialog>
  );
}
