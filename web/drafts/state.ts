// The line field's drafts and send states (client-architecture.md §7.4): one draft per tab key,
// the lines sent and not yet answered, and the caps. A pure reducer: events in; state and the
// storage writes to make out. No Preact, no window, no document. The I/O around it (debounce,
// storage, the paste answer) is screens/terminal/dock/lineDrafts.ts.
import { tabId } from "../platform/tabKey";
import type { DraftRecord, TabKey } from "../platform/types";

/** One draft's text, in UTF-8 bytes. */
export const MAX_DRAFT_BYTES = 64 * 1024;
/** Drafts kept at once. */
export const MAX_DRAFTS = 32;

export type DraftNote =
  /** The daemon refused the line: it did not run. */
  | { kind: "notSent"; message: string }
  /** tmux errored after the paste may have run, or the socket dropped before the answer. */
  | { kind: "maybeSent"; message: string }
  | { kind: "editedElsewhere" };

export interface Draft {
  key: TabKey;
  text: string;
  /** The revision of the record last issued or read. A put names it as the base it expects storage to hold, so two puts in flight never conflict with each other. */
  revision: number;
  /** The newest revision storage is known to hold: a put has been acknowledged, or the record was read. */
  base: number;
  editedAt: number;
  /** Changed since the last write. */
  dirty: boolean;
  note: DraftNote | null;
}

/** A line sent with Enter and not yet answered. */
export interface Pending {
  id: string;
  /** The paste's request id, which only its host's socket makes unique. */
  req: number;
  key: TabKey;
  text: string;
  at: number;
}

/** What a paste's answer is matched by: `req` counts per host, so the tab names the host. */
export const pendingKey = (id: string, req: number): string => `${id}#${String(req)}`;

export interface DraftsState {
  /** Storage's initial list answered. Native line hydration waits before applying edits. */
  ready: boolean;
  /** Keyed by tab id. */
  drafts: Readonly<Record<string, Draft>>;
  /** Keyed by {@link pendingKey}. */
  pending: Readonly<Record<string, Pending>>;
}

export const initialDrafts: DraftsState = { ready: false, drafts: {}, pending: {} };

export type DraftsEvent =
  /** Every stored draft, read once at start. */
  | { type: "listed"; records: DraftRecord[] }
  /** The user edited the field. `open` is the ids of the open tabs, which eviction spares. */
  | { type: "edit"; key: TabKey; text: string; now: number; open: ReadonlySet<string> }
  /** Return sent `text` as paste `req` of its tab: the draft is gone and the line is pending. */
  | { type: "submit"; key: TabKey; text: string; req: number; now: number; continuation?: string }
  | { type: "answered"; id: string; req: number; outcome: { kind: "pasted" } | { kind: "refused" | "maybe"; message: string }; open: ReadonlySet<string> }
  /** The tab closed: its unanswered lines come back, as possibly sent. */
  | { type: "tabClosed"; id: string; open: ReadonlySet<string> }
  /** Time to write: the debounce fired, or the page is hiding. */
  | { type: "flush" }
  /** A put succeeded. */
  | { type: "stored"; key: TabKey; revision: number }
  /** A put failed: the draft is written again at the next flush. */
  | { type: "failed"; key: TabKey }
  /** A put lost to a newer revision, or another page changed the draft: `record` is what storage holds now (null: deleted). */
  | { type: "remote"; key: TabKey; record: DraftRecord | null };

export type DraftsEffect =
  | { type: "put"; record: DraftRecord; base: number }
  | { type: "delete"; key: TabKey };

export type EditResult = "ok" | "tooLarge" | "full";

const encoder = new TextEncoder();
const bytes = (text: string): number => encoder.encode(text).length;

/** Whether the edit that produced `text` was refused, and why, as `reduce` will decide it. */
export function checkEdit(state: DraftsState, key: TabKey, text: string, open: ReadonlySet<string>): EditResult {
  const id = tabId(key);
  const current = state.drafts[id];
  if (bytes(text) > MAX_DRAFT_BYTES && text.length > (current?.text.length ?? 0)) return "tooLarge";
  if (current === undefined && text !== "" && Object.keys(state.drafts).length >= MAX_DRAFTS && evictable(state, id, open) === null) return "full";
  return "ok";
}

/** The least recently edited draft of a window with no open tab, other than `except`. */
function evictable(state: DraftsState, except: string, open: ReadonlySet<string>): string | null {
  let oldest: Draft | null = null;
  for (const [id, draft] of Object.entries(state.drafts)) {
    if (id === except || open.has(id)) continue;
    if (oldest === null || draft.editedAt < oldest.editedAt) oldest = draft;
  }
  return oldest === null ? null : tabId(oldest.key);
}

function without<T>(record: Readonly<Record<string, T>>, id: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== id));
}

/** The line back in its tab's draft, ahead of anything typed since. A line is user text: with no draft to evict, it stays over the cap. */
function restore(state: DraftsState, line: Pending, note: DraftNote, open: ReadonlySet<string>): { state: DraftsState; effects: DraftsEffect[] } {
  const current = state.drafts[line.id];
  let drafts = state.drafts;
  const effects: DraftsEffect[] = [];
  if (current === undefined && Object.keys(drafts).length >= MAX_DRAFTS) {
    const victim = evictable(state, line.id, open);
    const evicted = victim === null ? undefined : drafts[victim];
    if (victim !== null && evicted) {
      drafts = without(drafts, victim);
      effects.push({ type: "delete", key: evicted.key });
    }
  }
  const draft: Draft = {
    key: line.key,
    text: line.text + (current?.text ?? ""),
    revision: current?.revision ?? 0,
    base: current?.base ?? 0,
    editedAt: line.at,
    dirty: true,
    note,
  };
  return { state: { ...state, drafts: { ...drafts, [line.id]: draft } }, effects };
}

export function reduce(state: DraftsState, event: DraftsEvent): { state: DraftsState; effects: DraftsEffect[] } {
  switch (event.type) {
    case "listed": {
      const drafts = { ...state.drafts };
      for (const r of event.records) {
        const id = tabId(r.key);
        // An edit made before storage answered keeps its text (it is newer) but builds on the stored revision.
        const have = drafts[id];
        drafts[id] = have ? { ...have, revision: r.revision, base: r.revision } : { key: r.key, text: r.text, revision: r.revision, base: r.revision, editedAt: r.editedAt, dirty: false, note: null };
      }
      return { state: { ...state, ready: true, drafts }, effects: [] };
    }

    case "edit": {
      const id = tabId(event.key);
      if (checkEdit(state, event.key, event.text, event.open) !== "ok") return { state, effects: [] };
      const current = state.drafts[id];
      const effects: DraftsEffect[] = [];
      let drafts: Record<string, Draft> = { ...state.drafts };
      if (current === undefined && event.text !== "" && Object.keys(drafts).length >= MAX_DRAFTS) {
        const victim = evictable(state, id, event.open);
        const evicted = victim === null ? undefined : drafts[victim];
        if (victim !== null && evicted) {
          drafts = without(drafts, victim);
          effects.push({ type: "delete", key: evicted.key });
        }
      }
      if (current === undefined && event.text === "") return { state, effects: [] };
      drafts[id] = {
        key: event.key,
        text: event.text,
        revision: current?.revision ?? 0,
        base: current?.base ?? 0,
        editedAt: event.now,
        dirty: true,
        note: null,
      };
      return { state: { ...state, drafts }, effects };
    }

    case "submit": {
      const id = tabId(event.key);
      const pending = { ...state.pending, [pendingKey(id, event.req)]: { id, req: event.req, key: event.key, text: event.text, at: event.now } };
      const had = state.drafts[id];
      const drafts = without(state.drafts, id);
      if (event.continuation) {
        drafts[id] = {
          key: event.key,
          text: event.continuation,
          revision: 0,
          base: 0,
          editedAt: event.now,
          dirty: true,
          note: null,
        };
      }
      return {
        state: { ready: state.ready, drafts, pending },
        // A stored draft goes at once: Return then killing the page must not bring the line back.
        effects: had && had.revision > 0 ? [{ type: "delete", key: event.key }] : [],
      };
    }

    case "answered": {
      const answered = pendingKey(event.id, event.req);
      const line = state.pending[answered];
      if (!line) return { state, effects: [] };
      const pending = without(state.pending, answered);
      if (event.outcome.kind === "pasted") return { state: { ...state, pending }, effects: [] };
      const note: DraftNote = { kind: event.outcome.kind === "refused" ? "notSent" : "maybeSent", message: event.outcome.message };
      return restore({ ...state, pending }, line, note, event.open);
    }

    case "tabClosed": {
      let next = state;
      const effects: DraftsEffect[] = [];
      for (const [name, line] of Object.entries(state.pending)) {
        if (line.id !== event.id) continue;
        const restored = restore({ ...next, pending: without(next.pending, name) }, line, { kind: "maybeSent", message: "the tab closed before tmux answered" }, event.open);
        next = restored.state;
        effects.push(...restored.effects);
      }
      return { state: next, effects };
    }

    case "flush": {
      const effects: DraftsEffect[] = [];
      let drafts: Record<string, Draft> = { ...state.drafts };
      for (const [id, draft] of Object.entries(state.drafts)) {
        if (!draft.dirty) continue;
        if (draft.text === "") {
          drafts = without(drafts, id);
          if (draft.revision > 0) effects.push({ type: "delete", key: draft.key });
          continue;
        }
        const revision = draft.revision + 1;
        drafts[id] = { ...draft, revision, dirty: false };
        effects.push({ type: "put", record: { key: draft.key, text: draft.text, revision, editedAt: draft.editedAt }, base: draft.revision });
      }
      return { state: { ...state, drafts }, effects };
    }

    case "stored": {
      const id = tabId(event.key);
      const draft = state.drafts[id];
      if (!draft) return { state, effects: [] };
      return { state: { ...state, drafts: { ...state.drafts, [id]: { ...draft, base: Math.max(draft.base, event.revision) } } }, effects: [] };
    }

    case "failed": {
      const id = tabId(event.key);
      const draft = state.drafts[id];
      return { state: draft ? { ...state, drafts: { ...state.drafts, [id]: { ...draft, dirty: true } } } : state, effects: [] };
    }

    case "remote": {
      const id = tabId(event.key);
      const draft = state.drafts[id];
      // A draft with unwritten edits keeps them until its own put meets the newer revision.
      if (draft?.dirty && event.record !== null && event.record.revision <= draft.base) return { state, effects: [] };
      if (event.record === null) {
        return { state: draft && !draft.dirty ? { ...state, drafts: without(state.drafts, id) } : state, effects: [] };
      }
      const same = draft?.text === event.record.text;
      const next: Draft = {
        key: event.key,
        text: event.record.text,
        revision: event.record.revision,
        base: event.record.revision,
        editedAt: event.record.editedAt,
        dirty: false,
        note: same || draft === undefined ? (draft?.note ?? null) : { kind: "editedElsewhere" },
      };
      return { state: { ...state, drafts: { ...state.drafts, [id]: next } }, effects: [] };
    }
  }
}
