// The sheet's bottom row, in thumb reach: the open tabs of both kinds in order (a tap switches the
// tab behind the sheet, × closes the active one and never touches tmux).
import { useApp, useAppView, useBells, useHostName } from "../../app/context";
import { TabStrip } from "../../ui/primitives/TabStrip";
import { useStore } from "../../ui/store";
import { tabPills } from "../terminal/tabView";
import { terminalsOf } from "../terminal/terminals";

export function SheetTabs() {
  const app = useApp();
  const terminals = terminalsOf(app);
  const workspace = useAppView((v) => v.workspace);
  const statuses = useStore(terminals, (s) => s.tabs);
  const hostName = useHostName();
  const bells = useBells();
  const pills = tabPills(workspace.tabs, statuses, hostName, null, Date.now(), bells);
  return (
    <TabStrip
      pills={pills}
      active={workspace.active}
      onSelect={(id) => { terminals.activate(id); }}
      onClose={(id) => { app.dispatch({ type: "closed", id }); }}
    />
  );
}
