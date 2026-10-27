import { describe, expect, it } from "vitest";
import type { FilesPlace } from "../platform/types";
import { Router, type HistoryPort, type Navigated } from "./router";

/** A browser's history: a list of entries and a cursor. `back` pops synchronously here. */
function fakeHistory(initialHash = "#/", initialState: unknown = null) {
  const entries: { state: unknown; hash: string }[] = [{ state: initialState, hash: initialHash }];
  let at = 0;
  let pop: (() => void) | undefined;
  const port: HistoryPort = {
    current: () => entries[at] as { state: unknown; hash: string },
    push(state, hash) { entries.splice(at + 1); entries.push({ state, hash }); at++; },
    replace(state, hash) { entries[at] = { state, hash }; },
    go(delta) { if (at + delta >= 0 && at + delta < entries.length) { at += delta; pop?.(); } },
    onPop(l) { pop = l; return () => { pop = undefined; }; },
  };
  return { port, entries, get at() { return at; }, forward() { at++; pop?.(); } };
}

const dir = (path: string): FilesPlace => ({ kind: "dir", path });

/** `active` stands in for the workspace's active tab. */
function setup(hash = "#/") {
  const h = fakeHistory(hash);
  const state = { active: null as string | null };
  const router = new Router(h.port);
  router.activeTab = () => state.active;
  const seen: Navigated[] = [];
  router.subscribe((n) => seen.push(n));
  const open = (tab: string, place: FilesPlace | null = null): void => { state.active = tab; router.openTab(tab, place); };
  return { h, router, seen, state, open, hashes: () => h.entries.slice(0, h.at + 1).map((e) => e.hash) };
}

describe("Router", () => {
  it("opens Home on a clean launch, whatever the hash says, replacing the first entry", () => {
    const { router, h } = setup("#/tab");
    expect(router.entry).toMatchObject({ route: "home", tab: null, place: null, overlay: null });
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]?.hash).toBe("#/");
  });

  it("keeps file paths out of the URL", () => {
    const { router, open, hashes } = setup();
    open("f1", { kind: "roots" });
    router.pushPlace("f1", { kind: "roots" }, { kind: "file", path: "/secret/path.txt" });
    expect(hashes()).toEqual(["#/", "#/tab", "#/tab"]);
  });

  it("pushes on route changes and emits navigated each time", () => {
    const { router, seen, open, h } = setup();
    open("t1");
    router.goHome();
    router.goHome();
    expect(seen.map((n) => n.entry.route)).toEqual(["tab", "home"]);
    h.port.go(-1);
    expect(seen.map((n) => n.entry.route)).toEqual(["tab", "home", "tab"]);
  });

  it("Back walks out of the folders of the tab they were opened in, each entry recording its place", () => {
    const { router, open, h } = setup();
    open("f1", { kind: "roots" });
    router.pushPlace("f1", { kind: "roots" }, dir("/a"));
    router.pushPlace("f1", dir("/a"), { kind: "file", path: "/a/b" });
    const places: (FilesPlace | null)[] = [];
    router.subscribe(({ entry }) => places.push(entry.place));
    h.port.go(-1);
    h.port.go(-1);
    h.port.go(-1);
    expect(places).toEqual([dir("/a"), { kind: "roots" }, null]);
    expect(router.entry.route).toBe("home");
  });

  it("stamps the entry before a drill-in, so Back returns to this place even after another tab was shown", () => {
    const { router, state, open, h } = setup();
    open("f1", { kind: "roots" });
    state.active = "f2"; // switched tabs: no entry of its own
    router.pushPlace("f2", dir("/x"), dir("/x/y"));
    h.port.go(-1);
    expect(router.entry).toMatchObject({ tab: "f2", place: dir("/x") });
  });

  it("a Back that lands on an entry of a tab that is not active skips to Home, announcing nothing", () => {
    const { router, state, seen, open, h } = setup();
    open("f1", { kind: "roots" });
    router.pushPlace("f1", { kind: "roots" }, dir("/a"));
    state.active = "t1"; // the user switched tabs
    const before = seen.length;
    h.port.go(-1);
    expect(seen).toHaveLength(before + 1);
    expect(router.entry.route).toBe("home");
    expect(h.at).toBe(0);
  });

  it("an entry from before a reload whose tab is not active is replaced with Home", () => {
    const { router, open, h } = setup();
    open("f1", { kind: "roots" });
    router.pushPlace("f1", { kind: "roots" }, dir("/a"));
    const after = new Router(h.port); // a reload: a new stack, no tab active
    h.port.go(-1);
    expect(after.entry.route).toBe("home");
  });

  it("closing an overlay lands on its base whichever tab was shown meanwhile", () => {
    const { router, state, open } = setup();
    open("t1");
    router.openOverlay({ screen: "switcher", name: "sessions" });
    state.active = "t2";
    router.closeOverlay();
    expect(router.entry).toMatchObject({ route: "tab", tab: "t1", overlay: null });
  });

  it("closing an overlay by an action is history.back()", () => {
    const { router, open, h } = setup();
    open("t1");
    router.openOverlay({ screen: "picker", name: "open" });
    expect(h.entries).toHaveLength(3);
    router.closeOverlay();
    expect(router.entry.overlay).toBeNull();
    expect(h.at).toBe(1);
  });

  it("runs what follows a close after the overlay is gone, or at once when none is open", () => {
    const { router } = setup();
    const ran: (string | null)[] = [];
    router.closeOverlay(() => ran.push("none open"));
    router.openOverlay({ screen: "picker", name: "open" });
    router.closeOverlay(() => ran.push(router.entry.overlay?.name ?? null));
    expect(ran).toEqual(["none open", null]);
  });

  it("closing every overlay is one history step, however many are stacked", () => {
    const { router, h } = setup();
    router.openOverlay({ screen: "settings", name: "open" });
    router.openOverlay({ screen: "settings", name: "clearData" });
    expect(h.entries).toHaveLength(3);
    router.closeAllOverlays();
    expect(router.entry.overlay).toBeNull();
    expect(h.at).toBe(0);
  });

  it("after a reload an overlay cannot be popped to: a new Router starts at Home with no overlay", () => {
    const { router, h } = setup();
    router.openOverlay({ screen: "settings", name: "x" });
    const again = new Router(h.port);
    expect(again.entry.overlay).toBeNull();
  });

  it("the in-app Home button goes back when the previous entry is Home, else replaces", () => {
    const { router, open, h } = setup();
    open("t1");
    router.toHome();
    expect(router.entry.route).toBe("home");
    expect(h.at).toBe(0);

    const deep = setup();
    deep.router.replacePlace("t1", { kind: "roots" }); // an entry with nothing below it
    deep.router.toHome();
    expect(deep.router.entry.route).toBe("home");
    expect(deep.h.entries).toHaveLength(1);
  });

  it("a Files tab's in-app back goes back when the previous entry is that place in that tab, else replaces", () => {
    const { router, open, h } = setup();
    open("f1", { kind: "roots" });
    router.pushPlace("f1", { kind: "roots" }, dir("/a"));
    router.pushPlace("f1", dir("/a"), { kind: "file", path: "/a/b" });
    router.toPlace("f1", dir("/a"));
    expect(router.entry.place).toEqual(dir("/a"));
    expect(h.at).toBe(2);
    router.toPlace("f1", dir("/"));
    expect(router.entry.place).toEqual(dir("/"));
    expect(h.at).toBe(2);
  });

  it("a state from an earlier page life of an active tab stands alone", () => {
    const { router, open, h } = setup();
    open("f1", { kind: "roots" });
    router.pushPlace("f1", { kind: "roots" }, dir("/a"));
    h.port.go(-1);
    h.port.go(-1);
    h.forward();
    h.forward();
    expect(router.entry).toMatchObject({ route: "tab", tab: "f1", place: dir("/a") });
  });

  it("a canonical path replaces the entry's place without adding one", () => {
    const { router, open, h } = setup();
    open("f1", dir("/link"));
    router.replacePlace("f1", dir("/real"));
    expect(router.entry.place).toEqual(dir("/real"));
    expect(h.entries).toHaveLength(2);
  });

  it("Home has no back", () => {
    const { router, seen } = setup();
    router.toHome();
    expect(seen).toHaveLength(0);
  });
});
