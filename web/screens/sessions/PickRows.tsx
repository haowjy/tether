// What both picker sides draw the same way: the list's card rows, a row's "here" / "open" mark, and the
// states of a server whose list can't be shown.
import { EmptyState } from "../../ui/primitives/EmptyState";
import styles from "./PickRows.module.css";

export const listClass = styles.list;
/** A row with a trailing button beside it (a missing favorite's ×). */
export const lineClass = styles.line;
export const missingClass = styles.missing;

/** A row's mark: its tab is the one on screen ("here") or open ("open"). Sits in the meta slot, after the row's own meta. */
export function StateMark({ state }: { state: "here" | "open" | null }) {
  return state ? <span class={styles.state}>{state}</span> : null;
}

/** `what`: "Sessions" or "Folders". */
export function Unreachable({ what, hostName, more }: { what: string; hostName: string; more?: string }) {
  return <EmptyState icon="alert" title={`${what} can't load yet`}>They load when {hostName} is reachable.{more && ` ${more}`}</EmptyState>;
}

export function NoMatches({ what, hostName, query }: { what: string; hostName: string; query: string }) {
  return <EmptyState icon="search" title={`No matching ${what}`}>Nothing on {hostName} matches "{query.trim()}".</EmptyState>;
}
