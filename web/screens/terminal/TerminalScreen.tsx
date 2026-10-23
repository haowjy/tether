// Stub: W2 owns screens/terminal/. The screen is mounted once and hidden rather than
// unmounted, so the terminal surface and the direct-input element exist when a tap arrives
// (client-architecture.md §6.5). This stub shows the toolbar and tab strip over an empty
// surface; W2 mounts the renderer and the status band, and P3a/P3b add the draft and the gestures.
import { useApp, useAppView } from "../../app/context";
import { useFocusRef } from "../../ui/focus";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { IconButton } from "../../ui/primitives/IconButton";
import { TabStrip, type Pill } from "../../ui/primitives/TabStrip";
import { tabLabels } from "../../workspace/labels";
import styles from "./TerminalScreen.module.css";

export function TerminalScreen({ active }: { active: boolean }) {
  const app = useApp();
  const surfaceRef = useFocusRef("terminal");
  const workspace = useAppView((v) => v.workspace);
  const hosts = useAppView((v) => v.hosts);
  const layout = useAppView((v) => v.viewport.layout);
  const phone = layout === "phone";
  const hostName = (id: string): string => hosts.find((h) => h.hostId === id)?.name ?? id;
  const labels = tabLabels(workspace.tabs, hostName);
  const pills: Pill[] = labels.map((l, i) => ({
    id: l.id,
    session: l.session,
    window: l.window,
    full: l.full,
    tone: workspace.tabs[i]?.restoring ? "reconnecting" : "idle",
    state: workspace.tabs[i]?.restoring ? "checking" : "not connected",
  }));
  const current = workspace.tabs.find((t) => t.id === workspace.active);

  const tools = (
    <div class={styles.toolbar} data-layout={layout}>
      {phone && <IconButton icon="back" label="Back to Home" onClick={() => { app.router.toParent(); }} />}
      <TabStrip pills={pills} active={workspace.active} onSelect={(id) => { app.dispatch({ type: "activated", id }); }} onClose={(id) => { app.dispatch({ type: "closed", id }); }} />
      <IconButton icon="plus" label="Open another session" focusTarget="plus" onClick={() => { app.router.openOverlay({ screen: "picker", name: "open" }); }} />
      {/* Wired by the terminal and phone-input lanes. */}
      {phone && <IconButton icon="keyboard" label="Show keyboard" disabled />}
    </div>
  );

  return (
    <div class={styles.terminal} hidden={!active} data-layout={layout}>
      <h1 class="sr-only">Terminal</h1>
      {!phone && tools}
      <div class={styles.surface} tabIndex={-1} ref={surfaceRef}>
        {current ? (
          <p class={styles.context}>
            <strong>{current.session}</strong> <span>{current.window}</span> <small>{hostName(current.key.host)}</small>
          </p>
        ) : (
          <EmptyState title="Open a window with + or from Home." />
        )}
      </div>
      {phone && tools}
    </div>
  );
}
