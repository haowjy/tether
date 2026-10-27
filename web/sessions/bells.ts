// Bell attention on this device (daemon-core.md §4.8, §5.3; browser-behaviors.md). The daemon
// says each session's bell mark; this device keeps the mark it last showed for each, and a tab
// shows the dot while the two differ. "Seen" is local, never sent, and saved with the workspace
// (app/persist.ts) so a bell rung while the page was closed still shows: tmux's shared bell
// flags are not the phone's. Everything is keyed by the tab id of the session, so a pill,
// a Home row and a session row look the same thing up.
import { tabId } from "../platform/tabKey";
import type { BellChange, BellState, ServerMsg, TmuxListing } from "../proto/generated/messages";
import { Store } from "../ui/store";

type BellMsg = Extract<ServerMsg, { type: "bell" }>["data"];

export interface BellsState {
  /** The daemon's latest mark and coverage, by tab id. */
  marks: Readonly<Record<string, BellState>>;
  /** The mark this device last showed, by tab id. */
  seen: Readonly<Record<string, number>>;
  /** What each host's daemon last said, by host id. */
  hosts: Readonly<Record<string, HostBells>>;
}

interface HostBells {
  /** The tmux instance the host's marks are of; null: no tmux server; undefined: no marks heard from this host yet. */
  server: string | null | undefined;
  /** False while the daemon couldn't read tmux's bell state at its last try. */
  available: boolean;
}

/** What a session's row or tab says about bells. */
export interface BellLook {
  /** A bell since this device last showed the session. */
  ring: boolean;
  /** tmux's settings keep this session's bells from tether, so no dot would not mean no bells. */
  hidden: boolean;
}

export function bellLook(state: BellsState, id: string): BellLook {
  const mark = state.marks[id];
  return { ring: mark !== undefined && mark.mark !== state.seen[id], hidden: mark?.covered === false };
}

/** The host's daemon couldn't read tmux's bell state at its last try. */
export function bellsUnavailable(state: BellsState, hostId: string | null): boolean {
  return hostId !== null && state.hosts[hostId]?.available === false;
}

/** `record` without the keys `drop` picks. */
function dropped<T>(record: Readonly<Record<string, T>>, drop: (key: string) => boolean): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !drop(key)));
}

export class BellMarks extends Store<BellsState> {
  /**
   * `saved` is what the saved workspace holds: marks this device showed in an earlier page life.
   * `shownTab` is the tab on screen on a visible page, if any: it counts as shown (and so does a
   * terminal tab under the sessions sheet, which leaves it visible).
   */
  constructor(saved: Readonly<Record<string, number>>, private readonly shownTab: () => string | null) {
    super({ marks: {}, seen: saved, hosts: {} });
  }

  /** The seen marks to save: those of the listed hosts, which bounds them. A null host id is a browser host whose id isn't known yet: nothing is dropped then. */
  toSave(hostIds: ReadonlyArray<string | null>): Record<string, number> {
    const { seen } = this.snapshot;
    const known = hostIds.filter((host) => host !== null);
    if (known.length < hostIds.length) return { ...seen };
    return dropped(seen, (id) => !known.some((host) => id.startsWith(`${host}/`)));
  }

  /** Clear local data: every session's current mark counts as shown, so no dot outlives the clear. */
  forget(): void {
    const { marks } = this.snapshot;
    this.commit({ seen: Object.fromEntries(Object.entries(marks).map(([id, m]) => [id, m.mark])) });
  }

  /** The tab on screen may have changed: it counts as shown with the mark it has. */
  shownChanged(): void {
    this.commit({});
  }

  /**
   * A listing replaces the host's sessions; what was seen is kept only for those, which bounds it.
   * A listing means the host can read tmux's bell state.
   */
  listed(hostId: string, listing: TmuxListing | null): void {
    this.learn(hostId, listing?.server ?? null, (listing?.sessions ?? []).map((s) => ({ session: s.id, ...s.bell })), true);
  }

  /** A `bell` message: the sessions whose mark or coverage changed, or the host's availability. */
  changed(hostId: string, msg: BellMsg): void {
    if (msg.available) this.learn(hostId, msg.server ?? null, msg.sessions, false);
    else this.unreadable(hostId);
  }

  /** The host can't read tmux's bell state: a `bell` message says so, or a listing failed with a tmux error (not "no server"). */
  unreadable(hostId: string): void {
    const { hosts } = this.snapshot;
    this.commit({ hosts: { ...hosts, [hostId]: { server: hosts[hostId]?.server, available: false } } });
  }

  /**
   * One rule for both paths. A session this device has no seen mark for takes the mark it learns
   * as its baseline, unless the device has already heard marks from the host: the session's
   * counter then started after that, at 0, so every mark is a bell this device hasn't shown. A
   * tmux restart is such a case. Marks of another instance go with it; `complete` says `sessions`
   * is every session there is (a listing).
   */
  private learn(hostId: string, server: string | null, sessions: BellChange[], complete: boolean): void {
    const { marks, seen, hosts } = this.snapshot;
    const heard = hosts[hostId]?.server !== undefined;
    // A restarted server's answer is every session, like a listing.
    const replaces = complete || (heard && hosts[hostId]?.server !== server);
    const own = (id: string): boolean => id.startsWith(`${hostId}/`);
    const nextMarks = replaces ? dropped(marks, own) : { ...marks };
    const nextSeen = replaces ? dropped(seen, own) : { ...seen };
    for (const change of sessions) {
      const id = tabId({ host: hostId, session: { server: server ?? "", session: change.session } });
      nextMarks[id] = { mark: change.mark, covered: change.covered };
      nextSeen[id] = seen[id] ?? (heard ? 0 : change.mark);
    }
    this.commit({ marks: nextMarks, seen: nextSeen, hosts: { ...hosts, [hostId]: { server, available: true } } });
  }

  private commit(next: Partial<BellsState>): void {
    const { marks = this.snapshot.marks, hosts = this.snapshot.hosts } = next;
    let seen = next.seen ?? this.snapshot.seen;
    const onScreen = this.shownTab();
    const shown = onScreen === null ? undefined : marks[onScreen];
    if (onScreen !== null && shown !== undefined && seen[onScreen] !== shown.mark) seen = { ...seen, [onScreen]: shown.mark };
    if (marks === this.snapshot.marks && seen === this.snapshot.seen && hosts === this.snapshot.hosts) return;
    this.update({ marks, seen, hosts });
  }
}
