import { describe, expect, it } from "vitest";
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
    back() { if (at > 0) { at--; pop?.(); } },
    onPop(l) { pop = l; return () => { pop = undefined; }; },
  };
  return { port, entries, get at() { return at; }, forward() { at++; pop?.(); } };
}

function setup(hash = "#/", files: Parameters<typeof Router.prototype.pushFiles>[0] | null = null) {
  const h = fakeHistory(hash);
  const router = new Router(h.port, files);
  const seen: Navigated[] = [];
  router.subscribe((n) => seen.push(n));
  return { h, router, seen, hashes: () => h.entries.slice(0, h.at + 1).map((e) => e.hash) };
}

describe("Router", () => {
  it("reads the destination from the hash and replaces the first entry", () => {
    const { router, h } = setup("#/files", { kind: "dir", path: "/home/j" });
    expect(router.entry).toMatchObject({ destination: "files", files: { kind: "dir", path: "/home/j" }, overlay: null });
    expect(h.entries).toHaveLength(1);
  });

  it("keeps file paths out of the URL", () => {
    const { router, hashes } = setup();
    router.go("files");
    router.pushFiles({ kind: "file", path: "/secret/path.txt" });
    expect(hashes()).toEqual(["#/", "#/files", "#/files"]);
  });

  it("pushes on destination changes and emits navigated each time", () => {
    const { router, seen } = setup();
    router.go("terminal");
    router.go("terminal");
    expect(seen.map((n) => n.destination)).toEqual(["terminal"]);
    router.back();
    expect(seen.map((n) => n.destination)).toEqual(["terminal", "home"]);
  });

  it("Back closes the overlay, then the preview, then folders, then leaves the destination", () => {
    const { router } = setup();
    router.go("files");
    router.pushFiles({ kind: "dir", path: "/a" });
    router.pushFiles({ kind: "file", path: "/a/b" });
    router.openOverlay({ screen: "files", name: "upload" });
    const order: string[] = [];
    router.subscribe(({ entry }) => order.push(entry.overlay ? "overlay" : (entry.files?.kind ?? entry.destination)));
    router.back();
    router.back();
    router.back();
    router.back();
    expect(order).toEqual(["file", "dir", "files", "home"]);
    expect(router.entry.files).toBeNull();
  });

  it("closing an overlay by an action is history.back()", () => {
    const { router, h } = setup();
    router.go("terminal");
    router.openOverlay({ screen: "picker", name: "open" });
    expect(h.entries).toHaveLength(3);
    router.closeOverlay();
    expect(router.entry.overlay).toBeNull();
    expect(h.at).toBe(1);
  });

  it("after a reload an overlay cannot be popped to, so closing replaces the entry", () => {
    const { router, h } = setup("#/terminal");
    router.openOverlay({ screen: "settings", name: "x" });
    // Simulate a reload: a new Router over the same history starts with a fresh stack.
    const again = new Router(h.port, null);
    expect(again.entry.overlay).toBeNull();
  });

  it("an in-app back button goes back when the previous entry is the parent, else replaces", () => {
    const { router, h } = setup();
    router.go("terminal");
    router.toParent();
    expect(router.entry.destination).toBe("home");
    expect(h.at).toBe(0);

    const deep = setup("#/terminal"); // a deep link: nothing below it
    deep.router.toParent();
    expect(deep.router.entry.destination).toBe("home");
    expect(deep.h.entries).toHaveLength(1);
  });

  it("restores overlays dropped on reload: a state from an earlier page life stands alone", () => {
    const { router, h } = setup();
    router.go("files");
    router.openOverlay({ screen: "x", name: "y" });
    router.back();
    router.back();
    h.forward();
    expect(router.entry.destination).toBe("files");
  });

  it("Home has no parent", () => {
    const { router, seen } = setup();
    router.toParent();
    expect(seen).toHaveLength(0);
  });
});
