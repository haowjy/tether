// The Open session picker behind terminal `+` (client-architecture.md §6.3): existing windows
// only, the same hierarchy and rows as Home, in a centred dialog. On a touch phone the
// switcher is the only picker. The router owns when it is open, so Back, Escape and the
// backdrop all close it the same way, leaving the active tab as it was.
import { useState } from "preact/hooks";
import { useApp, useAppView, useOverlay } from "../../app/context";
import { Dialog } from "../../ui/primitives/Dialog";
import { SearchField } from "../../ui/primitives/TextField";
import { HostSessionLists } from "../sessions/HostSessionLists";
import { openWindow } from "../sessions/openWindow";
import styles from "./Picker.module.css";

/** Mounted only while the picker is open, so every open starts with an empty search and a fresh listing. */
function PickerBody() {
  const app = useApp();
  const [query, setQuery] = useState("");
  return (
    <div class={styles.body}>
      <SearchField label="Find a session" placeholder="Find a session" value={query} onInput={setQuery} data-initial-focus="" />
      <HostSessionLists query={query} onOpen={(h, listing, session, window) => { app.router.closeOverlay(() => { openWindow(app, h, listing, session, window); }); }} />
    </div>
  );
}

export function Picker() {
  const { open, close } = useOverlay("picker");
  const touch = useAppView((v) => v.viewport.density === "touch");
  const noTabs = useAppView((v) => v.workspace.tabs.length === 0);
  return (
    <Dialog
      open={open}
      title="Open session"
      returnFocusTo={noTabs || touch ? "plus" : "terminal"}
      onClose={close}
    >
      {open && <PickerBody />}
    </Dialog>
  );
}
