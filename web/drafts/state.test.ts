import { describe, expect, it } from "vitest";
import { tabId } from "../platform/tabKey";
import type { TabKey } from "../platform/types";
import { checkEdit, initialDrafts, MAX_DRAFT_BYTES, MAX_DRAFTS, pendingKey, reduce, type DraftsEvent, type DraftsState } from "./state";

const key = (window: number): TabKey => ({ host: "h", window: { server: "s", window } });
const NONE: ReadonlySet<string> = new Set();
const draftText = (state: DraftsState, id: string): string => state.drafts[id]?.text ?? "";
const ID = tabId(key(1));

function run(state: DraftsState, ...events: DraftsEvent[]): DraftsState {
  return events.reduce((s, e) => reduce(s, e).state, state);
}
const edit = (window: number, text: string, now = 1, open: ReadonlySet<string> = NONE): DraftsEvent => ({ type: "edit", key: key(window), text, now, open });

describe("caps", () => {
  it("refuses an edit that grows a draft past 64 KiB, but lets one shrink it", () => {
    const big = "x".repeat(MAX_DRAFT_BYTES);
    const at = run(initialDrafts, edit(1, big));
    expect(checkEdit(at, key(1), big + "x", NONE)).toBe("tooLarge");
    expect(reduce(at, edit(1, big + "x")).state).toBe(at);
    expect(checkEdit(at, key(1), big.slice(1), NONE)).toBe("ok");
  });

  it("counts bytes, not characters", () => {
    expect(checkEdit(initialDrafts, key(1), "é".repeat(MAX_DRAFT_BYTES / 2 + 1), NONE)).toBe("tooLarge");
  });

  it("evicts the least recently edited draft of a window with no open tab past 32", () => {
    let state = initialDrafts;
    for (let i = 1; i <= MAX_DRAFTS; i++) state = run(state, edit(i, `d${String(i)}`, i));
    const open = new Set([tabId(key(1))]); // the oldest belongs to an open tab: spared
    const { state: next, effects } = reduce(state, edit(99, "new", 100, open));
    expect(effects).toEqual([{ type: "delete", key: key(2) }]);
    expect(draftText(next, tabId(key(1)))).toBe("d1");
    expect(draftText(next, tabId(key(2)))).toBe("");
    expect(draftText(next, tabId(key(99)))).toBe("new");
    expect(Object.keys(next.drafts)).toHaveLength(MAX_DRAFTS);
  });

  it("refuses a new draft when every one belongs to an open tab", () => {
    let state = initialDrafts;
    const open = new Set<string>();
    for (let i = 1; i <= MAX_DRAFTS; i++) {
      open.add(tabId(key(i)));
      state = run(state, edit(i, "d", i));
    }
    expect(checkEdit(state, key(99), "x", open)).toBe("full");
    expect(reduce(state, edit(99, "x", 100, open)).state).toBe(state);
    expect(checkEdit(state, key(3), "more", open)).toBe("ok"); // an existing draft still edits
  });
});

describe("writes and revisions", () => {
  it("writes a dirty draft with the next revision on flush, and deletes an emptied one", () => {
    const dirty = run(initialDrafts, edit(1, "ls"));
    const { state, effects } = reduce(dirty, { type: "flush" });
    expect(effects).toEqual([{ type: "put", record: { key: key(1), text: "ls", revision: 1, editedAt: 1 }, base: 0 }]);
    expect(reduce(state, { type: "flush" }).effects).toEqual([]); // nothing changed since
    const stored = run(state, { type: "stored", key: key(1), revision: 1 }, edit(1, ""));
    expect(reduce(stored, { type: "flush" }).effects).toEqual([{ type: "delete", key: key(1) }]);
  });

  it("keeps the base a put compares against", () => {
    const state = run(initialDrafts, { type: "listed", records: [{ key: key(1), text: "old", revision: 4, editedAt: 1 }] }, edit(1, "new", 2));
    expect(reduce(state, { type: "flush" }).effects).toEqual([{ type: "put", record: { key: key(1), text: "new", revision: 5, editedAt: 2 }, base: 4 }]);
  });

  it("reloads the newer text when a put lost to another window, saying so", () => {
    const written = run(initialDrafts, edit(1, "mine"), { type: "flush" });
    const lost = run(written, { type: "remote", key: key(1), record: { key: key(1), text: "theirs", revision: 7, editedAt: 5 } });
    expect(lost.drafts[tabId(key(1))]).toMatchObject({ text: "theirs", revision: 7, base: 7, dirty: false, note: { kind: "editedElsewhere" } });
  });

  it("ignores the echo of its own write and adopts a clean draft's newer text", () => {
    const state = run(initialDrafts, edit(1, "mine"));
    expect(reduce(state, { type: "remote", key: key(1), record: { key: key(1), text: "mine", revision: 0, editedAt: 1 } }).state).toBe(state);
    const clean = run(state, { type: "flush" }, { type: "stored", key: key(1), revision: 1 });
    expect(run(clean, { type: "remote", key: key(1), record: null }).drafts).toEqual({});
  });

  it("bases a second put on the first, so two flushes before the first is acknowledged do not conflict", () => {
    const first = reduce(run(initialDrafts, edit(1, "git sta")), { type: "flush" });
    const second = reduce(run(first.state, edit(1, "git status --short", 2)), { type: "flush" });
    expect(first.effects).toMatchObject([{ type: "put", record: { revision: 1 }, base: 0 }]);
    expect(second.effects).toMatchObject([{ type: "put", record: { revision: 2 }, base: 1 }]);
  });

  it("writes a draft again after a failed put", () => {
    const state = run(initialDrafts, edit(1, "x"), { type: "flush" }, { type: "failed", key: key(1) });
    expect(reduce(state, { type: "flush" }).effects).toHaveLength(1);
  });

  it("does not let a stored draft overwrite an edit made before storage answered", () => {
    const state = run(initialDrafts, edit(1, "typed"), { type: "listed", records: [{ key: key(1), text: "stored", revision: 2, editedAt: 0 }] });
    expect(draftText(state, tabId(key(1)))).toBe("typed");
    expect(state.drafts[tabId(key(1))]).toMatchObject({ revision: 2, base: 2 });
  });
});

describe("send states by req", () => {
  const sent = (text = "echo hi"): DraftsState => run(initialDrafts, edit(1, text), { type: "flush" }, { type: "stored", key: key(1), revision: 1 }, { type: "submit", key: key(1), text, req: 7, now: 9 });

  it("clears the draft on Return, deleting the stored one at once", () => {
    const state = sent();
    expect(state.drafts).toEqual({});
    expect(state.pending[pendingKey(ID, 7)]?.text).toBe("echo hi");
    const typed = run(initialDrafts, edit(1, "echo hi"), { type: "flush" }, { type: "stored", key: key(1), revision: 1 });
    expect(reduce(typed, { type: "submit", key: key(1), text: "echo hi", req: 7, now: 9 }).effects).toEqual([{ type: "delete", key: key(1) }]);
  });

  it("drops the pending line when it is answered", () => {
    expect(run(sent(), { type: "answered", id: ID, req: 7, open: NONE, outcome: { kind: "pasted" } })).toEqual(initialDrafts);
  });

  it("puts a refused line back ahead of what was typed since, marked Not sent", () => {
    const state = run(sent(), edit(1, " && ls", 20), { type: "answered", id: ID, req: 7, open: NONE, outcome: { kind: "refused", message: "busy" } });
    expect(state.pending).toEqual({});
    expect(state.drafts[tabId(key(1))]).toMatchObject({ text: "echo hi && ls", dirty: true, note: { kind: "notSent", message: "busy" } });
  });

  it("marks a line lost with the socket, or a tmux error, as possibly sent", () => {
    const state = run(sent(), { type: "answered", id: ID, req: 7, open: NONE, outcome: { kind: "maybe", message: "the connection was lost" } });
    expect(state.drafts[tabId(key(1))]?.note).toEqual({ kind: "maybeSent", message: "the connection was lost" });
  });

  it("returns the lines of a tab that closed, and ignores an answer nobody waits for", () => {
    const state = run(sent(), { type: "tabClosed", id: ID, open: NONE });
    expect(draftText(state, tabId(key(1)))).toBe("echo hi");
    expect(reduce(state, { type: "answered", id: ID, req: 99, open: NONE, outcome: { kind: "pasted" } }).state).toBe(state);
  });

  it("keeps two hosts' lines apart when their requests share a number", () => {
    const other: TabKey = { host: "other", window: { server: "s", window: 9 } };
    const both = run(initialDrafts, edit(1, "a"), { type: "submit", key: key(1), text: "a", req: 7, now: 1 }, { type: "edit", key: other, text: "b", now: 2, open: NONE }, { type: "submit", key: other, text: "b", req: 7, now: 3 });
    expect(Object.keys(both.pending)).toHaveLength(2);
    const after = run(both, { type: "answered", id: ID, req: 7, open: NONE, outcome: { kind: "pasted" } });
    expect(Object.values(after.pending).map((p) => p.text)).toEqual(["b"]);
  });

  it("clears a note with the next edit", () => {
    const state = run(sent(), { type: "answered", id: ID, req: 7, open: NONE, outcome: { kind: "refused", message: "busy" } }, edit(1, "echo hi!", 30));
    expect(state.drafts[tabId(key(1))]?.note).toBeNull();
  });
});
