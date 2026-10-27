// The desktop's sessions picker: the router overlay `{ screen: "sessions", name: "picker" }`,
// opened by the top row's +, as a popover under that row anchored to +. Search (in focus), every
// session by server with the active tab's windows under its row, and New session / Browse files.
// Any pick closes it and then acts, so the tab it opens is the one that gets focus back; Escape or
// a press outside dismisses it and leaves the active tab as it is.
import { useApp, useAppView, useOverlay } from "../../app/context";
import { Dialog } from "../../ui/primitives/Dialog";
import { SearchField } from "../../ui/primitives/TextField";
import { NewActions } from "./NewActions";
import { SessionPicks, useQuery, type Commit } from "./SessionPicks";
import styles from "./Sessions.module.css";

/** `anchor` is the top row's +, which the popover sits under. */
export function Picker({ anchor }: { anchor: HTMLElement | null }) {
  const app = useApp();
  const { open, close } = useOverlay("sessions", "picker");
  const touch = useAppView((v) => v.viewport.density === "touch");
  const noTabs = useAppView((v) => v.workspace.tabs.length === 0);
  const [query, setQuery] = useQuery(open);
  const commit: Commit = (pick) => { app.router.closeOverlay(pick); };
  return (
    <Dialog
      open={open}
      title="Open session"
      variant="popover"
      anchor={anchor}
      returnFocusTo={noTabs || touch ? "plus" : "terminal"}
      onClose={close}
      header={<SearchField label="Find a session" placeholder="Find a session" value={query} onInput={setQuery} class={styles.search} data-initial-focus="" />}
      footer={open && <div class={styles.actions}><NewActions commit={commit} /></div>}
    >
      {open && <SessionPicks query={query} commit={commit} />}
    </Dialog>
  );
}
