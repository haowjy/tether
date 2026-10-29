// One host's sessions, as Home and the sessions overlay draw them (the same rows in both,
// per the contract): a heading with the host's name, then loading, error, no-server, empty,
// no-match or one row per session. A view over the cache's state; it fetches and navigates nothing.
import { Fragment, type ComponentChildren } from "preact";
import type { BellLook } from "../../sessions/bells";
import type { HostSessions } from "../../sessions/cache";
import { matching, windowCount } from "../../sessions/groups";
import type { SessionListing, TmuxListing } from "../../proto/generated/messages";
import { BellDot } from "../../ui/primitives/BellDot";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { RovingList } from "../../ui/primitives/RovingList";
import { Row } from "../../ui/primitives/Row";
import { HostSection, Loading } from "./HostSection";
import { listClass, NoMatches, StateMark, Unreachable } from "./PickRows";
import styles from "./SessionList.module.css";

/** What a session's row says about it: its tab is the one on screen ("here"), open ("open"), or neither, in words; and the bell dot or the words that no dot can appear. */
export interface RowState {
  state: "here" | "open" | null;
  bell: BellLook;
}

/** The active tab's windows: the "here" session with several lists them beneath its row. */
export interface ActiveWindows {
  /** The window the tab shows: its latest `watching`'s, which can be newer than the listing's `active`. */
  shownId: number | null;
  /** A window other than the shown one was chosen. */
  onWindow: (window: number) => void;
}

export interface SessionListProps {
  hostName: string;
  /** Several servers are listed: the block carries its server's name. */
  titled: boolean;
  /** The host can't be reached at all (admission), as opposed to a listing that failed. */
  unreachable: boolean;
  /** The daemon can't read tmux's bell state on this host. */
  bellsUnavailable: boolean;
  sessions: HostSessions | undefined;
  query: string;
  rowOf: (session: SessionListing) => RowState;
  active?: ActiveWindows;
  onOpen: (listing: TmuxListing, session: SessionListing) => void;
  /** The list's last row: a new session on this server, its name the search when no session matches it. */
  onNew: (name: string) => void;
  /** Why the row can't act (the server can't be reached or isn't known yet). */
  newDisabled?: string | undefined;
  /** A fresh listing, or admission again when the host is unreachable. */
  onRetry: () => void;
}

export function SessionList(props: SessionListProps) {
  const { hostName, titled, unreachable, bellsUnavailable, sessions, query, rowOf, active, onOpen, onNew, newDisabled, onRetry } = props;
  const listing = sessions?.listing;
  const failure = sessions?.failure ?? null;
  let status: ComponentChildren = null;
  if (listing !== undefined && failure !== null) {
    status = (
      <>
        <span>{failure === "offline" ? "Can't update. Showing the last list." : `${hostName} refused the update. Showing the last list.`}</span>
        <Button variant="quiet" onClick={onRetry}>Retry</Button>
      </>
    );
  } else if (sessions?.updating && listing !== undefined && titled) {
    // Only beside a heading: on a line of its own, "Updating" would shift the rows about to be tapped.
    status = <span class={styles.updating}>Updating</span>;
  }
  if (bellsUnavailable) {
    status = <>{status}<span>Bell tracking unavailable on this host</span></>;
  }

  let body: ComponentChildren;
  // A tmux server that is running can have a session added; with none, nothing here starts one.
  let newRow: ComponentChildren = null;
  if (listing === undefined) {
    if (unreachable) {
      body = <Unreachable what="Sessions" hostName={hostName} more="Your open tabs and drafts are kept." />;
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
      body = <Loading what="Loading sessions" />;
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
    body = <EmptyState icon="sessions" title={`No sessions on ${hostName}`} />;
  } else {
    const shown = matching(listing, query);
    body =
      shown.length === 0 ? (
        <NoMatches what="sessions" hostName={hostName} query={query} />
      ) : (
        <RovingList label={`Sessions on ${hostName}`} class={listClass}>
          {shown.map((session) => {
            const { state, bell } = rowOf(session);
            return (
              <Fragment key={session.id}>
                <Row
                  roving
                  icon="sessions"
                  label={session.name}
                  mark={bell.ring ? <BellDot /> : undefined}
                  meta={
                    <>
                      <span>{windowCount(session.windows.length)}</span>
                      <StateMark state={state} />
                    </>
                  }
                  selected={state === "here"}
                  onClick={() => { onOpen(listing, session); }}
                />
                {bell.hidden && <p class={styles.hidden}>tmux settings hide bells in this session</p>}
                {state === "here" && active && session.windows.length > 1 && (
                  <div class={styles.windows} role="group" aria-label={`Windows in ${session.name}`}>
                    {session.windows.map((w) => {
                      const shown = w.id === active.shownId;
                      return (
                        <Row
                          key={w.id}
                          roving
                          icon="terminal"
                          label={`${String(w.index)}: ${w.name}`}
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
  if (listing) {
    const typed = query.trim();
    const unmatched = matching(listing, query).length === 0;
    newRow = (
      <RovingList label="New" class={listClass}>
        <Row roving icon="plus" label={unmatched && typed ? `New session "${typed}"` : "New session"} trailing="chevron" disabled={newDisabled !== undefined} onClick={() => { onNew(unmatched ? typed : ""); }} />
      </RovingList>
    );
  }

  return (
    <HostSection hostName={hostName} titled={titled} label={`Sessions on ${hostName}`} status={status}>{body}{newRow}</HostSection>
  );
}
