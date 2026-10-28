// Every state of a server card on one page, for design review: the states a real host reaches
// only with a dead socket, a stopped tmux or an admission problem. Real flows are the fixtures.
import { Button } from "../../ui/primitives/Button";
import { ServerCard, type CardTab, type ServerCardProps } from "../../screens/home/ServerCard";

const NO_OP = (): void => undefined;
const tab = (id: string, label: string, meta?: string): CardTab => ({
  id, icon: id.startsWith("files") ? "folder" : "terminal", label, meta, selected: false, bell: false, onOpen: NO_OP, onClose: NO_OP,
});
const TABS = [tab("t1", "tether agent"), tab("t2", "notes shell"), tab("files-1", "tether")];
const NEW = <Button variant="quiet" icon="plus">New session</Button>;
const ready = (count: number | null) => ({ count, onOpen: NO_OP });
const base = { bellsUnavailable: false, onRetry: NO_OP, newSession: NEW };

const CARDS: ServerCardProps[] = [
  { ...base, notice: null, name: "pop-os", tabs: TABS, body: { kind: "ready", count: 9 }, picker: ready(9) },
  { ...base, notice: null, name: "pop-os (a bell rang in notes)", tabs: [TABS[0] as CardTab, { ...(TABS[1] as CardTab), bell: true }], body: { kind: "ready", count: 9 }, picker: ready(9) },
  { ...base, notice: null, bellsUnavailable: true, name: "pop-os (bell tracking unavailable)", tabs: [TABS[0] as CardTab], body: { kind: "ready", count: 9 }, picker: ready(9) },
  { ...base, notice: null, name: "pop-os (no tabs)", tabs: [], body: { kind: "ready", count: 2 }, picker: ready(2) },
  { ...base, notice: null, name: "pop-os (loading)", tabs: [], body: { kind: "loading" }, picker: ready(null) },
  { ...base, notice: null, name: "pop-os (list failed)", tabs: [], body: { kind: "failed" }, picker: ready(null) },
  { ...base, notice: null, name: "no sessions", tabs: [], body: { kind: "empty" }, picker: ready(0) },
  { ...base, notice: null, name: "dev-box-2", tabs: [tab("t3", "build shell")], body: { kind: "noTmux" }, picker: ready(null) },
  { ...base, notice: null, name: "jimmys-macbook-air", tabs: [tab("t4", "tether agent", "Reconnecting…")], body: { kind: "offline", reachedAt: Date.now() - 2 * 3_600_000 }, picker: undefined },
  { ...base, notice: null, name: "offline, never reached", tabs: [], body: { kind: "offline", reachedAt: null }, picker: undefined },
  { ...base, notice: null, name: "checking", tabs: [tab("t5", "tether agent", "Checking…")], body: { kind: "checking" }, picker: undefined },
  { ...base, notice: null, name: "needs the user", tabs: [], body: { kind: "attention" }, picker: undefined },
];

export function Cards() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "16px", maxWidth: "720px", margin: "0 auto", overflowY: "auto", height: "100%" }}>
      <h1>Server card states</h1>
      {CARDS.map((c) => <ServerCard key={c.name} {...c} />)}
    </main>
  );
}
