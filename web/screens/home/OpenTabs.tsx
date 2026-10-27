import { useApp, useAppView, useTabLabels } from "../../app/context";
import { IconButton } from "../../ui/primitives/IconButton";
import { Row } from "../../ui/primitives/Row";
import styles from "./Home.module.css";

/**
 * The open tabs of both kinds, first on Home. A tap opens the existing tab (never a duplicate);
 * the close button ends that tab only. Nothing here can touch tmux.
 */
export function OpenTabs() {
  const app = useApp();
  const hosts = useAppView((v) => v.hosts);
  const workspace = useAppView((v) => v.workspace);
  const labels = useTabLabels();

  return (
    <section class={styles.section} aria-labelledby="open-tabs">
      <h2 id="open-tabs" class={styles.heading}>Open tabs</h2>
      {labels.length === 0 ? (
        <p class={styles.none}>No tabs open. Choose a session to open one.</p>
      ) : (
        <ul class={styles.tabs}>
          {labels.map((l) => {
            const tab = workspace.tabs.find((t) => t.id === l.id);
            // Offline the host's id is unknown, so a lone host stands for the tab's (§9.4: offline tabs read as reconnecting).
            const host = tab && (hosts.find((h) => h.hostId === tab.host) ?? (hosts.length === 1 ? hosts[0] : undefined));
            const waiting = tab?.kind === "terminal" && tab.restoring ? (host?.admission.kind === "unreachable" ? "Reconnecting…" : "Checking…") : undefined;
            return (
              <li key={l.id} class={styles.tab}>
                <Row
                  icon={tab?.kind === "files" ? "folder" : "terminal"}
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
