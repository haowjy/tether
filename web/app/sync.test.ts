import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TmuxListing } from "../proto/generated/messages";
import { makeHost } from "../net/fakes";
import { HostSync, listed } from "./sync";

const win = (id: number) => ({ id, index: id, name: "w", active: false, activity: 0 });
const listing = (server: string, ids: number[]): TmuxListing => ({
  server,
  version: "3.4",
  sessions: [{ id: 1, name: "s", attachedElsewhere: false, windows: ids.map(win) }],
});

describe("listed", () => {
  it("needs the same server and window id", () => {
    expect(listed(listing("a", [1, 2]), { server: "a", window: 2 })).toBe(true);
    expect(listed(listing("a", [1]), { server: "a", window: 2 })).toBe(false);
    expect(listed(listing("b", [2]), { server: "a", window: 2 })).toBe(false);
    expect(listed(null, { server: "a", window: 2 })).toBe(false);
  });
});

describe("HostSync", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function setup() {
    const h = makeHost();
    const listings: (TmuxListing | null)[] = [];
    const renames: string[] = [];
    new HostSync({
      host: h.host,
      onListing: (l) => listings.push(l),
      onRenamed: (w, name) => renames.push(`${String(w.window)}=${name}`),
    });
    h.link().welcome();
    const lists = (): number => h.link().sent.filter((m) => m.type === "listSessions").length;
    return { ...h, listings, renames, lists };
  }

  it("lists on connect and passes every listing on", () => {
    const t = setup();
    expect(t.lists()).toBe(1);
    t.link().say({ type: "sessions", data: { req: 99, tmux: listing("a", [1]) } });
    expect(t.listings).toHaveLength(1);
  });

  it("lists once, after a quiet moment, however many sessionsChanged arrive", () => {
    const t = setup();
    for (let i = 0; i < 3; i++) t.link().say({ type: "sessionsChanged" });
    expect(t.lists()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(t.lists()).toBe(2);
  });

  it("reports renames", () => {
    const t = setup();
    t.link().say({ type: "windowRenamed", data: { window: { server: "a", window: 4 }, name: "vim" } });
    expect(t.renames).toEqual(["4=vim"]);
  });
});
