// Home (client-architecture.md §6.3, browser-behaviors.md "Home"): one card per server, with its
// open tabs and what its state offers. Server-first: one server is not opened for you. The
// gear opens Settings. Add server exists only where the platform manages servers (the app);
// the browser has its one page origin.
import { useApp, useAppView, useHostName } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { Button } from "../../ui/primitives/Button";
import { IconButton } from "../../ui/primitives/IconButton";
import { useStore } from "../../ui/store";
import { NewSession } from "../sessions/NewActions";
import { now } from "../sessions/SessionPicks";
import { pillMeta, tabPills } from "../terminal/tabView";
import { terminalsOf } from "../terminal/terminals";
import { HostBanner } from "../shell/HostBanner";
import { cardOf } from "./card";
import { Install } from "./Install";
import { ServerCard, type CardTab } from "./ServerCard";
import styles from "./Home.module.css";

/** The card a tab sits on: its host's. A lone host whose id is still unknown (offline at launch) stands for the saved tab's (§9.4: offline tabs read as reconnecting). */
function hostOf(hostId: string, hosts: HostClient[]): HostClient | undefined {
  return hosts.find((h) => h.hostId === hostId) ?? (hosts.length === 1 && hosts[0]?.hostId === null ? hosts[0] : undefined);
}

function HostCard({ host, tabs }: { host: HostClient; tabs: CardTab[] }) {
  const app = useApp();
  const handle = host.entry.handle;
  const { body, files } = cardOf(host, useStore(app.sessions, (s) => s.hosts[handle]));
  const { hostId } = host;
  return (
    <ServerCard
      name={host.name ?? "the server"}
      tabs={tabs}
      body={body}
      notice={body.kind !== "offline" && <HostBanner host={host} />}
      onRetry={() => { app.retryHost(handle); }}
      onSessions={(opener) => { app.openOverlay({ screen: "sessions", name: "server", params: { host: handle } }, opener); }}
      newSession={<NewSession host={host} commit={now} />}
      onFiles={files && hostId !== null ? () => { app.openFiles(hostId); } : undefined}
    />
  );
}

export function Home() {
  const app = useApp();
  const hosts = useAppView((v) => v.hosts);
  const workspace = useAppView((v) => v.workspace);
  const statuses = useStore(terminalsOf(app), (s) => s.tabs);
  const hostName = useHostName();
  const manageHosts = app.platform.manageHosts;

  const rows = tabPills(workspace.tabs, statuses, hostName, null, Date.now()).flatMap((pill) => {
    const host = hostOf(pill.host, hosts);
    if (!host) return [];
    const row: CardTab = {
      id: pill.id,
      icon: pill.kind === "files" ? "folder" : "terminal",
      label: pill.full,
      meta: pillMeta(pill),
      selected: pill.id === workspace.active,
      onOpen: () => { app.dispatch({ type: "activated", id: pill.id }); },
      onClose: () => { app.dispatch({ type: "closed", id: pill.id }); },
    };
    return [{ host, row }];
  });

  return (
    <div class={styles.home}>
      <header class={styles.header}>
        <div class={styles.bar}>
          <h1 class={styles.title}>tether</h1>
          <IconButton icon="settings" label="Settings" onClick={(e) => { app.openOverlay({ screen: "settings", name: "settings" }, e.currentTarget); }} />
        </div>
      </header>
      <div class={styles.body}>
        <div class={styles.column}>
          {hosts.map((h) => <HostCard key={h.entry.handle} host={h} tabs={rows.filter((r) => r.host === h).map((r) => r.row)} />)}
          {manageHosts && <Button variant="quiet" icon="plus" class={styles.add} onClick={manageHosts}>Add server</Button>}
          <Install />
        </div>
      </div>
    </div>
  );
}
