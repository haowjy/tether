// The sheet's bottom row, in thumb reach: the open tabs of both kinds in order (a tap switches the
// tab behind the sheet, × closes the active one and never touches tmux) and + for a new session or
// a new Files tab on the active tab's server.
import { useApp, useAppView, useHostName } from "../../app/context";
import { TabStrip } from "../../ui/primitives/TabStrip";
import { useStore } from "../../ui/store";
import { tabPills } from "../terminal/tabView";
import { terminalsOf } from "../terminal/terminals";
import { useActiveHost } from "./NewActions";
import { NewMenu } from "./NewMenu";
import { now } from "./SessionPicks";
import styles from "./SheetTabs.module.css";

export function SheetTabs() {
  const app = useApp();
  const terminals = terminalsOf(app);
  const workspace = useAppView((v) => v.workspace);
  const statuses = useStore(terminals, (s) => s.tabs);
  const hostName = useHostName();
  const host = useActiveHost();
  const pills = tabPills(workspace.tabs, statuses, hostName, null, Date.now());
  return (
    <div class={styles.row}>
      <div class={styles.tabs}>
        <TabStrip
          pills={pills}
          active={workspace.active}
          onSelect={(id) => { terminals.activate(id); }}
          onClose={(id) => { app.dispatch({ type: "closed", id }); }}
        />
      </div>
      <NewMenu host={host} commit={now} />
    </div>
  );
}
