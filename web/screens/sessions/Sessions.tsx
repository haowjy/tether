// The phone's sessions sheet (client-architecture.md §7.4, browser-behaviors.md "Session picker
// (desktop) and session switcher (phone)"): the router overlay `{ screen: "sessions", name:
// "sheet" }`, opened by the current-tab button. It is a half-height sheet over the current tab:
// Home and search on top, every session, and the open tabs with + at the bottom. A tap on a row or
// a tab switches the tab behind it while the sheet stays. The router owns when it is open, so
// Back, Escape and the backdrop all close it the same way, leaving the active tab as it is. The
// desktop's form, opened by the top row's +, is `Picker`.
import { useApp, useOverlay } from "../../app/context";
import { Dialog } from "../../ui/primitives/Dialog";
import { IconButton } from "../../ui/primitives/IconButton";
import { SearchField } from "../../ui/primitives/TextField";
import { now, SessionPicks, useQuery } from "./SessionPicks";
import { SheetTabs } from "./SheetTabs";
import styles from "./Sessions.module.css";

export function Sessions() {
  const app = useApp();
  const { open, close } = useOverlay("sessions", "sheet");
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
      {open && <SessionPicks query={query} commit={now} />}
    </Dialog>
  );
}
