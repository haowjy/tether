// Every state of a server card on one page, for design review: the states a real host reaches
// only with a dead socket, a stopped tmux or an admission problem. Real flows are the fixtures.
import { Button } from "../../ui/primitives/Button";
import { ServerCard, type CardTab, type ServerCardProps } from "../../screens/home/ServerCard";

const NO_OP = (): void => undefined;
const tab = (id: string, label: string, meta?: string): CardTab => ({
  id, icon: id.startsWith("files") ? "folder" : "terminal", label, meta, selected: false, onOpen: NO_OP, onClose: NO_OP,
});
const TABS = [tab("t1", "tether agent"), tab("t2", "notes shell"), tab("files-1", "tether")];
const NEW = <Button variant="quiet" icon="plus">New session</Button>;
const base = { onRetry: NO_OP, onSessions: NO_OP, newSession: NEW };

const CARDS: ServerCardProps[] = [
  { ...base, notice: null, name: "pop-os", tabs: TABS, body: { kind: "ready", count: 9 }, onFiles: NO_OP },
  { ...base, notice: null, name: "pop-os (no tabs)", tabs: [], body: { kind: "ready", count: 2 }, onFiles: NO_OP },
  { ...base, notice: null, name: "pop-os (loading)", tabs: [], body: { kind: "loading" }, onFiles: NO_OP },
  { ...base, notice: null, name: "pop-os (list failed)", tabs: [], body: { kind: "failed" }, onFiles: NO_OP },
  { ...base, notice: null, name: "no sessions", tabs: [], body: { kind: "empty" }, onFiles: NO_OP },
  { ...base, notice: null, name: "dev-box-2", tabs: [tab("t3", "build shell")], body: { kind: "noTmux" }, onFiles: NO_OP },
  { ...base, notice: null, name: "jimmys-macbook-air", tabs: [tab("t4", "tether agent", "Reconnecting…")], body: { kind: "offline", reachedAt: Date.now() - 2 * 3_600_000 }, onFiles: undefined },
  { ...base, notice: null, name: "offline, never reached", tabs: [], body: { kind: "offline", reachedAt: null }, onFiles: undefined },
  { ...base, notice: null, name: "checking", tabs: [tab("t5", "tether agent", "Checking…")], body: { kind: "checking" }, onFiles: undefined },
  { ...base, notice: null, name: "needs the user", tabs: [], body: { kind: "attention" }, onFiles: undefined },
];

export function Cards() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "16px", maxWidth: "720px", margin: "0 auto", overflowY: "auto", height: "100%" }}>
      <h1>Server card states</h1>
      {CARDS.map((c) => <ServerCard key={c.name} {...c} />)}
    </main>
  );
}
