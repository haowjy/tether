// One server on Home (browser-behaviors.md "Home"): its name and status, the open tabs on it, and
// what its state offers: All N sessions, Files, or Retry. One card for one server or several. A view
// over props, so the harness can draw every state; `Home` derives them from the host and the cache.
import type { ComponentChildren } from "preact";
import { Button } from "../../ui/primitives/Button";
import { IconButton } from "../../ui/primitives/IconButton";
import type { IconName } from "../../ui/primitives/Icon";
import { Row } from "../../ui/primitives/Row";
import { Spinner } from "../../ui/primitives/Spinner";
import { STATUS, type CardBody, type CardStatus } from "./card";
import styles from "./ServerCard.module.css";

const STATUS_WORDS: Record<CardStatus, string> = { live: "live", checking: "checking", offline: "offline", attention: "needs attention" };

/** How long ago `then` was, in the words a status line uses. */
function ago(then: number): string {
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${String(hours)} ${hours === 1 ? "hour" : "hours"} ago` : `${String(Math.floor(hours / 24))} days ago`;
}

export interface CardTab {
  id: string;
  icon: IconName;
  label: string;
  /** The tab's connection when it isn't fine: "Checking…", "Reconnecting…". */
  meta: string | undefined;
  selected: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export interface ServerCardProps {
  name: string;
  tabs: CardTab[];
  body: CardBody;
  /** Looks at the server again: admission when it can't be reached, the sessions otherwise. */
  onRetry: () => void;
  onSessions: (opener: HTMLElement) => void;
  /** New session, for a server with none. */
  newSession: ComponentChildren;
  /** A new Files tab at this server's roots; absent while the server can't be browsed. */
  onFiles: (() => void) | undefined;
}

function Note({ children }: { children: ComponentChildren }) {
  return <p class={styles.note}>{children}</p>;
}

function Body({ name, body, onRetry, onSessions, newSession }: Omit<ServerCardProps, "tabs" | "onFiles">) {
  const retry = <Button variant="secondary" icon="refresh" onClick={onRetry}>Retry</Button>;
  switch (body.kind) {
    case "offline":
      return (
        <>
          <Note>{body.reachedAt ? `Last reached ${ago(body.reachedAt)}.` : "Not reached since this page opened."} Check that it is on and on your tailnet.</Note>
          {retry}
        </>
      );
    case "attention":
      return <Note>tether can't use {name} yet. The notice above says why.</Note>;
    case "checking":
    case "loading":
      return <div class={styles.loading}><Spinner label="Loading sessions" /><span>Loading sessions</span></div>;
    case "failed":
      return (
        <>
          <Note>Couldn't load the sessions on {name}.</Note>
          {retry}
        </>
      );
    case "noTmux":
      return (
        <>
          <Note>tmux isn't running on {name}. tether never starts it: start tmux there, then retry.</Note>
          {retry}
        </>
      );
    case "empty":
      return (
        <>
          <Note>No sessions yet.</Note>
          <div class={styles.actions}>{newSession}</div>
        </>
      );
    case "ready":
      return <Row icon="sessions" label={`All ${String(body.count)} sessions`} trailing="chevron" onClick={(e) => { onSessions(e.currentTarget); }} />;
  }
}

export function ServerCard({ name, tabs, body, onRetry, onSessions, newSession, onFiles }: ServerCardProps) {
  return (
    <section class={styles.card} aria-label={name}>
      <div class={styles.head}>
        <h2 class={styles.name}>{name}</h2>
        <span class={styles.status} data-status={STATUS[body.kind]}>{STATUS_WORDS[STATUS[body.kind]]}</span>
      </div>
      {tabs.map((t) => (
        <div key={t.id} class={styles.tab}>
          <Row icon={t.icon} label={t.label} meta={t.meta} selected={t.selected} onClick={t.onOpen} />
          <IconButton icon="close" label={`Close ${t.label}`} onClick={t.onClose} />
        </div>
      ))}
      <Body name={name} body={body} onRetry={onRetry} onSessions={onSessions} newSession={newSession} />
      {onFiles && <Row icon="folder" label="Files" trailing="chevron" onClick={onFiles} />}
    </section>
  );
}
