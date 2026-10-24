// Every state of the sessions list on one page, for design review and axe: the states a real
// daemon only reaches with a dead socket or a refusal. Real flows are in e2e/home.
import type { ComponentChildren } from "preact";
import type { HostSessions } from "../../sessions/cache";
import { LISTING } from "../shared";
import { SessionList } from "../../screens/sessions/SessionList";

const NO_OP = (): void => undefined;
const fresh = { failure: null, updating: false } as const;

const STATES: { name: string; unreachable?: boolean; sessions?: HostSessions; query?: string; expanded?: string[] }[] = [
  { name: "Loading" },
  { name: "Unreachable", unreachable: true },
  { name: "Offline, nothing cached", sessions: { listing: undefined, failure: "offline", updating: false } },
  { name: "Refused, nothing cached", sessions: { listing: undefined, failure: "refused", updating: false } },
  { name: "No tmux server", sessions: { listing: null, ...fresh } },
  { name: "Empty server", sessions: { listing: { server: "main:1-1", version: "3.4", sessions: [] }, ...fresh } },
  { name: "Updating", sessions: { listing: LISTING, ...fresh, updating: true }, expanded: ["main:1-1/1"] },
  { name: "Stale, offline", sessions: { listing: LISTING, failure: "offline", updating: false } },
  { name: "Stale, refused", sessions: { listing: LISTING, failure: "refused", updating: false } },
  { name: "No match", sessions: { listing: LISTING, ...fresh }, query: "zzz" },
];

function Block({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <h2 style={{ fontSize: "12px", opacity: 0.7 }}>{title}</h2>
      {children}
    </div>
  );
}

/** The one open tab, window 1. */
const OPEN: ReadonlySet<string> = new Set(["1"]);

export function States() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: "32px", padding: "16px", maxWidth: "720px", margin: "0 auto", overflowY: "auto", height: "100%" }}>
      <h1>Sessions list states</h1>
      {STATES.map((s) => (
        <Block key={s.name} title={s.name}>
          <SessionList
            // A landmark name must be unique on the page: each list is a different host here.
            hostName={`pop-os (${s.name.toLowerCase()})`}
            unreachable={s.unreachable ?? false}
            sessions={s.sessions}
            expanded={new Set(s.expanded ?? [])}
            query={s.query ?? ""}
            tabIdOf={(w) => String(w.id)}
            open={OPEN}
            onToggle={NO_OP}
            onOpen={NO_OP}
            onRetry={NO_OP}
            creation={{ onNewSession: NO_OP, onNewWindow: NO_OP }}
          />
        </Block>
      ))}
    </main>
  );
}
