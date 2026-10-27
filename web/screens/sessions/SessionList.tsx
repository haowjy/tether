// One host's sessions, as Home and the sessions overlay draw them (the same rows in both,
// per the contract): a heading with the host's name, then loading, error, no-server, empty,
// no-match or one row per session. A view over the cache's state; it fetches and navigates nothing.
import { Fragment, type ComponentChildren } from "preact";
import type { HostSessions } from "../../sessions/cache";
import { matching, windowCount } from "../../sessions/groups";
import type { SessionListing, TmuxListing } from "../../proto/generated/messages";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { RovingList } from "../../ui/primitives/RovingList";
import { Row } from "../../ui/primitives/Row";
import { Spinner } from "../../ui/primitives/Spinner";
import styles from "./SessionList.module.css";

/** The active tab, when the list marks it: its session reads "here", and with several windows lists them beneath its row. */
export interface ActiveTab {
  id: string;
  /** The window the tab shows: its latest `watching`'s, which can be newer than the listing's `active`. */
  shownId: number | null;
  /** A window other than the shown one was chosen. */
  onWindow: (window: number) => void;
}

export interface SessionListProps {
  hostName: string;
  /** The host can't be reached at all (admission), as opposed to a listing that failed. */
  unreachable: boolean;
  sessions: HostSessions | undefined;
  query: string;
  /** The id of this session's tab, whether or not it is open. */
  tabIdOf: (session: SessionListing) => string | null;
  /** The ids of the open tabs. */
  open: ReadonlySet<string>;
  /** Its session reads "here" and other open sessions "open", in words and never dots. */
  active?: ActiveTab;
  onOpen: (listing: TmuxListing, session: SessionListing) => void;
  /** A fresh listing, or admission again when the host is unreachable. */
  onRetry: () => void;
  /** Home: "Files" (a new Files tab at this host's folder list) and "New session" beside the heading. */
  creation?: { onNewSession: (opener: HTMLElement) => void; onFiles: () => void };
}

function Heading({ hostName, status, action }: { hostName: string; status: ComponentChildren; action: ComponentChildren }) {
  return (
    <div class={styles.heading}>
      <h2 class={styles.title}>On {hostName}</h2>
      <span class={styles.status} role="status">{status}</span>
      {action && <div class={styles.action}>{action}</div>}
    </div>
  );
}

export function SessionList(props: SessionListProps) {
  const { hostName, unreachable, sessions, query, tabIdOf, open, active, onOpen, onRetry, creation } = props;
  const listing = sessions?.listing;
  const failure = sessions?.failure ?? null;
  const reason = unreachable ? `${hostName} can't be reached` : undefined;
  const actions = creation && (
    <>
      <Button variant="secondary" icon="folder" disabledReason={reason} onClick={creation.onFiles}>Files</Button>
      <Button variant="secondary" icon="plus" disabledReason={reason} onClick={(e) => { creation.onNewSession(e.currentTarget); }}>New session</Button>
    </>
  );

  let status: ComponentChildren = null;
  if (listing !== undefined && failure !== null) {
    status = (
      <>
        <span>{failure === "offline" ? "Can't update. Showing the last list." : `${hostName} refused the update. Showing the last list.`}</span>
        <Button variant="quiet" onClick={onRetry}>Retry</Button>
      </>
    );
  } else if (sessions?.updating && listing !== undefined) {
    status = <span class={styles.updating}>Updating</span>;
  }

  let body: ComponentChildren;
  if (listing === undefined) {
    if (unreachable) {
      body = <EmptyState icon="alert" title="Sessions can't load yet">They load when {hostName} is reachable. Your open tabs and drafts are kept.</EmptyState>;
    } else if (failure !== null) {
      body = (
        <EmptyState
          icon="alert"
          title={failure === "offline" ? "Couldn't load sessions" : `${hostName} refused the request`}
          action={<Button variant="secondary" icon="refresh" onClick={onRetry}>Retry</Button>}
        >
          {failure === "offline" ? `tether couldn't get an answer from ${hostName}.` : "Try again in a moment."}
        </EmptyState>
      );
    } else {
      body = (
        <div class={styles.loading}>
          <Spinner label="Loading sessions" />
          <span>Loading sessions</span>
        </div>
      );
    }
  } else if (listing === null) {
    body = (
      <EmptyState
        icon="terminal"
        title={`No tmux server is running on ${hostName}`}
        action={<Button variant="secondary" icon="refresh" onClick={onRetry}>Retry</Button>}
      >
        tether never starts one. Start tmux on the server, then retry.
      </EmptyState>
    );
  } else if (listing.sessions.length === 0) {
    body = <EmptyState icon="sessions" title={`No sessions on ${hostName}`}>{creation ? "Create one with New session." : "Create one from Home."}</EmptyState>;
  } else {
    const shown = matching(listing, query);
    body =
      shown.length === 0 ? (
        <EmptyState icon="search" title="No matching sessions">Nothing on {hostName} matches "{query.trim()}".</EmptyState>
      ) : (
        <RovingList label={`Sessions on ${hostName}`} class={styles.list}>
          {shown.map((session) => {
            const id = tabIdOf(session);
            const isOpen = id !== null && open.has(id);
            const here = active !== undefined && id === active.id;
            return (
              <Fragment key={session.id}>
                <Row
                  roving
                  icon="sessions"
                  label={session.name}
                  meta={
                    <>
                      <span>{windowCount(session.windows.length)}</span>
                      {isOpen && <span class={styles.state}>{here ? "here" : "open"}</span>}
                    </>
                  }
                  selected={isOpen}
                  onClick={() => { onOpen(listing, session); }}
                />
                {here && session.windows.length > 1 && (
                  <div class={styles.windows} role="group" aria-label={`Windows in ${session.name}`}>
                    {session.windows.map((w) => {
                      const shown = w.id === active.shownId;
                      return (
                        <Row
                          key={w.id}
                          roving
                          icon="terminal"
                          label={`${String(w.index)}: ${w.name}`}
                          meta={shown ? "shown" : undefined}
                          selected={shown}
                          onClick={() => { if (!shown) active.onWindow(w.id); }}
                        />
                      );
                    })}
                  </div>
                )}
              </Fragment>
            );
          })}
        </RovingList>
      );
  }

  return (
    <section class={styles.section} aria-label={`Sessions on ${hostName}`}>
      <Heading hostName={hostName} status={status} action={actions} />
      {body}
    </section>
  );
}
