// The Terminal destination (client-architecture.md §6.1, §6.4, §7): the tab strip and the
// surface the renderer draws into, with the status band over its top edge. The screen is
// mounted once and hidden rather than unmounted (§6.5); the renderer, the drivers and tmux's
// size belong to `terminals.ts`, so this file only places things and draws state.
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { IconButton } from "../../ui/primitives/IconButton";
import { StatusBand } from "../../ui/primitives/StatusBand";
import { TabStrip, type Pill } from "../../ui/primitives/TabStrip";
import { useStore } from "../../ui/store";
import { tabLabels } from "../../workspace/labels";
import { bandTone, lookOf } from "./tabView";
import { terminalsOf } from "./terminals";
import styles from "./Terminal.module.css";

/** The clock for countdowns and "Connecting…" while the tab on screen is not live. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(timer); };
  }, [running]);
  return running ? now : Date.now();
}

export function TerminalScreen({ active }: { active: boolean }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const slot = useRef<HTMLDivElement>(null);
  const statuses = useStore(terminals, (s) => s.tabs);
  const workspace = useAppView((v) => v.workspace);
  const hosts = useAppView((v) => v.hosts);
  const layout = useAppView((v) => v.viewport.layout);
  const phone = layout === "phone";

  useEffect(() => {
    if (slot.current) terminals.mount(slot.current);
  }, [terminals]);

  const hostName = (id: string): string => hosts.find((h) => h.hostId === id)?.name ?? id;
  const current = workspace.tabs.find((t) => t.id === workspace.active);
  const running = active && current !== undefined && statuses[current.id]?.state.kind !== "live";
  const now = useNow(running);
  const looks = new Map(workspace.tabs.map((t) => [t.id, lookOf(t, statuses[t.id], hostName(t.key.host), active && t.id === workspace.active, now)]));
  const labels = tabLabels(workspace.tabs, hostName);
  const pills: Pill[] = labels.map((l) => {
    const look = looks.get(l.id);
    return { id: l.id, session: l.session, window: l.window, full: l.full, tone: look?.tone ?? "idle", state: look?.state ?? "open" };
  });
  const look = current && looks.get(current.id);
  const status = look?.status;

  const tools = (
    <div class={styles.toolbar} data-layout={layout}>
      {phone && <IconButton icon="back" label="Back to Home" onClick={() => { app.router.toParent(); }} />}
      <TabStrip
        pills={pills}
        active={workspace.active}
        onSelect={(id) => {
          app.dispatch({ type: "activated", id });
          terminals.nudge(id);
        }}
        onClose={(id) => { app.dispatch({ type: "closed", id }); }}
      />
      <IconButton icon="plus" label="Open another session" focusTarget="plus" onClick={() => { app.router.openOverlay({ screen: "picker", name: "open" }); }} />
      {/* Raised by the phone input lane. */}
      {phone && <IconButton icon="keyboard" label="Show keyboard" disabled />}
      {!phone && current && look && <span class={styles.hostLabel} data-tone={look.tone}>{hostName(current.key.host)}</span>}
    </div>
  );

  return (
    <div class={styles.terminal} hidden={!active} data-layout={layout}>
      <h1 class="sr-only">Terminal</h1>
      {!phone && tools}
      <div class={styles.surface} ref={slot}>
        {current === undefined && (
          <div class={styles.empty}>
            <EmptyState icon="terminal" title="Open a window with + or from Home." />
          </div>
        )}
        {current && status?.detail && (
          <StatusBand
            tone={bandTone(status.tone)}
            text={status.detail}
            hint={status.hint}
            action={status.action ? { label: status.action, onAction: () => { terminals.retry(current.id); } } : null}
          />
        )}
      </div>
      {phone && tools}
    </div>
  );
}

