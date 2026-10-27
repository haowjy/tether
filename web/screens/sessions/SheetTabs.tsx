// The sheet's bottom row, in thumb reach: the open tabs of both kinds in order (a tap switches the
// tab behind the sheet, × closes the active one and never touches tmux) and + for a new session or
// a new Files tab on the active tab's server.
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView, useHostName } from "../../app/context";
import { Button } from "../../ui/primitives/Button";
import { IconButton } from "../../ui/primitives/IconButton";
import { TabStrip } from "../../ui/primitives/TabStrip";
import { useStore } from "../../ui/store";
import { activeTab } from "../../workspace/state";
import { tabPills } from "../terminal/tabView";
import { terminalsOf } from "../terminal/terminals";
import styles from "./SheetTabs.module.css";

export function SheetTabs() {
  const app = useApp();
  const terminals = terminalsOf(app);
  const workspace = useAppView((v) => v.workspace);
  const statuses = useStore(terminals, (s) => s.tabs);
  const hostName = useHostName();
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
      <NewMenu />
    </div>
  );
}

/** + : New session and Browse files, both on the active tab's server (the first one when no tab is open). */
function NewMenu() {
  const app = useApp();
  const hosts = useAppView((v) => v.hosts);
  const tab = useAppView((v) => activeTab(v.workspace));
  const host = (tab && hosts.find((h) => h.hostId === tab.host)) ?? hosts[0];
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent): void => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => { document.removeEventListener("pointerdown", outside, true); };
  }, [open]);

  return (
    <div
      ref={root}
      class={styles.new}
      onKeyDown={(e) => {
        // Escape closes the menu first; the sheet's own Escape would close it with the menu open.
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }}
    >
      <IconButton icon="plus" label="New session or Browse files" aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(!open); }} />
      {open && (
        <div class={styles.menu} role="menu">
          <Button
            variant="quiet"
            icon="plus"
            role="menuitem"
            disabledReason={host ? undefined : "No server to create on"}
            onClick={(e) => {
              if (!host) return;
              setOpen(false);
              app.openOverlay({ screen: "home", name: "newSession", params: { handle: host.entry.handle } }, e.currentTarget);
            }}
          >
            New session
          </Button>
          <Button
            variant="quiet"
            icon="folder"
            role="menuitem"
            disabledReason={host?.hostId ? undefined : "No server to browse"}
            onClick={() => {
              if (!host?.hostId) return;
              setOpen(false);
              app.openFiles(host.hostId);
            }}
          >
            Browse files
          </Button>
        </div>
      )}
    </div>
  );
}
