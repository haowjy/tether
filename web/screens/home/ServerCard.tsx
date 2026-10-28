// One server on Home (browser-behaviors.md "Home"): its name and status, the open tabs on it, and
// what its state offers: Sessions and files, or Retry. One card for one server or several. A view
// over props, so the harness can draw every state; `Home` derives them from the host and the cache.
import type { ComponentChildren } from "preact";
import { BellDot } from "../../ui/primitives/BellDot";
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
  /** A bell rang in the tab's session since this device last showed it. */
  bell: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export interface ServerCardProps {
  name: string;
  tabs: CardTab[];
  body: CardBody;
  /** What is wrong with the server, when something is: its host banner. */
  notice: ComponentChildren;
  /** The daemon can't read tmux's bell state on this server: said in words, never a silent dot-free tab. */
  bellsUnavailable: boolean;
  /** Looks at the server again: admission when it can't be reached, the sessions otherwise. */
  onRetry: () => void;
  /** New session, for a server with none. */
  newSession: ComponentChildren;
  /** The one row into this server's sessions and folders: its session count, if known, and opening the full-height picker. Absent while the server can't be picked from. */
  picker: { count: number | null; onOpen: (opener: HTMLElement) => void } | undefined;
}

function Note({ children }: { children: ComponentChildren }) {
  return <p class={styles.note}>{children}</p>;
}

function Body({ name, body, onRetry, newSession }: Pick<ServerCardProps, "name" | "body" | "onRetry" | "newSession">) {
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
      return <Note>tether can't use {name} yet.</Note>;
    case "checking":
      return <div class={styles.loading}><Spinner label="Checking access" /><span>Checking access</span></div>;
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
      return null;
  }
}

export function ServerCard({ name, tabs, body, notice, bellsUnavailable, onRetry, newSession, picker }: ServerCardProps) {
  return (
    <section class={styles.card} aria-label={name}>
      <div class={styles.head}>
        <h2 class={styles.name}>{name}</h2>
        <span class={styles.status} data-status={STATUS[body.kind]}>{STATUS_WORDS[STATUS[body.kind]]}</span>
      </div>
      {notice}
      {bellsUnavailable && <Note>Bell tracking unavailable on this host</Note>}
      {tabs.map((t) => (
        <div key={t.id} class={styles.tab}>
          <Row icon={t.icon} label={t.label} mark={t.bell ? <BellDot /> : undefined} meta={t.meta} selected={t.selected} onClick={t.onOpen} />
          <IconButton icon="close" label={`Close ${t.label}`} onClick={t.onClose} />
        </div>
      ))}
      {picker && (
        <Row
          icon="sessions"
          label="Sessions and files"
          meta={picker.count === null ? undefined : String(picker.count)}
          trailing="chevron"
          onClick={(e) => { picker.onOpen(e.currentTarget); }}
        />
      )}
      <Body name={name} body={body} onRetry={onRetry} newSession={newSession} />
    </section>
  );
}
