import { describe, expect, it } from "vitest";
import type { SavedWorkspace, TabKey } from "../platform/types";
import type { TmuxListing } from "../proto/generated/messages";
import { tabLabels } from "./labels";
import { tabId } from "../platform/tabKey";
import { initialWorkspace, reduce, savedTabs, shownTab, type WorkspaceEvent, type WorkspaceState } from "./state";

const key = (session: number, server = "main:1-1", host = "h1"): TabKey => ({ host, session: { server, session } });
const open = (state: WorkspaceState, session: number, name = "s", window = `w${String(session)}`, server?: string) =>
  reduce(state, { type: "opened", key: key(session, server), session: name, window });
const run = (events: WorkspaceEvent[], from: WorkspaceState = initialWorkspace) =>
  events.reduce((acc, e) => { const r = reduce(acc.state, e); return { state: r.state, effects: [...acc.effects, ...r.effects] }; }, { state: from, effects: [] as ReturnType<typeof reduce>["effects"] });
/** One session per id, each showing `w<id>` as its current window. */
const listing = (server: string, ids: number[]): TmuxListing => ({
  server,
  version: "3.4",
  sessions: ids.map((id) => ({
    id,
    name: "s",
    windows: [{ id: id * 10, index: 0, name: `w${String(id)}`, active: true, activity: 0 }],
  })),
});
const saved = (ids: number[], active: number): SavedWorkspace => ({
  version: 3,
  tabs: ids.map((i) => ({ kind: "terminal", key: key(i), session: "s", window: `w${String(i)}` })),
  active: tabId(key(active)),
  lastTerminal: {},
});

describe("opening and closing", () => {
  it("opens and activates; opening again activates the same tab", () => {
    const r = run([
      { type: "opened", key: key(1), session: "s", window: "a" },
      { type: "opened", key: key(2), session: "s", window: "b" },
      { type: "opened", key: key(1), session: "s", window: "a" },
    ]);
    expect(r.state.tabs).toHaveLength(2);
    expect(r.state.active).toBe(tabId(key(1)));
  });

  it("closing the active tab activates the right neighbour, else the left", () => {
    let s = run([1, 2, 3].map((i): WorkspaceEvent => ({ type: "opened", key: key(i), session: "s", window: `w${String(i)}` })));
    s = run([{ type: "activated", id: tabId(key(2)) }, { type: "closed", id: tabId(key(2)) }], s.state);
    expect(s.state.active).toBe(tabId(key(3)));
    s = run([{ type: "closed", id: tabId(key(3)) }], s.state);
    expect(s.state.active).toBe(tabId(key(1)));
  });

  it("closing an inactive tab leaves the active tab", () => {
    const s = run([1, 2].map((i): WorkspaceEvent => ({ type: "opened", key: key(i), session: "s", window: "w" })));
    const r = reduce(s.state, { type: "closed", id: tabId(key(1)) });
    expect(r.state.active).toBe(tabId(key(2)));
  });
});

describe("navigation and focus", () => {
  it("activating a tab off Terminal navigates there, and the arrival focuses it", () => {
    const s = open(initialWorkspace, 1).state;
    const r = reduce(s, { type: "activated", id: tabId(key(1)) });
    expect(r.effects).toContainEqual({ type: "navigate", to: "tab" });
    expect(r.effects.some((e) => e.type === "focus")).toBe(false);
    expect(reduce(s, { type: "navigated", entry: { route: "tab", tab: "x", place: null } }).effects).toContainEqual({ type: "focus", target: "terminal" });
  });

  it("activating a tab already on Terminal only focuses it", () => {
    const s = run([{ type: "opened", key: key(1), session: "s", window: "a" }, { type: "navigated", entry: { route: "tab", tab: "x", place: null } }]).state;
    const r = reduce(s, { type: "activated", id: tabId(key(1)) });
    expect(r.effects).toEqual([{ type: "focus", target: "terminal" }]);
  });

  it("closing the last tab on Terminal navigates Home", () => {
    const s = run([{ type: "opened", key: key(1), session: "s", window: "a" }, { type: "navigated", entry: { route: "tab", tab: "x", place: null } }]).state;
    const r = reduce(s, { type: "closed", id: tabId(key(1)) });
    expect(r.effects).toContainEqual({ type: "navigate", to: "home" });
    expect(r.effects.some((e) => e.type === "focus")).toBe(false);
  });

  it("changes nothing, and so saves nothing, when a watching or a listing says what is known", () => {
    const s = run([{ type: "opened", key: key(1), session: "s", window: "w1" }]).state;
    const same = (e: WorkspaceEvent): void => { const r = reduce(s, e); expect(r.state).toBe(s); expect(r.effects).toEqual([]); };
    same({ type: "watching", id: tabId(key(1)), window: "w1" });
    same({ type: "listing", hostId: "h1", listing: listing("main:1-1", [1]) });
  });
});

describe("what is on screen", () => {
  it("watches only the active tab while its terminal screen shows", () => {
    let r = run([{ type: "opened", key: key(1), session: "s", window: "a" }]);
    expect(shownTab(r.state)).toBeNull();
    r = run([{ type: "navigated", entry: { route: "tab", tab: "x", place: null } }], r.state);
    expect(shownTab(r.state)).toBe(tabId(key(1)));
    r = run([{ type: "opened", key: key(2), session: "s", window: "b" }], r.state);
    expect(shownTab(r.state)).toBe(tabId(key(2)));
    r = run([{ type: "navigated", entry: { route: "home" } }], r.state);
    expect(shownTab(r.state)).toBeNull();
  });

  it("saves on every change to the tabs, and on none other", () => {
    expect(open(initialWorkspace, 1).effects).toContainEqual({ type: "save" });
    const s = open(initialWorkspace, 1).state;
    expect(reduce(s, { type: "navigated", entry: { route: "tab", tab: "x", place: null } }).effects.some((e) => e.type === "save")).toBe(false);
  });

  it("does not save when only what is not saved changed (restoring)", () => {
    const restored = reduce(initialWorkspace, { type: "restored", saved: saved([1], 1) }).state;
    const proven = reduce(restored, { type: "watching", id: tabId(key(1)), window: "w1" });
    expect(proven.state.tabs[0]).toMatchObject({ restoring: false });
    expect(proven.effects.some((e) => e.type === "save")).toBe(false);
  });
});

describe("restore and pruning", () => {
  it("restores tabs as restoring, with the saved active tab", () => {
    const r = reduce(initialWorkspace, { type: "restored", saved: saved([1, 2], 2) });
    expect(r.state.tabs.every((t) => t.kind === "terminal" && t.restoring)).toBe(true);
    expect(r.state.active).toBe(tabId(key(2)));
    expect(r.state.tabs[0]).toMatchObject({ session: "s", window: "w1" });
  });

  it("a watching reply proves a restoring tab", () => {
    const s = reduce(initialWorkspace, { type: "restored", saved: saved([1], 1) }).state;
    const r = reduce(s, { type: "watching", id: tabId(key(1)), window: "w1" });
    expect(r.state.tabs[0]).toMatchObject({ restoring: false });
  });


  it("the first listing keeps listed tabs and closes the rest with one notice", () => {
    const s = reduce(initialWorkspace, { type: "restored", saved: saved([1, 2, 3], 3) }).state;
    const r = reduce(s, { type: "listing", hostId: "h1", listing: listing("main:1-1", [1]) });
    expect(r.state.tabs.map((t) => t.id)).toEqual([tabId(key(1))]);
    expect(r.state.tabs[0]).toMatchObject({ restoring: false });
    expect(r.state.active).toBe(tabId(key(1)));
    expect(r.effects).toContainEqual({ type: "notice", text: "2 tabs closed: their sessions are gone" });
  });

  it("never substitutes a same-named session", () => {
    const s = reduce(initialWorkspace, { type: "restored", saved: saved([5], 5) }).state;
    const l = listing("main:1-1", [9]);
    expect(reduce(s, { type: "listing", hostId: "h1", listing: l }).state.tabs).toHaveLength(0);
  });

  it("a restarted tmux (same endpoint, new run) closes its old tabs; another endpoint is untouched", () => {
    let s = reduce(initialWorkspace, { type: "restored", saved: saved([1], 1) }).state;
    s = run([{ type: "opened", key: key(7, "scratch:2-2"), session: "x", window: "y" }], s).state;
    const r = reduce(s, { type: "listing", hostId: "h1", listing: listing("main:9-9", [1]) });
    expect(r.state.tabs.map((t) => t.id)).toEqual([tabId(key(7, "scratch:2-2"))]);
  });

  it("a failed or empty listing decides nothing", () => {
    const s = reduce(initialWorkspace, { type: "restored", saved: saved([1], 1) }).state;
    expect(reduce(s, { type: "listing", hostId: "h1", listing: null }).state).toBe(s);
  });

  it("another host's listing leaves these tabs alone", () => {
    const s = reduce(initialWorkspace, { type: "restored", saved: saved([1], 1) }).state;
    expect(reduce(s, { type: "listing", hostId: "h2", listing: listing("main:1-1", []) }).state.tabs).toHaveLength(1);
  });

  it("discards saved tabs of a host that no current host reports, once every id is known", () => {
    const s = reduce(initialWorkspace, { type: "restored", saved: saved([1], 1) }).state;
    expect(reduce(s, { type: "hostsKnown", ids: [], complete: false }).state.tabs).toHaveLength(1);
    expect(reduce(s, { type: "hostsKnown", ids: ["h1"], complete: true }).state.tabs).toHaveLength(1);
    expect(reduce(s, { type: "hostsKnown", ids: ["h2"], complete: true }).state.tabs).toHaveLength(0);
  });

  it("a listing refreshes the session name and, off screen, the current window's name", () => {
    const s = reduce(initialWorkspace, { type: "restored", saved: { ...saved([1], 1), tabs: [{ kind: "terminal", key: key(1), session: "old", window: "older" }] } }).state;
    const r = reduce(s, { type: "listing", hostId: "h1", listing: listing("main:1-1", [1]) });
    expect(r.state.tabs[0]).toMatchObject({ session: "s", window: "w1", restoring: false });
  });


});

describe("daemon events", () => {
  it("sessionClosed and serverExited remove tabs", () => {
    const s = run([1, 2].map((i): WorkspaceEvent => ({ type: "opened", key: key(i), session: "s", window: "w" }))).state;
    expect(reduce(s, { type: "sessionClosed", id: tabId(key(1)) }).state.tabs).toHaveLength(1);
    expect(reduce(s, { type: "serverExited", hostId: "h1", server: "main:1-1" }).state.tabs).toHaveLength(0);
  });
});

describe("savedTabs", () => {
  it("round-trips through restored", () => {
    const s = run([1, 2].map((i): WorkspaceEvent => ({ type: "opened", key: key(i), session: "s", window: `w${String(i)}` }))).state;
    const again = reduce(initialWorkspace, { type: "restored", saved: { version: 3, ...savedTabs(s) } }).state;
    expect(again.tabs.map((t) => t.id)).toEqual(s.tabs.map((t) => t.id));
  });
});

describe("tabLabels", () => {
  const host = (id: string): string => (id === "h1" ? "pop-os" : "mac");
  it("is the session, then its current window, with no separator", () => {
    const tabs = run([
      { type: "opened", key: key(1), session: "tether", window: "shell" },
      { type: "opened", key: key(2), session: "notes", window: "shell" },
    ]).state.tabs;
    expect(tabLabels(tabs, host).map((l) => [l.session, l.window, l.full])).toEqual([
      ["tether", "shell", "tether shell"],
      ["notes", "shell", "notes shell"],
    ]);
  });
  it("names the host only when several are open", () => {
    const one = open(initialWorkspace, 1).state.tabs;
    expect(tabLabels(one, host)[0]?.host).toBeNull();
    const two = run([
      { type: "opened", key: key(1), session: "a", window: "x" },
      { type: "opened", key: key(1, "main:1-1", "h2"), session: "b", window: "y" },
    ]).state.tabs;
    expect(tabLabels(two, host).map((l) => l.full)).toEqual(["a x on pop-os", "b y on mac"]);
  });
});
