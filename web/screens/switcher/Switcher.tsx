// The phone's session switcher (client-architecture.md §7.4, browser-behaviors.md "Session
// switcher"): a tall sheet opened by the dock's tab chip. The open tabs as pills, the window
// switcher for the active tab's session, then every session on the host ("here" for the
// active tab's, "open" for another open tab's), and at the bottom, in thumb reach, a search
// and New session. It is the phone's only picker, so it also reaches Home.
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView, useHostName, useOverlay } from "../../app/context";
import { Button } from "../../ui/primitives/Button";
import { Dialog } from "../../ui/primitives/Dialog";
import { TabStrip } from "../../ui/primitives/TabStrip";
import { SearchField } from "../../ui/primitives/TextField";
import { tabPills } from "../terminal/tabView";
import { terminalsOf } from "../terminal/terminals";
import { HostSessionLists } from "../sessions/HostSessionLists";
import { openSession } from "../sessions/openSession";
import { useStore } from "../../ui/store";
import { WindowChoices } from "./WindowChoices";
import styles from "./Switcher.module.css";

export function Switcher() {
  const app = useApp();
  const { open, close } = useOverlay("switcher");
  const host = useAppView((v) => v.hosts[0]);
  const [query, setQuery] = useState("");

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  return (
    <Dialog
      open={open}
      title="Sessions"
      variant="sheet"
      onClose={close}
      actions={<Button variant="quiet" icon="home" onClick={() => { app.router.closeOverlay(() => { app.router.go("home"); }); }}>Home</Button>}
      footer={open && (
        <div class={styles.footer}>
          <SearchField label="Find a session" placeholder="Find a session" value={query} onInput={setQuery} class={styles.search} />
          <Button
            variant="secondary"
            icon="plus"
            disabledReason={host ? undefined : "No server to create on"}
            onClick={(e) => { if (host) app.openOverlay({ screen: "home", name: "newSession", params: { handle: host.entry.handle } }, e.currentTarget); }}
          >
            New session
          </Button>
        </div>
      )}
    >
      {open && <SwitcherBody query={query} />}
    </Dialog>
  );
}

/** Mounted only while the sheet is open, so every open starts with a fresh listing. */
function SwitcherBody({ query }: { query: string }) {
  const root = useRef<HTMLDivElement>(null);
  const app = useApp();
  const terminals = terminalsOf(app);
  const workspace = useAppView((v) => v.workspace);
  const statuses = useStore(terminals, (s) => s.tabs);

  const active = workspace.tabs.find((t) => t.id === workspace.active) ?? null;
  const hostName = useHostName();

  const pills = tabPills(workspace.tabs, statuses, hostName, null, Date.now());

  // The tap that closes the sheet hands the keyboard back to the input that held it.
  const dismiss = (then?: () => void): void => {
    if (root.current) app.focus.returnKeyboardInTap(root.current);
    app.router.closeOverlay(then);
  };

  return (
    <div class={styles.body} ref={root}>
      {pills.length > 0 && (
        <section class={styles.tabs} aria-label="Open tabs">
          <TabStrip
            pills={pills}
            active={workspace.active}
            closeAll
            onSelect={(id) => {
              terminals.activate(id);
              dismiss();
            }}
            onClose={(id) => { app.dispatch({ type: "closed", id }); }}
          />
        </section>
      )}
      {active && (
        <WindowChoices
          tab={active}
          variant="sheet"
          onChoose={(window) => {
            terminals.selectWindow(active.id, window);
            dismiss();
          }}
          onShown={() => { dismiss(); }}
          onNew={(opener) => {
            app.openOverlay({ screen: "home", name: "newWindow", params: { handle: app.hosts.byHostId(active.key.host)?.entry.handle, tab: active.id, sessionName: active.session } }, opener);
          }}
        />
      )}
      <HostSessionLists
        query={query}
        active={workspace.active}
        onOpen={(h, listing, session) => { dismiss(() => { openSession(app, h, listing, session); }); }}
      />
    </div>
  );
}
