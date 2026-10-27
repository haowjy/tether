import { useApp, useAppView, useTabLabels } from "../../../app/context";
import { Icon } from "../../../ui/primitives/Icon";
import { DockButton } from "../../../ui/primitives/DockButton";
import { activeTab } from "../../../workspace/state";
import styles from "./CurrentTabButton.module.css";

/** The phone's current-tab button, on a terminal tab and on a Files tab alike: the tab's name, how many tabs are open, and a tap opens the sessions sheet. It fills its bar. */
export function CurrentTabButton() {
  const app = useApp();
  const tab = useAppView((v) => activeTab(v.workspace));
  const count = useAppView((v) => v.workspace.tabs.length);
  const label = useTabLabels().find((l) => l.id === tab?.id);
  return (
    <DockButton
      kind="control"
      class={styles.chip}
      aria-label={label ? `${label.full}, ${String(count)} ${count === 1 ? "tab" : "tabs"}, open sessions` : undefined}
      onClick={(e) => { app.openOverlay({ screen: "sessions", name: "open" }, e.currentTarget); }}
    >
      {label ? (
        <>
          <span class={styles.session}>{label.session}</span>
          {label.window !== "" && <span class={styles.window}>{label.window}</span>}
          <span class={styles.count}>{count}</span>
        </>
      ) : (
        <span class={styles.only}>Sessions</span>
      )}
      <Icon name="chevronUp" size={16} class={styles.open} />
    </DockButton>
  );
}
