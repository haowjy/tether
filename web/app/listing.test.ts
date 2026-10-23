import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeHost } from "../platform/test/host";
import type { TmuxListing } from "../proto/generated/messages";
import { ListingFetcher, type ListingEvent } from "./listing";

const listing = (server: string, ids: number[]): TmuxListing => ({
  server,
  version: "3.4",
  sessions: [{ id: 1, name: "s", attachedElsewhere: false, windows: ids.map((id) => ({ id, index: id, name: "w", active: false, activity: 0 })) }],
});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup(over: { restoring?: boolean; visible?: boolean } = {}) {
  const h = makeHost();
  const state = { restoring: over.restoring ?? false, visible: over.visible ?? true };
  const fetcher = new ListingFetcher({ restoring: () => state.restoring, visible: () => state.visible, random: () => 0.5 });
  const events: ListingEvent[] = [];
  fetcher.subscribe((e) => events.push(e));
  fetcher.add("h1", h.host);
  const lists = (): number => h.link().sent.filter((m) => m.type === "listSessions").length;
  const answer = (tmux: TmuxListing | null): void => {
    const sent = h.link().sent.filter((m) => m.type === "listSessions").at(-1);
    h.link().say({ type: "sessions", data: { req: sent?.type === "listSessions" ? sent.data.req : 0, tmux } });
  };
  return { ...h, fetcher, state, events, lists, answer };
}

describe("ListingFetcher", () => {
  it("joins a host only while something wants it, and lists on connect", async () => {
    const t = setup();
    expect(t.links).toHaveLength(0);
    t.fetcher.setWanted("h1", true);
    t.link().welcome();
    expect(t.lists()).toBe(1);
    t.answer(listing("a", [1]));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.events).toEqual([{ type: "listed", handle: "h1", listing: listing("a", [1]) }]);
  });

  it("keeps the socket 30 s after the last reason for it goes", () => {
    const t = setup();
    t.fetcher.setWanted("h1", true);
    t.link().welcome();
    t.fetcher.setWanted("h1", false);
    vi.advanceTimersByTime(29_000);
    expect(t.link().closed).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(t.link().closed).toBe(true);
  });

  it("lists once, after a quiet moment, however many sessionsChanged arrive", async () => {
    const t = setup();
    t.fetcher.setWanted("h1", true);
    t.link().welcome();
    t.answer(null);
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 3; i++) t.link().say({ type: "sessionsChanged" });
    expect(t.lists()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(t.lists()).toBe(2);
  });

  it("ignores sessionsChanged while the page is hidden", () => {
    const t = setup({ visible: false });
    t.fetcher.setWanted("h1", true);
    t.link().welcome();
    t.link().say({ type: "sessionsChanged" });
    vi.advanceTimersByTime(1000);
    expect(t.lists()).toBe(1);
  });

  it("has one request in flight per host and queues one more", async () => {
    const t = setup();
    t.fetcher.setWanted("h1", true);
    t.link().welcome();
    t.link().say({ type: "sessionsChanged" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.lists()).toBe(1);
    t.answer(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.lists()).toBe(2);
  });

  it("refresh mid-flight lists exactly once more after the current one, never two at once", async () => {
    const t = setup();
    t.fetcher.setWanted("h1", true);
    t.fetcher.refresh("h1"); // the socket is not up: linkUp will list
    t.link().welcome();
    expect(t.lists()).toBe(1);
    t.fetcher.refresh("h1");
    t.fetcher.refresh("h1");
    expect(t.lists()).toBe(1);
    t.answer(listing("a", [1]));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.lists()).toBe(2); // started after the refresh, so it can see what the first missed
    t.answer(listing("a", [1, 2]));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.lists()).toBe(2);
    t.fetcher.refresh("h1");
    expect(t.lists()).toBe(3);
  });

  it("setWanted reports a listing only when it started one", () => {
    const t = setup();
    expect(t.fetcher.setWanted("h1", true)).toBe(false); // socket not up
    t.link().welcome();
    t.fetcher.setWanted("h1", false);
    expect(t.fetcher.setWanted("h1", true)).toBe(true);
  });

  it("retries a failed listing with the host's backoff while a tab is restoring, and reports it", async () => {
    const t = setup({ restoring: true });
    t.fetcher.setWanted("h1", true);
    t.link().welcome();
    t.link().drop(); // fails the request: nothing decided
    await vi.advanceTimersByTimeAsync(0);
    expect(t.events).toEqual([{ type: "failed", handle: "h1", reason: "lost" }]);
    await vi.advanceTimersByTimeAsync(500);
    t.link().welcome();
    expect(t.lists()).toBe(1);
    t.answer(listing("a", [1]));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.events.at(-1)).toMatchObject({ type: "listed" });
  });

  it("reports a lost socket with nothing in flight", async () => {
    const t = setup();
    t.fetcher.setWanted("h1", true);
    t.link().welcome();
    t.answer(null);
    await vi.advanceTimersByTimeAsync(0);
    t.link().drop();
    expect(t.events.at(-1)).toEqual({ type: "failed", handle: "h1", reason: "lost" });
  });

  it("retries a busy answer soon, with nothing reported", async () => {
    const t = setup();
    t.fetcher.setWanted("h1", true);
    t.link().welcome();
    t.link().say({ type: "error", data: { req: 1, code: "busy", message: "busy" } });
    await vi.advanceTimersByTimeAsync(500);
    expect(t.lists()).toBe(2);
    expect(t.events.every((e) => e.type !== "listed")).toBe(true);
  });

  it("forwards renames", () => {
    const t = setup();
    t.fetcher.setWanted("h1", true);
    t.link().welcome();
    t.link().say({ type: "windowRenamed", data: { window: { server: "a", window: 4 }, name: "vim" } });
    expect(t.events).toEqual([{ type: "renamed", handle: "h1", window: { server: "a", window: 4 }, name: "vim" }]);
  });
});
