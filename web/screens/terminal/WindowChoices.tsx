// The desktop windows menu's rows (browser-behaviors.md "Window switcher"): the active tab's
// session's windows when it has two or more, then "New window". "Shown" marks the window the
// tab's latest `watching` names, not the listing's `active`, which can be older. The rows' place
// reads "Loading windows" until the listing arrives, and a refused listing says why, with Try
// again. The phone lists windows under the active session's row instead (sessions/SessionList.tsx).
import { useApp } from "../../app/context";
import { findSession } from "../../sessions/groups";
import type { WindowListing } from "../../proto/generated/messages";
import type { TerminalTab } from "../../workspace/state";
import { Button } from "../../ui/primitives/Button";
import { RovingList } from "../../ui/primitives/RovingList";
import { Row } from "../../ui/primitives/Row";
import { Spinner } from "../../ui/primitives/Spinner";
import { useStore } from "../../ui/store";
import { terminalsOf } from "./terminals";
import styles from "./WindowChoices.module.css";

/** What the rows' place holds: waiting for the listing, a listing that failed with nothing cached, or the session's windows. */
type WindowsState = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; windows: readonly WindowListing[] };

interface WindowChoicesProps {
  tab: TerminalTab;
  /** A window other than the shown one was chosen. */
  onChoose: (window: number) => void;
  /** The shown window was chosen: nothing changes but the menu closes. */
  onShown: () => void;
  /** "New window" was pressed: the creation form opens from `opener`. */
  onNew: (opener: HTMLElement) => void;
}

/** The menu's rows for an open tab, from the cached listing and the tab's own `watching`. */
export function WindowChoices({ tab, onChoose, onShown, onNew }: WindowChoicesProps) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const client = app.hosts.byHostId(tab.host);
  const handle = client?.entry.handle;
  const cached = useStore(app.sessions, (s) => (handle === undefined ? undefined : s.hosts[handle]));
  const shownId = useStore(terminals, (s) => s.tabs[tab.id]?.shown?.id ?? null);
  const listing = cached?.listing;
  let windows: WindowsState;
  if (listing === undefined) {
    const message = cached?.failure === "refused" ? `${client?.name ?? "The server"} refused the window list.` : "Couldn't load the windows.";
    windows = cached?.failure ? { kind: "failed", message } : { kind: "loading" };
  } else {
    windows = { kind: "ready", windows: (listing && findSession(listing, tab.key.session)?.windows) || [] };
  }

  let rows;
  if (windows.kind === "loading") {
    rows = (
      <div class={styles.loading}>
        <Spinner label="Loading windows" />
        <span>Loading windows</span>
      </div>
    );
  } else if (windows.kind === "failed") {
    rows = (
      <div class={styles.problem}>
        <p>{windows.message}</p>
        <Button variant="secondary" icon="refresh" data-roving="" role="menuitem" onClick={() => { if (handle !== undefined) app.listing.refresh(handle); }}>Try again</Button>
      </div>
    );
  } else if (windows.windows.length >= 2) {
    rows = windows.windows.map((w) => (
      <Row
        key={w.id}
        roving
        role="menuitem"
        icon="terminal"
        label={`${String(w.index)}: ${w.name}`}
        meta={w.id === shownId ? "shown" : undefined}
        selected={w.id === shownId}
        onClick={() => { if (w.id === shownId) onShown(); else onChoose(w.id); }}
      />
    ));
  }
  return (
    <section class={styles.block} aria-label={`Windows in ${tab.session}`}>
      <RovingList label={`Windows in ${tab.session}`} role="menu" class={styles.list}>
        {rows}
        <Button variant="quiet" icon="plus" class={styles.new} data-roving="" role="menuitem" onClick={(e) => { onNew(e.currentTarget); }}>New window</Button>
      </RovingList>
    </section>
  );
}
