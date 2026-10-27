// One server on Home (browser-behaviors.md "Home"): its name and status, the open tabs on it, and
// what its state offers: All N sessions, Files, or Retry. One card for one server or several. A view
// over props, so the harness can draw every state; `Home` derives them from the host and the cache.
import type { ComponentChildren } from "preact";
import { Button } from "../../ui/primitives/Button";
import { IconButton } from "../../ui/primitives/IconButton";
import type { IconName } from "../../ui/primitives/Icon";
import { Row } from "../../ui/primitives/Row";
import { Spinner } from "../../ui/primitives/Spinner";
import styles from "./ServerCard.module.css";

export type CardStatus = "live" | "checking" | "offline" | "attention";

const STATUS_WORDS: Record<CardStatus, string> = { live: "live", checking: "checking", offline: "offline", attention: "needs attention" };

/** What sits under the tab rows: one per way a server can be. */
export type CardBody =
  /** The host can't be reached; `reachedAgo` is when this page last did, if it has. */
  | { kind: "offline"; reachedAgo: string | null; onRetry: () => void }
  /** Admission needs the user (the banner above says what); nothing here acts on it. */
  | { kind: "attention" }
  | { kind: "loading" }
  | { kind: "failed"; onRetry: () => void }
  /** The daemon says no tmux server is running. tether never starts one, so the only action is looking again. */
  | { kind: "noTmux"; onRetry: () => void }
  /** A live server with no sessions: the caller's creation actions. */
  | { kind: "empty"; actions: ComponentChildren }
  | { kind: "ready"; count: number; onSessions: (opener: HTMLElement) => void };

export interface CardTab {
  id: string;
  icon: IconName;
  label: string;
  /** "Checking…" or "Reconnecting…" for a restored terminal tab not yet proven. */
  waiting: string | undefined;
  selected: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export interface ServerCardProps {
  name: string;
  status: CardStatus;
  tabs: CardTab[];
  body: CardBody;
  /** A new Files tab at this server's roots; absent while the server can't be browsed. */
  onFiles: (() => void) | undefined;
}

function Note({ children }: { children: ComponentChildren }) {
  return <p class={styles.note}>{children}</p>;
}

function Body({ name, body }: { name: string; body: CardBody }) {
  switch (body.kind) {
    case "offline":
      return (
        <>
          <Note>{body.reachedAgo ? `Last reached ${body.reachedAgo}.` : "Not reached since this page opened."} Check that it is on and on your tailnet.</Note>
          <Button variant="secondary" icon="refresh" onClick={body.onRetry}>Retry</Button>
        </>
      );
    case "attention":
      return <Note>tether can't use {name} yet. The notice above says why.</Note>;
    case "loading":
      return <div class={styles.loading}><Spinner label="Loading sessions" /><span>Loading sessions</span></div>;
    case "failed":
      return (
        <>
          <Note>Couldn't load the sessions on {name}.</Note>
          <Button variant="secondary" icon="refresh" onClick={body.onRetry}>Retry</Button>
        </>
      );
    case "noTmux":
      return (
        <>
          <Note>tmux isn't running on {name}. tether never starts it: start tmux there, then retry.</Note>
          <Button variant="secondary" icon="refresh" onClick={body.onRetry}>Retry</Button>
        </>
      );
    case "empty":
      return (
        <>
          <Note>No sessions yet.</Note>
          <div class={styles.actions}>{body.actions}</div>
        </>
      );
    case "ready":
      return <Row icon="sessions" label={`All ${String(body.count)} sessions`} trailing="chevron" onClick={(e) => { body.onSessions(e.currentTarget); }} />;
  }
}

export function ServerCard({ name, status, tabs, body, onFiles }: ServerCardProps) {
  return (
    <section class={styles.card} aria-label={name}>
      <div class={styles.head}>
        <h2 class={styles.name}>{name}</h2>
        <span class={styles.status} data-status={status}>{STATUS_WORDS[status]}</span>
      </div>
      {tabs.map((t) => (
        <div key={t.id} class={styles.tab}>
          <Row icon={t.icon} label={t.label} meta={t.waiting} selected={t.selected} onClick={t.onOpen} />
          <IconButton icon="close" label={`Close ${t.label}`} onClick={t.onClose} />
        </div>
      ))}
      <Body name={name} body={body} />
      {onFiles && body.kind !== "empty" && <Row icon="folder" label="Files" trailing="chevron" onClick={onFiles} />}
    </section>
  );
}
