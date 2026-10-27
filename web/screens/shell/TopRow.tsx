import { useState } from "preact/hooks";
import { useApp, useAppView, useHostName } from "../../app/context";
import { IconButton } from "../../ui/primitives/IconButton";
import { TabStrip } from "../../ui/primitives/TabStrip";
import { useStore } from "../../ui/store";
import { activeTab, screenOf, terminalTabOf } from "../../workspace/state";
import { lookOf, tabPills } from "../terminal/tabView";
import { terminalsOf } from "../terminal/terminals";
import { useNow } from "../terminal/useNow";
import { Picker } from "../sessions/Picker";
import styles from "./TopRow.module.css";

/**
 * Desktop navigation, one row above whichever screen shows (browser-behaviors.md "Platform
 * layout"): Home, every open tab of both kinds (the active one with ×), + for the sessions
 * picker, which hangs under it, and the active tab's server in its connection colour.
 */
export function TopRow() {
  const app = useApp();
  const terminals = terminalsOf(app);
  const workspace = useAppView((v) => v.workspace);
  const dock = useAppView((v) => v.viewport.directInput !== "xterm");
  const statuses = useStore(terminals, (s) => s.tabs);
  const hostName = useHostName();
  /** The + : the picker hangs under it. */
  const [plus, setPlus] = useState<HTMLElement | null>(null);
  const screen = screenOf(workspace);
  const current = activeTab(workspace);
  const terminal = terminalTabOf(workspace, workspace.active);
  const running = screen === "terminal" && terminal !== null && statuses[terminal.id]?.state.kind !== "live";
  const now = useNow(running);
  const pills = tabPills(workspace.tabs, statuses, hostName, screen === "terminal" ? workspace.active : null, now);
  const look = terminal && lookOf(terminal, statuses[terminal.id], hostName(terminal.host), screen === "terminal", now);

  return (
    <>
    {/* On a touch screen with a desktop layout (an iPad), a press on the row must not take the keyboard's focus from the owned input (§6.5). */}
    <nav class={styles.row} aria-label="Workspace" onPointerDown={(e) => { if (dock) e.preventDefault(); }}>
      <IconButton icon="home" label="Home" current={screen === "home"} onClick={() => { app.router.goHome(); }} />
      <TabStrip
        pills={pills}
        active={screen === "home" ? null : workspace.active}
        onSelect={(id) => { terminals.activate(id); }}
        onClose={(id) => { app.dispatch({ type: "closed", id }); }}
      />
      <span ref={setPlus} class={styles.plus}>
        <IconButton icon="plus" label="Open another session" focusTarget="plus" onClick={(e) => { app.openOverlay({ screen: "sessions", name: "picker" }, e.currentTarget); }} />
      </span>
      {current && <span class={styles.host} data-tone={look?.tone}>{hostName(current.host)}</span>}
    </nav>
    <Picker anchor={plus} />
    </>
  );
}
