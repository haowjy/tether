import { describe, expect, it } from "vitest";
import type { TmuxListing } from "./generated/messages";
import { listed, sameWindow } from "./window";

const win = (id: number) => ({ id, index: id, name: "w", active: false, activity: 0 });
const listing = (server: string, ids: number[]): TmuxListing => ({
  server,
  version: "3.4",
  sessions: [{ id: 1, name: "s", windows: ids.map(win) }],
});

describe("listed", () => {
  it("needs the same server and window id", () => {
    expect(listed(listing("a", [1, 2]), { server: "a", window: 2 })).toBe(true);
    expect(listed(listing("a", [1]), { server: "a", window: 2 })).toBe(false);
    expect(listed(listing("b", [2]), { server: "a", window: 2 })).toBe(false);
    expect(listed(null, { server: "a", window: 2 })).toBe(false);
  });
});

describe("sameWindow", () => {
  it("is the server run and the window id, never a name", () => {
    expect(sameWindow({ server: "a", window: 1 }, { server: "a", window: 1 })).toBe(true);
    expect(sameWindow({ server: "a", window: 1 }, { server: "b", window: 1 })).toBe(false);
  });
});
