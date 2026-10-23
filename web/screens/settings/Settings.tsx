// Stub: W1 owns screens/settings/ (Remove this device, Clear local data, Add to Home Screen).
import { useApp, useAppView } from "../../app/context";
import { Dialog } from "../../ui/primitives/Dialog";
import { EmptyState } from "../../ui/primitives/EmptyState";

export function Settings() {
  const app = useApp();
  const { nav } = useAppView();
  return (
    <Dialog open={nav.entry.overlay?.screen === "settings"} title="Settings" onClose={() => { app.router.closeOverlay(); }}>
      <EmptyState icon="settings" title="Settings">Device and local data settings arrive with the Settings screen.</EmptyState>
    </Dialog>
  );
}
