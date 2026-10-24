// The Terminal destination (client-architecture.md §6.1, §6.4, §7): the tab strip (or, on a
// touch phone, the dock) and the surface the renderer draws into, with the status band over
// its top edge. The screen is
// mounted once and hidden rather than unmounted (§6.5); the renderer, the drivers and tmux's
// size belong to `terminals.ts`, so this file only places things and draws state.
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView, useHostName } from "../../app/context";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { IconButton } from "../../ui/primitives/IconButton";
import { StatusBand } from "../../ui/primitives/StatusBand";
import { TabStrip } from "../../ui/primitives/TabStrip";
import { useStore } from "../../ui/store";
import { Dock } from "./dock/Dock";
import { bandTone, lookOf, tabPills } from "./tabView";
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
  const layout = useAppView((v) => v.viewport.layout);
  const phone = layout === "phone";
  // Touch input (a phone, or an iPad without a trackpad) ends in the dock; a mouse keeps the tab strip.
  const dock = useAppView((v) => v.viewport.directInput !== "xterm");

  useEffect(() => {
    if (slot.current) terminals.mount(slot.current);
  }, [terminals]);

  const hostName = useHostName();
  const current = workspace.tabs.find((t) => t.id === workspace.active);
  const running = active && current !== undefined && statuses[current.id]?.state.kind !== "live";
  const now = useNow(running);
  const pills = tabPills(workspace.tabs, statuses, hostName, active ? workspace.active : null, now);
  const look = current && lookOf(current, statuses[current.id], hostName(current.key.host), active, now);
  const status = look?.status;

  const tools = (
    <div class={styles.toolbar} data-layout={layout}>
      {phone && <IconButton icon="back" label="Back to Home" onClick={() => { app.router.toParent(); }} />}
      <TabStrip
        pills={pills}
        active={workspace.active}
        onSelect={(id) => { terminals.activate(id); }}
        onClose={(id) => { app.dispatch({ type: "closed", id }); }}
      />
      <IconButton icon="plus" label="Open another session" focusTarget="plus" onClick={(e) => { app.openOverlay({ screen: "picker", name: "open" }, e.currentTarget); }} />
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
            <EmptyState icon="terminal" title={dock && phone ? "Open a window from Sessions." : "Open a window with + or from Home."} />
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
      {phone && !dock && tools}
      {dock && <Dock active={active} />}
    </div>
  );
}

