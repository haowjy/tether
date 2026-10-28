// Every state of the sessions list on one page, for design review: the states a real
// daemon only reaches with a dead socket or a refusal. Real flows are in e2e/home.
import type { ComponentChildren } from "preact";
import type { BellLook } from "../../sessions/bells";
import type { HostSessions } from "../../sessions/cache";
import { LISTING } from "../shared";
import { SessionList, type ActiveWindows, type RowState } from "../../screens/sessions/SessionList";

const NO_OP = (): void => undefined;
const fresh = { reachedAt: null, failure: null, updating: false } as const;

const STATES: { name: string; unreachable?: boolean; bellsUnavailable?: boolean; bell?: BellLook; sessions?: HostSessions; query?: string; active?: ActiveWindows }[] = [
  { name: "Loading" },
  { name: "Unreachable", unreachable: true },
  { name: "Offline, nothing cached", sessions: { listing: undefined, ...fresh, failure: "offline" } },
  { name: "Refused, nothing cached", sessions: { listing: undefined, ...fresh, failure: "refused" } },
  { name: "No tmux server", sessions: { listing: null, ...fresh } },
  { name: "Empty server", sessions: { listing: { server: "main:1-1", version: "3.4", sessions: [] }, ...fresh } },
  { name: "Updating", sessions: { listing: LISTING, ...fresh, updating: true }, active: { shownId: 1, onWindow: NO_OP } },
  { name: "A bell rang in session 2", sessions: { listing: LISTING, ...fresh }, bell: { ring: true, hidden: false } },
  { name: "Bells hidden by tmux settings", sessions: { listing: LISTING, ...fresh }, bell: { ring: false, hidden: true } },
  { name: "Bell tracking unavailable", sessions: { listing: LISTING, ...fresh }, bellsUnavailable: true },
  { name: "Stale, offline", sessions: { listing: LISTING, ...fresh, failure: "offline" } },
  { name: "Stale, refused", sessions: { listing: LISTING, ...fresh, failure: "refused" } },
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

/** The one open tab, session 1, is the one on screen; a state's bell look applies to session 2. */
const rowOf = (bell: BellLook | undefined) => (session: { id: number }): RowState => ({
  state: session.id === 1 ? "here" : null,
  bell: session.id === 2 && bell ? bell : { ring: false, hidden: false },
});

export function States() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: "32px", padding: "16px", maxWidth: "720px", margin: "0 auto", overflowY: "auto", height: "100%" }}>
      <h1>Sessions list states</h1>
      {STATES.map((s) => (
        <Block key={s.name} title={s.name}>
          <SessionList
            // A landmark name must be unique on the page: each list is a different host here.
            titled
            hostName={`pop-os (${s.name.toLowerCase()})`}
            unreachable={s.unreachable ?? false}
            bellsUnavailable={s.bellsUnavailable ?? false}
            sessions={s.sessions}
            query={s.query ?? ""}
            rowOf={rowOf(s.bell)}
            {...(s.active !== undefined && { active: s.active })}
            onOpen={NO_OP}
            onRetry={NO_OP}
          />
        </Block>
      ))}
    </main>
  );
}
