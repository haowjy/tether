// The Open session picker behind terminal `+` (client-architecture.md §6.3): existing windows
// only, the same hierarchy and rows as Home, a centred dialog on desktop and a tall sheet on
// a phone. The router owns when it is open, so Back, Escape and the backdrop all close it the
// same way, leaving the active tab as it was.
import { useEffect, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { tabId } from "../../platform/tabKey";
import { Dialog } from "../../ui/primitives/Dialog";
import { SearchField } from "../../ui/primitives/TextField";
import { SessionList } from "../home/SessionList";
import { closeOverlayThen } from "../home/overlay";
import { openWindow } from "../home/openWindow";
import { retryListing, toggleExpanded, useSessions } from "../home/useSessions";
import styles from "./Picker.module.css";

const LISTABLE = new Set(["admitted", "deciding", "unreachable"]);
const NONE: ReadonlySet<string> = new Set();

/** Mounted only while the picker is open, so every open starts with an empty search and a fresh listing. */
function PickerBody() {
  const app = useApp();
  const hosts = useAppView((v) => v.hosts);
  const workspace = useAppView((v) => v.workspace);
  const { state } = useSessions(app);
  const [query, setQuery] = useState("");
  const open = new Set(workspace.tabs.map((t) => t.id));

  useEffect(() => {
    for (const h of app.hosts.all()) app.sessions.expectFresh(h.entry.handle);
  }, [app]);

  return (
    <div class={styles.body}>
      <SearchField label="Find a session" placeholder="Find a session" value={query} onInput={setQuery} data-initial-focus="" />
      {hosts.filter((h) => LISTABLE.has(h.admission.kind)).map((h) => {
        const handle = h.entry.handle;
        return (
          <SessionList
            key={handle}
            hostName={h.name ?? "the server"}
            unreachable={h.admission.kind === "unreachable"}
            sessions={state.hosts[handle]}
            expanded={(h.hostId !== null && state.expanded[h.hostId]) || NONE}
            query={query}
            isOpen={(w) => {
              const listing = state.hosts[handle]?.listing;
              return h.hostId !== null && listing != null && open.has(tabId({ host: h.hostId, window: { server: listing.server, window: w.id } }));
            }}
            onToggle={(key) => { if (h.hostId !== null) toggleExpanded(app, h.hostId, key); }}
            onOpen={(listing, session, window) => { closeOverlayThen(app, () => { openWindow(app, h, listing, session, window); }); }}
            onRetry={() => { if (h.admission.kind === "unreachable") app.hosts.recheck(handle); else retryListing(app, handle); }}
          />
        );
      })}
    </div>
  );
}

export function Picker() {
  const app = useApp();
  const open = useAppView((v) => v.nav.entry.overlay?.screen === "picker");
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const touch = useAppView((v) => v.viewport.density === "touch");
  const noTabs = useAppView((v) => v.workspace.tabs.length === 0);
  return (
    <Dialog
      open={open}
      title="Open session"
      variant={phone ? "sheet" : "dialog"}
      returnFocusTo={noTabs || touch ? "plus" : "terminal"}
      // A fine pointer starts in the search; a phone never does, so the keyboard stays down.
      initialFocus={() => document.querySelector<HTMLElement>("[role='searchbox'][data-initial-focus='']")}
      onClose={() => { app.router.closeOverlay(); }}
    >
      {open && <PickerBody />}
    </Dialog>
  );
}
