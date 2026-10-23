// One host's sessions, as Home and the picker draw them (the same rows in both, per the
// contract): a heading with the host's name, then loading, error, no-server, empty, no-match
// or the session groups. A view over the cache's state; it fetches and navigates nothing.
import type { ComponentChildren } from "preact";
import type { HostSessions } from "../../sessions/cache";
import { groups, windowCount } from "../../sessions/groups";
import type { SessionListing, TmuxListing, WindowListing } from "../../proto/generated/messages";
import { Button } from "../../ui/primitives/Button";
import { Disclosure } from "../../ui/primitives/Disclosure";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { RovingList } from "../../ui/primitives/RovingList";
import { Row } from "../../ui/primitives/Row";
import { Spinner } from "../../ui/primitives/Spinner";
import styles from "./SessionList.module.css";

export interface SessionListProps {
  hostName: string;
  /** The host can't be reached at all (admission), as opposed to a listing that failed. */
  unreachable: boolean;
  sessions: HostSessions | undefined;
  expanded: ReadonlySet<string>;
  query: string;
  /** Whether the tab for this window is open. */
  isOpen: (window: WindowListing) => boolean;
  onToggle: (key: string) => void;
  onOpen: (listing: TmuxListing, session: SessionListing, window: WindowListing) => void;
  /** A fresh listing, or admission again when the host is unreachable. */
  onRetry: () => void;
  /** Home only: "New session" beside the heading, and "New window" in each session. */
  creation?: { onNewSession: (opener: HTMLElement) => void; onNewWindow: (session: SessionListing, opener: HTMLElement) => void };
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
  const { hostName, unreachable, sessions, expanded, query, isOpen, onToggle, onOpen, onRetry, creation } = props;
  const listing = sessions?.listing;
  const failure = sessions?.failure ?? null;
  const newSession = creation && (
    <Button variant="secondary" icon="plus" disabledReason={unreachable ? `${hostName} can't be reached` : undefined} onClick={(e) => { creation.onNewSession(e.currentTarget); }}>New session</Button>
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
    const shown = groups(listing, query, expanded);
    body =
      shown.length === 0 ? (
        <EmptyState icon="search" title="No matching sessions">Nothing on {hostName} matches "{query.trim()}".</EmptyState>
      ) : (
        <RovingList label={`Sessions on ${hostName}`} class={styles.list}>
          {shown.map((g) => (
            <Disclosure
              key={g.key}
              roving
              icon="sessions"
              label={g.session.name}
              meta={windowCount(g.session.windows.length)}
              expanded={g.expanded}
              onToggle={() => { onToggle(g.key); }}
            >
              {g.session.attachedElsewhere && <p class={styles.attached}>Another terminal is attached. Opening may resize it.</p>}
              {g.windows.map((w) => (
                <Row
                  key={w.id}
                  roving
                  icon="terminal"
                  label={`${String(w.index)}: ${w.name}`}
                  meta={isOpen(w) ? "Open" : undefined}
                  selected={isOpen(w)}
                  onClick={() => { onOpen(listing, g.session, w); }}
                />
              ))}
              {creation && (
                <Button variant="quiet" icon="plus" class={styles.newWindow} data-roving="" onClick={(e) => { creation.onNewWindow(g.session, e.currentTarget); }}>
                  New window
                </Button>
              )}
            </Disclosure>
          ))}
        </RovingList>
      );
  }

  return (
    <section class={styles.section} aria-label={`Sessions on ${hostName}`}>
      <Heading hostName={hostName} status={status} action={newSession} />
      {body}
    </section>
  );
}
