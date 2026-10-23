// Stub: W1 owns screens/home/. It holds the Home routes' frame so the shell, the router and
// the primitives are exercised end to end; W1 replaces the body with open tabs, the sessions
// list, search, creation and the listing states (client-architecture.md §6.3).
import { useEffect } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Row } from "../../ui/primitives/Row";
import { RovingList } from "../../ui/primitives/RovingList";
import { tabLabels } from "../../workspace/labels";
import { HomeNav } from "./HomeNav";
import styles from "./Home.module.css";

export function Home({ pane }: { pane: "sessions" | "files" }) {
  const app = useApp();
  const { hosts, workspace, viewport } = useAppView();
  const host = hosts[0];
  const hostName = host?.name ?? "the server";
  const phone = viewport.layout === "phone";
  const kind = host?.admission.kind;
  // The host's label carries its connection colour, never a dot.
  const tone = kind === "admitted" ? "live" : kind === "unreachable" || kind === "deciding" || kind === undefined ? "reconnecting" : "error";
  const labels = tabLabels(workspace.tabs, (id) => hosts.find((h) => h.hostId === id)?.name ?? id);

  // Entering Home asks the one fetcher for a fresh listing.
  useEffect(() => {
    for (const h of hosts) if (h.admission.kind === "admitted") app.listing.refresh(h.entry.handle);
  }, [hosts.map((h) => h.admission.kind).join()]);

  return (
    <div class={styles.home}>
      <header class={styles.header}>
        <h1 class={styles.brand}>tether</h1>
        <span class={styles.host} data-tone={tone}>{hostName}</span>
      </header>
      <div class={styles.body}>
        <div class={styles.column}>
          {pane === "sessions" ? (
            <>
              <section aria-labelledby="open-tabs">
                <h2 id="open-tabs" class={styles.heading}>Open tabs</h2>
                {labels.length === 0 ? (
                  <EmptyState icon="terminal" title="No tabs open">Choose a window from your sessions to open one.</EmptyState>
                ) : (
                  <RovingList label="Open tabs" class={styles.list}>
                    {labels.map((l) => (
                      <Row
                        key={l.id}
                        roving
                        icon="terminal"
                        label={`${l.session} / ${l.window}`}
                        selected={l.id === workspace.active}
                        onClick={() => {
                          app.dispatch({ type: "activated", id: l.id });
                          app.router.go("terminal");
                        }}
                      />
                    ))}
                  </RovingList>
                )}
              </section>
              <section aria-labelledby="sessions">
                <h2 id="sessions" class={styles.heading}>On {hostName}</h2>
                <EmptyState icon="sessions" title="Sessions load here">The sessions list arrives with the Home screen.</EmptyState>
              </section>
              <Row icon="settings" label="Settings" trailing="chevron" onClick={() => { app.router.openOverlay({ screen: "settings", name: "settings" }); }} />
            </>
          ) : (
            <EmptyState icon="folder" title="Files">Files opens here.</EmptyState>
          )}
        </div>
      </div>
      {phone && <HomeNav pane={pane} />}
    </div>
  );
}
