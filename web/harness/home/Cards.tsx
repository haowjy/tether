// Every state of a server card on one page, for design review: the states a real host reaches
// only with a dead socket, a stopped tmux or an admission problem. Real flows are the fixtures.
import { Button } from "../../ui/primitives/Button";
import { ServerCard, type ServerCardProps } from "../../screens/home/ServerCard";

const NO_OP = (): void => undefined;
const tab = (id: string, label: string, waiting?: string): ServerCardProps["tabs"][number] => ({
  id, icon: id.startsWith("files") ? "folder" : "terminal", label, waiting, selected: false, onOpen: NO_OP, onClose: NO_OP,
});
const TABS = [tab("t1", "tether agent"), tab("t2", "notes shell"), tab("files-1", "tether")];

const CARDS: ServerCardProps[] = [
  { name: "pop-os", status: "live", tabs: TABS, body: { kind: "ready", count: 9, onSessions: NO_OP }, onFiles: NO_OP },
  { name: "pop-os (no tabs)", status: "live", tabs: [], body: { kind: "ready", count: 2, onSessions: NO_OP }, onFiles: NO_OP },
  { name: "pop-os (loading)", status: "live", tabs: [], body: { kind: "loading" }, onFiles: NO_OP },
  { name: "pop-os (list failed)", status: "live", tabs: [], body: { kind: "failed", onRetry: NO_OP }, onFiles: NO_OP },
  { name: "no sessions", status: "live", tabs: [], body: { kind: "empty", actions: <><Button variant="quiet" icon="plus">New session</Button><Button variant="quiet" icon="folder">Browse files</Button></> }, onFiles: NO_OP },
  { name: "dev-box-2", status: "live", tabs: [tab("t3", "build shell")], body: { kind: "noTmux", onRetry: NO_OP }, onFiles: NO_OP },
  { name: "jimmys-macbook-air", status: "offline", tabs: [tab("t4", "tether agent", "Reconnecting…")], body: { kind: "offline", reachedAgo: "2 hours ago", onRetry: NO_OP }, onFiles: undefined },
  { name: "offline, never reached", status: "offline", tabs: [], body: { kind: "offline", reachedAgo: null, onRetry: NO_OP }, onFiles: undefined },
  { name: "checking", status: "checking", tabs: [tab("t5", "tether agent", "Checking…")], body: { kind: "loading" }, onFiles: undefined },
  { name: "needs the user", status: "attention", tabs: [], body: { kind: "attention" }, onFiles: undefined },
];

export function Cards() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "16px", maxWidth: "720px", margin: "0 auto", overflowY: "auto", height: "100%" }}>
      <h1>Server card states</h1>
      {CARDS.map((c) => <ServerCard key={c.name} {...c} />)}
    </main>
  );
}
