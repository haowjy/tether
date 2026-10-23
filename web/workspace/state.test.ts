import { describe, expect, it } from "vitest";
import type { SavedWorkspace, TabKey } from "../platform/types";
import type { TmuxListing } from "../proto/generated/messages";
import { tabLabels } from "./labels";
import { tabId } from "../platform/tabKey";
import { initialWorkspace, reduce, savedTabs, shownTab, type WorkspaceEvent, type WorkspaceState } from "./state";

const key = (window: number, server = "main:1-1", host = "h1"): TabKey => ({ host, window: { server, window } });
const open = (state: WorkspaceState, window: number, session = "s", name = `w${String(window)}`, server?: string) =>
  reduce(state, { type: "opened", key: key(window, server), session, window: name, index: window });
const run = (events: WorkspaceEvent[], from: WorkspaceState = initialWorkspace) =>
  events.reduce((acc, e) => { const r = reduce(acc.state, e); return { state: r.state, effects: [...acc.effects, ...r.effects] }; }, { state: from, effects: [] as ReturnType<typeof reduce>["effects"] });
const listing = (server: string, ids: number[]): TmuxListing => ({
  server,
  version: "3.4",
  sessions: [{ id: 1, name: "s", attachedElsewhere: false, windows: ids.map((id) => ({ id, index: id, name: `w${String(id)}`, active: false, activity: 0 })) }],
});
const saved = (ids: number[], active: number): SavedWorkspace => ({
  version: 1,
  tabs: ids.map((i) => ({ key: key(i), session: "s", window: `w${String(i)}` })),
  active: tabId(key(active)),
  files: null,
  expanded: {},
});

describe("opening and closing", () => {
  it("opens and activates; opening again activates the same tab", () => {
    const r = run([
      { type: "opened", key: key(1), session: "s", window: "a", index: 1 },
      { type: "opened", key: key(2), session: "s", window: "b", index: 2 },
      { type: "opened", key: key(1), session: "s", window: "a", index: 1 },
    ]);
    expect(r.state.tabs).toHaveLength(2);
    expect(r.state.active).toBe(tabId(key(1)));
  });

  it("closing the active tab activates the right neighbour, else the left", () => {
    let s = run([1, 2, 3].map((i): WorkspaceEvent => ({ type: "opened", key: key(i), session: "s", window: `w${String(i)}`, index: i })));
    s = run([{ type: "activated", id: tabId(key(2)) }, { type: "closed", id: tabId(key(2)) }], s.state);
    expect(s.state.active).toBe(tabId(key(3)));
    s = run([{ type: "closed", id: tabId(key(3)) }], s.state);
    expect(s.state.active).toBe(tabId(key(1)));
  });

  it("closing an inactive tab leaves the active tab", () => {
    const s = run([1, 2].map((i): WorkspaceEvent => ({ type: "opened", key: key(i), session: "s", window: "w", index: i })));
    const r = reduce(s.state, { type: "closed", id: tabId(key(1)) });
    expect(r.state.active).toBe(tabId(key(2)));
  });

  it("closing the last tab asks to focus Home search", () => {
    const s = open(initialWorkspace, 1);
    const r = reduce(s.state, { type: "closed", id: tabId(key(1)) });
    expect(r.effects).toContainEqual({ type: "focus", target: "homeSearch" });
    expect(r.state.active).toBeNull();
  });
});

describe("navigation and focus", () => {
  it("activating a tab off Terminal navigates there, and the arrival focuses it", () => {
    const s = open(initialWorkspace, 1).state;
    const r = reduce(s, { type: "activated", id: tabId(key(1)) });
    expect(r.effects).toContainEqual({ type: "navigate", to: "terminal" });
    expect(r.effects.some((e) => e.type === "focus")).toBe(false);
    expect(reduce(s, { type: "navigated", onTerminal: true }).effects).toContainEqual({ type: "focus", target: "terminal" });
  });

  it("activating a tab already on Terminal only focuses it", () => {
    const s = run([{ type: "opened", key: key(1), session: "s", window: "a", index: 1 }, { type: "navigated", onTerminal: true }]).state;
    const r = reduce(s, { type: "activated", id: tabId(key(1)) });
    expect(r.effects).toEqual([{ type: "focus", target: "terminal" }]);
  });

  it("closing the last tab on Terminal navigates Home before focusing Home search", () => {
    const s = run([{ type: "opened", key: key(1), session: "s", window: "a", index: 1 }, { type: "navigated", onTerminal: true }]).state;
    const r = reduce(s, { type: "closed", id: tabId(key(1)) });
    expect(r.effects.map((e) => e.type)).toEqual(expect.arrayContaining(["navigate", "focus"]));
    expect(r.effects.findIndex((e) => e.type === "navigate")).toBeLessThan(r.effects.findIndex((e) => e.type === "focus"));
    expect(r.effects).toContainEqual({ type: "navigate", to: "home" });
  });

  it("changes nothing, and so saves nothing, when a rename or a listing says what is known", () => {
    const s = run([{ type: "opened", key: key(1), session: "s", window: "w1", index: 1 }]).state;
    const same = (e: WorkspaceEvent): void => { const r = reduce(s, e); expect(r.state).toBe(s); expect(r.effects).toEqual([]); };
    same({ type: "renamed", hostId: "h1", window: key(1).window, name: "w1" });
    same({ type: "renamed", hostId: "h1", window: key(9).window, name: "x" });
    same({ type: "listing", hostId: "h1", listing: listing("main:1-1", [1]) });
  });
});

describe("what is on screen", () => {
  it("watches only the active tab on the Terminal destination", () => {
    let r = run([{ type: "opened", key: key(1), session: "s", window: "a", index: 1 }]);
    expect(shownTab(r.state)).toBeNull();
    expect(r.effects.some((e) => e.type === "uncover")).toBe(false);
    r = run([{ type: "navigated", onTerminal: true }], r.state);
    expect(r.effects).toContainEqual({ type: "uncover", id: tabId(key(1)) });
    r = run([{ type: "opened", key: key(2), session: "s", window: "b", index: 2 }], r.state);
    expect(r.effects).toEqual(expect.arrayContaining([{ type: "cover", id: tabId(key(1)) }, { type: "uncover", id: tabId(key(2)) }]));
    r = run([{ type: "navigated", onTerminal: false }], r.state);
    expect(r.effects).toContainEqual({ type: "cover", id: tabId(key(2)) });
  });

  it("saves on every change to the tabs, and on none other", () => {
    expect(open(initialWorkspace, 1).effects).toContainEqual({ type: "save" });
    const s = open(initialWorkspace, 1).state;
    expect(reduce(s, { type: "navigated", onTerminal: true }).effects.some((e) => e.type === "save")).toBe(false);
  });

  it("does not save when only what is not saved changed (restoring, index)", () => {
    const restored = reduce(initialWorkspace, { type: "restored", saved: saved([1], 1) }).state;
    const proven = reduce(restored, { type: "watching", id: tabId(key(1)) });
    expect(proven.effects.some((e) => e.type === "save")).toBe(false);
    const moved = reduce(proven.state, { type: "listing", hostId: "h1", listing: { ...listing("main:1-1", [1]), sessions: [{ id: 1, name: "s", attachedElsewhere: false, windows: [{ id: 1, index: 7, name: "w1", active: false, activity: 0 }] }] } });
    expect(moved.state.tabs[0]?.index).toBe(7);
    expect(moved.effects.some((e) => e.type === "save")).toBe(false);
  });
});

describe("restore and pruning", () => {
  it("restores tabs as restoring, with the saved active tab", () => {
    const r = reduce(initialWorkspace, { type: "restored", saved: saved([1, 2], 2) });
    expect(r.state.tabs.every((t) => t.restoring)).toBe(true);
    expect(r.state.active).toBe(tabId(key(2)));
    expect(r.state.tabs[0]).toMatchObject({ session: "s", window: "w1" });
  });

  it("a watching reply proves a restoring tab", () => {
    const s = reduce(initialWorkspace, { type: "restored", saved: saved([1], 1) }).state;
    const r = reduce(s, { type: "watching", id: tabId(key(1)) });
    expect(r.state.tabs[0]?.restoring).toBe(false);
  });

  it("the first listing keeps listed tabs and closes the rest with one notice", () => {
    const s = reduce(initialWorkspace, { type: "restored", saved: saved([1, 2, 3], 3) }).state;
    const r = reduce(s, { type: "listing", hostId: "h1", listing: listing("main:1-1", [1]) });
    expect(r.state.tabs.map((t) => t.id)).toEqual([tabId(key(1))]);
    expect(r.state.tabs[0]?.restoring).toBe(false);
    expect(r.state.active).toBe(tabId(key(1)));
    expect(r.effects).toContainEqual({ type: "notice", text: "2 tabs closed: their windows are gone" });
  });

  it("never substitutes a same-named window", () => {
    const s = reduce(initialWorkspace, { type: "restored", saved: saved([5], 5) }).state;
    const l = listing("main:1-1", [9]);
    expect(reduce(s, { type: "listing", hostId: "h1", listing: l }).state.tabs).toHaveLength(0);
  });

  it("a restarted tmux (same endpoint, new run) closes its old tabs; another endpoint is untouched", () => {
    let s = reduce(initialWorkspace, { type: "restored", saved: saved([1], 1) }).state;
    s = run([{ type: "opened", key: key(7, "scratch:2-2"), session: "x", window: "y", index: 7 }], s).state;
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

  it("a listing refreshes names and indices", () => {
    const s = reduce(initialWorkspace, { type: "restored", saved: saved([1], 1) }).state;
    const l = listing("main:1-1", [1]);
    const r = reduce(s, { type: "listing", hostId: "h1", listing: l });
    expect(r.state.tabs[0]).toMatchObject({ index: 1, window: "w1" });
  });
});

describe("daemon events", () => {
  it("windowClosed and serverExited remove tabs", () => {
    const s = run([1, 2].map((i): WorkspaceEvent => ({ type: "opened", key: key(i), session: "s", window: "w", index: i }))).state;
    expect(reduce(s, { type: "windowClosed", id: tabId(key(1)) }).state.tabs).toHaveLength(1);
    expect(reduce(s, { type: "serverExited", hostId: "h1", server: "main:1-1" }).state.tabs).toHaveLength(0);
  });
  it("a rename changes the window part", () => {
    const s = open(initialWorkspace, 1).state;
    const r = reduce(s, { type: "renamed", hostId: "h1", window: key(1).window, name: "vim" });
    expect(r.state.tabs[0]?.window).toBe("vim");
  });
});

describe("savedTabs", () => {
  it("round-trips through restored", () => {
    const s = run([1, 2].map((i): WorkspaceEvent => ({ type: "opened", key: key(i), session: "s", window: `w${String(i)}`, index: i }))).state;
    const again = reduce(initialWorkspace, { type: "restored", saved: { version: 1, ...savedTabs(s), files: null, expanded: {} } }).state;
    expect(again.tabs.map((t) => [t.id, t.session, t.window])).toEqual(s.tabs.map((t) => [t.id, t.session, t.window]));
  });
});

describe("tabLabels", () => {
  const host = (id: string): string => (id === "h1" ? "pop-os" : "mac");
  it("is session / window, with the index only for colliding window names", () => {
    const tabs = run([
      { type: "opened", key: key(1), session: "tether", window: "shell", index: 1 },
      { type: "opened", key: key(2), session: "notes", window: "shell", index: 0 },
      { type: "opened", key: key(3), session: "tether", window: "agent", index: 2 },
    ]).state.tabs;
    expect(tabLabels(tabs, host).map((l) => l.full)).toEqual(["tether / 1: shell", "notes / 0: shell", "tether / agent"]);
  });
  it("names the host only when several are open", () => {
    const one = open(initialWorkspace, 1).state.tabs;
    expect(tabLabels(one, host)[0]?.host).toBeNull();
    const two = run([
      { type: "opened", key: key(1), session: "a", window: "x", index: 1 },
      { type: "opened", key: key(1, "main:1-1", "h2"), session: "b", window: "y", index: 1 },
    ]).state.tabs;
    expect(tabLabels(two, host).map((l) => l.full)).toEqual(["a / x on pop-os", "b / y on mac"]);
  });
});
