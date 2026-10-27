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
  /** Hosts (by host id) whose daemon couldn't read tmux's bell state at its last try. */
  unavailable: Readonly<Record<string, true>>;
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

/** `record` without the keys `drop` picks. */
function dropped<T>(record: Readonly<Record<string, T>>, drop: (key: string) => boolean): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !drop(key)));
}

export class BellMarks extends Store<BellsState> {
  /** The tab on screen on a visible page; it counts as shown. */
  private onScreen: string | null = null;

  /** `saved` is what the saved workspace holds: marks this device showed in an earlier page life. */
  constructor(saved: Readonly<Record<string, number>>) {
    super({ marks: {}, seen: saved, unavailable: {} });
  }

  /** Clear local data: every session's current mark counts as shown, so no dot outlives the clear. */
  forget(): void {
    const { marks, unavailable } = this.snapshot;
    this.commit(marks, Object.fromEntries(Object.entries(marks).map(([id, m]) => [id, m.mark])), unavailable);
  }

  /**
   * A listing: replaces the host's marks, and keeps what was seen only for sessions still
   * listed, which bounds it. The first mark this device learns for a session is its baseline.
   * A listing means the host can read tmux's bell state.
   */
  listed(hostId: string, listing: TmuxListing | null): void {
    this.learn(hostId, listing?.server ?? "", (listing?.sessions ?? []).map((s) => ({ session: s.id, ...s.bell })), true);
  }

  /** A `bell` message: the sessions whose mark or coverage changed, or the host's availability. */
  changed(hostId: string, msg: BellMsg): void {
    if (msg.available) this.learn(hostId, msg.server, msg.sessions, false);
    else this.unreadable(hostId);
  }

  /** The host can't read tmux's bell state: a `bell` message says so, or a listing failed with a tmux error (not "no server"). */
  unreadable(hostId: string): void {
    const { marks, seen } = this.snapshot;
    this.commit(marks, seen, this.available(hostId, false));
  }

  private learn(hostId: string, server: string, sessions: BellChange[], replace: boolean): void {
    const { marks, seen } = this.snapshot;
    const own = (id: string): boolean => id.startsWith(`${hostId}/`);
    // On a server this device has listed, a session it doesn't know is new, so its counter
    // started at 0; on one it hasn't, the mark is the baseline.
    const listed = !replace && Object.keys(marks).some((id) => id.startsWith(`${hostId}/${server}/`));
    const nextMarks = replace ? dropped(marks, own) : { ...marks };
    const nextSeen = replace ? dropped(seen, own) : { ...seen };
    for (const change of sessions) {
      const id = tabId({ host: hostId, session: { server, session: change.session } });
      nextMarks[id] = { mark: change.mark, covered: change.covered };
      nextSeen[id] = seen[id] ?? (listed ? 0 : change.mark);
    }
    this.commit(nextMarks, nextSeen, this.available(hostId, true));
  }

  /** The tab on a visible page, or none: it counts as seen, with each mark that arrives while it is. */
  shown(id: string | null): void {
    if (id === this.onScreen) return;
    this.onScreen = id;
    const { marks, seen, unavailable } = this.snapshot;
    this.commit(marks, seen, unavailable);
  }

  private available(hostId: string, yes: boolean): BellsState["unavailable"] {
    const { unavailable } = this.snapshot;
    if (yes === !(hostId in unavailable)) return unavailable;
    return yes ? dropped(unavailable, (id) => id === hostId) : { ...unavailable, [hostId]: true };
  }

  private commit(marks: BellsState["marks"], seen: BellsState["seen"], unavailable: BellsState["unavailable"]): void {
    const shown = this.onScreen === null ? undefined : marks[this.onScreen];
    const counted = this.onScreen !== null && shown !== undefined && seen[this.onScreen] !== shown.mark ? { ...seen, [this.onScreen]: shown.mark } : seen;
    this.update({ marks, seen: counted, unavailable });
  }
}
