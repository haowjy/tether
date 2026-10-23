import { useApp, useAppView } from "../../app/context";
import { IconButton } from "../../ui/primitives/IconButton";
import { Row } from "../../ui/primitives/Row";
import { tabLabels } from "../../workspace/labels";
import styles from "./Home.module.css";

/**
 * The open tabs, first on Home. A tap opens the existing tab (never a duplicate); the close
 * button ends that tab only. Nothing here can touch tmux.
 */
export function OpenTabs() {
  const app = useApp();
  const hosts = useAppView((v) => v.hosts);
  const workspace = useAppView((v) => v.workspace);
  const labels = tabLabels(workspace.tabs, (id) => hosts.find((h) => h.hostId === id)?.name ?? id);

  return (
    <section class={styles.section} aria-labelledby="open-tabs">
      <h2 id="open-tabs" class={styles.heading}>Open tabs</h2>
      {labels.length === 0 ? (
        <p class={styles.none}>No tabs open. Choose a window from your sessions to open one.</p>
      ) : (
        <ul class={styles.tabs}>
          {labels.map((l) => {
            const tab = workspace.tabs.find((t) => t.id === l.id);
            // Offline the host's id is unknown, so a lone host stands for the tab's (§9.4: offline tabs read as reconnecting).
            const host = tab && (hosts.find((h) => h.hostId === tab.key.host) ?? (hosts.length === 1 ? hosts[0] : undefined));
            const waiting = tab?.restoring ? (host?.admission.kind === "unreachable" ? "Reconnecting…" : "Checking…") : undefined;
            return (
              <li key={l.id} class={styles.tab}>
                <Row
                  icon="terminal"
                  label={l.full}
                  meta={waiting}
                  selected={l.id === workspace.active}
                  onClick={() => { app.dispatch({ type: "activated", id: l.id }); }}
                />
                <IconButton icon="close" label={`Close ${l.full}`} onClick={() => { app.dispatch({ type: "closed", id: l.id }); }} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
