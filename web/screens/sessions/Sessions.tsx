// The one sessions overlay (client-architecture.md §7.4, browser-behaviors.md "Session picker
// (desktop) and session switcher (phone)"): every session on every server, searchable. Its form is
// the overlay's name, chosen by the control that opens it: the current-tab button asks for the
// half-height `sheet` over the tab, in which a tap on a row or a tab switches the tab behind it
// while the sheet stays; the top row's + asks for the `picker`, which closes on a choice. The
// router owns when it is open, so Back, Escape and the backdrop all close it the same way,
// leaving the active tab as it is.
import { useEffect, useState } from "preact/hooks";
import { useApp, useAppView, useOverlay } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import type { SessionListing, TmuxListing } from "../../proto/generated/messages";
import { Dialog } from "../../ui/primitives/Dialog";
import { IconButton } from "../../ui/primitives/IconButton";
import { SearchField } from "../../ui/primitives/TextField";
import { useStore } from "../../ui/store";
import { terminalTabOf } from "../../workspace/state";
import { terminalsOf } from "../terminal/terminals";
import { HostSessionLists } from "./HostSessionLists";
import { openSession } from "./openSession";
import { SheetTabs } from "./SheetTabs";
import styles from "./Sessions.module.css";

/** The search box's text, cleared whenever the overlay closes so each opening starts fresh. */
function useQuery(open: boolean): [string, (query: string) => void] {
  const [query, setQuery] = useState("");
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  return [query, setQuery];
}

export function Sessions() {
  const sheet = useOverlay("sessions", "sheet");
  const picker = useOverlay("sessions", "picker");
  return (
    <>
      <Sheet {...sheet} />
      <Picker {...picker} />
    </>
  );
}

interface PresentationProps {
  open: boolean;
  close: () => void;
}

/** The phone: Home and search on top, the sessions, and the open tabs with + at the bottom. */
function Sheet({ open, close }: PresentationProps) {
  const app = useApp();
  const [query, setQuery] = useQuery(open);
  return (
    <Dialog
      open={open}
      title="Sessions"
      variant="sheet"
      onClose={close}
      header={
        <>
          <IconButton icon="home" label="Home" onClick={() => { app.router.closeOverlay(() => { app.router.goHome(); }); }} />
          <SearchField label="Find a session" placeholder="Find a session" value={query} onInput={setQuery} class={styles.search} />
        </>
      }
      footer={open && <SheetTabs />}
    >
      {open && <SheetSessions query={query} />}
    </Dialog>
  );
}

/** A row tap opens or activates that tab and leaves the sheet where it is. */
function SheetSessions({ query }: { query: string }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const tab = useAppView((v) => terminalTabOf(v.workspace, v.workspace.active));
  const shownId = useStore(terminals, (s) => (tab ? (s.tabs[tab.id]?.shown?.id ?? null) : null));
  return (
    <HostSessionLists
      query={query}
      {...(tab && { active: { id: tab.id, shownId, onWindow: (window: number) => { terminals.selectWindow(tab.id, window); } } })}
      onOpen={(h: HostClient, listing: TmuxListing, session: SessionListing) => { openSession(app, h, listing, session); }}
    />
  );
}

/** The desktop: a centred dialog with the search field in focus. A choice closes it, then opens the session's tab. */
function Picker({ open, close }: PresentationProps) {
  const app = useApp();
  const touch = useAppView((v) => v.viewport.density === "touch");
  const noTabs = useAppView((v) => v.workspace.tabs.length === 0);
  const [query, setQuery] = useQuery(open);
  return (
    <Dialog open={open} title="Open session" returnFocusTo={noTabs || touch ? "plus" : "terminal"} onClose={close}>
      {open && (
        <div class={styles.picker}>
          <SearchField label="Find a session" placeholder="Find a session" value={query} onInput={setQuery} data-initial-focus="" />
          <HostSessionLists query={query} onOpen={(h, listing, session) => { app.router.closeOverlay(() => { openSession(app, h, listing, session); }); }} />
        </div>
      )}
    </Dialog>
  );
}
