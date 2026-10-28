// One server on Home (browser-behaviors.md "Home"): its name and status, the open tabs on it, and
// what its state offers: All sessions and files, or Retry. One card for one server or several. A view
// over props, so the harness can draw every state; `Home` derives them from the host and the cache.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { BellDot } from "../../ui/primitives/BellDot";
import { Button } from "../../ui/primitives/Button";
import { IconButton } from "../../ui/primitives/IconButton";
import type { IconName } from "../../ui/primitives/Icon";
import { Row } from "../../ui/primitives/Row";
import { Spinner } from "../../ui/primitives/Spinner";
import { STATUS, type CardBody, type CardStatus } from "./card";
import styles from "./ServerCard.module.css";

const STATUS_WORDS: Record<CardStatus, string> = { live: "live", checking: "checking", offline: "offline", attention: "needs attention" };

/** Tab rows a card shows before the "All sessions and files" row: Home is a way in, not the tab list. */
const SHOWN_TABS = 3;
/** The width the Close action slides out, in px; `--reveal` in the module's CSS. */
const REVEAL = 88;

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
  /** The one row into this server's sessions and folders: its session count, if known, and opening the picker (on a tab, so picks have something to change). Absent while the server can't be picked from. */
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
  // One revealed Close at a time, as a list of swipeable rows behaves.
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section class={styles.card} aria-label={name}>
      <div class={styles.head}>
        <h2 class={styles.name}>{name}</h2>
        <span class={styles.status} data-status={STATUS[body.kind]}>{STATUS_WORDS[STATUS[body.kind]]}</span>
      </div>
      {notice}
      {bellsUnavailable && <Note>Bell tracking unavailable on this host</Note>}
      {tabs.slice(0, SHOWN_TABS).map((t) => (
        <TabRow key={t.id} tab={t} open={open === t.id} onReveal={(shown) => { setOpen(shown ? t.id : null); }} />
      ))}
      {picker && (
        <Row
          icon="sessions"
          label="All sessions and files"
          meta={picker.count === null ? undefined : String(picker.count)}
          trailing="chevron"
          onClick={(e) => { picker.onOpen(e.currentTarget); }}
        />
      )}
      <Body name={name} body={body} onRetry={onRetry} newSession={newSession} />
    </section>
  );
}

/**
 * A tab row that closes by swiping left (as iOS lists do), revealing a Close action; a long swipe
 * closes at once. The action is a real button behind the row, so a screen reader reaches it without
 * the gesture; the row is opaque, and `pan-y` leaves vertical scrolling to the browser.
 */
function TabRow({ tab, open, onReveal }: { tab: CardTab; open: boolean; onReveal: (shown: boolean) => void }) {
  const slide = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; base: number; px: number; axis: "unknown" | "x" | "y" } | null>(null);
  // A drag ends on the row's own click: it would open the tab the user was only swiping.
  const swiped = useRef(false);

  const move = (px: number): void => {
    const el = slide.current;
    if (el) el.style.transform = `translateX(${String(px)}px)`;
  };
  // The action is painted only while the row is off it: behind a closed row its rounded corners
  // would show as red slivers at the row's edge.
  const show = (on: boolean): void => {
    const el = action.current;
    if (el) el.style.opacity = on ? "1" : "";
  };
  useEffect(() => { move(open ? -REVEAL : 0); show(open); }, [open]);

  const end = (): void => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.axis !== "x") { move(open ? -REVEAL : 0); show(open); return; }
    swiped.current = true;
    if (d.px <= -(REVEAL + 24)) { move(0); show(false); onReveal(false); tab.onClose(); return; }
    onReveal(d.px <= -REVEAL / 2);
  };

  return (
    <div class={styles.tab} data-open={open ? "" : undefined} onPointerDownCapture={() => { swiped.current = false; }} onClickCapture={(e) => {
      if (!swiped.current) return;
      swiped.current = false;
      e.preventDefault();
      e.stopPropagation();
    }}>
      <div
        ref={slide}
        class={styles.slide}
        onPointerDown={(e) => {
          // A mouse can't swipe: it gets the × beside the row instead, so only one affordance is live.
          if (e.pointerType === "mouse") return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const base = open ? -REVEAL : 0;
          drag.current = { x: e.clientX, y: e.clientY, base, px: base, axis: "unknown" };
          swiped.current = false;
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (d.axis === "unknown") {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
            if (d.axis === "y") return; // the browser is scrolling the page
          }
          if (d.axis !== "x") return;
          show(true);
          d.px = Math.max(-REVEAL - 40, Math.min(0, d.base + dx));
          move(d.px);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        <Row icon={tab.icon} label={tab.label} mark={tab.bell ? <BellDot /> : undefined} meta={tab.meta} selected={tab.selected} onClick={() => {
          // A tap on a revealed row closes the reveal, as a list of swipeable rows does, rather than opening.
          if (open) { onReveal(false); return; }
          tab.onOpen();
        }} />
      </div>
      <div ref={action} class={styles.action}>
        <Button variant="secondary" class={styles.close} aria-label={`Close ${tab.label}`} onClick={() => { onReveal(false); tab.onClose(); }}>Close</Button>
      </div>
      <IconButton icon="close" label={`Close ${tab.label}`} class={styles.x} onClick={tab.onClose} />    </div>
  );
}

