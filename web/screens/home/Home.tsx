// Home (client-architecture.md §6.3, browser-behaviors.md "Home"): one card per server, with its
// open tabs and what its state offers. Server-first: one server is not opened for you. The
// gear opens Settings. Add server exists only where the platform manages servers (the app);
// the browser has its one page origin.
import { useApp, useAppView, useTabLabels } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import type { HostSessions } from "../../sessions/cache";
import { Button } from "../../ui/primitives/Button";
import { IconButton } from "../../ui/primitives/IconButton";
import { useStore } from "../../ui/store";
import { NewActions } from "../sessions/NewActions";
import { now } from "../sessions/SessionPicks";
import { Install } from "./Install";
import { ServerCard, type CardBody, type CardStatus, type CardTab } from "./ServerCard";
import styles from "./Home.module.css";

/** How long ago `then` was, in the words a status line uses. */
function ago(then: number): string {
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${String(hours)} ${hours === 1 ? "hour" : "hours"} ago` : `${String(Math.floor(hours / 24))} days ago`;
}

function statusOf(host: HostClient): CardStatus {
  switch (host.admission.kind) {
    case "admitted":
      return "live";
    case "deciding":
      return "checking";
    case "unreachable":
      return "offline";
    default:
      return "attention";
  }
}

function HostCard({ host, tabs }: { host: HostClient; tabs: CardTab[] }) {
  const app = useApp();
  const handle = host.entry.handle;
  const sessions: HostSessions | undefined = useStore(app.sessions, (s) => s.hosts[handle]);
  const retry = (): void => { if (host.admission.kind === "unreachable") app.hosts.recheck(handle); else app.listing.refresh(handle); };
  const listing = sessions?.listing;
  const { kind } = host.admission;

  let body: CardBody;
  if (kind === "unreachable") body = { kind: "offline", reachedAgo: sessions?.reachedAt ? ago(sessions.reachedAt) : null, onRetry: retry };
  else if (kind !== "admitted" && kind !== "deciding") body = { kind: "attention" };
  else if (listing === undefined) body = sessions?.failure ? { kind: "failed", onRetry: retry } : { kind: "loading" };
  else if (listing === null) body = { kind: "noTmux", onRetry: retry };
  else if (listing.sessions.length === 0) body = { kind: "empty", actions: <NewActions host={host} commit={now} /> };
  else body = { kind: "ready", count: listing.sessions.length, onSessions: (opener) => { app.openOverlay({ screen: "sessions", name: "server", params: { host: handle } }, opener); } };

  // A listing came from a welcomed socket, so the id is known; before that the host has nothing to browse.
  const { hostId } = host;
  const browsable = kind === "admitted" && hostId !== null;
  return <ServerCard name={host.name ?? "the server"} status={statusOf(host)} tabs={tabs} body={body} onFiles={browsable ? () => { app.openFiles(hostId); } : undefined} />;
}

export function Home() {
  const app = useApp();
  const hosts = useAppView((v) => v.hosts);
  const workspace = useAppView((v) => v.workspace);
  const labels = useTabLabels();
  const manageHosts = app.platform.manageHosts;

  /** Each tab sits on its server's card. Offline the host's id is unknown, so a lone host stands for the tab's (§9.4: offline tabs read as reconnecting). */
  const tabsOf = (host: HostClient): CardTab[] =>
    labels.flatMap((l) => {
      const tab = workspace.tabs.find((t) => t.id === l.id);
      if (!tab || (hosts.find((h) => h.hostId === tab.host) ?? (hosts.length === 1 ? hosts[0] : undefined)) !== host) return [];
      return [{
        id: l.id,
        icon: tab.kind === "files" ? "folder" : "terminal",
        label: l.full,
        waiting: tab.kind === "terminal" && tab.restoring ? (host.admission.kind === "unreachable" ? "Reconnecting…" : "Checking…") : undefined,
        selected: l.id === workspace.active,
        onOpen: () => { app.dispatch({ type: "activated", id: l.id }); },
        onClose: () => { app.dispatch({ type: "closed", id: l.id }); },
      }];
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
          {hosts.map((h) => <HostCard key={h.entry.handle} host={h} tabs={tabsOf(h)} />)}
          {manageHosts && <Button variant="quiet" icon="plus" class={styles.add} onClick={manageHosts}>Add server</Button>}
          <Install />
        </div>
      </div>
    </div>
  );
}
