import { describe, expect, it } from "vitest";
import type { TmuxListing } from "../proto/generated/messages";
import { findSession, matching, windowCount } from "./groups";

const LISTING: TmuxListing = {
  server: "main:1-1",
  version: "3.4",
  sessions: [
    { id: 1, name: "Tether", bell: { mark: 0, covered: true }, windows: [] },
    { id: 2, name: "notes", bell: { mark: 0, covered: true }, windows: [] },
    { id: 3, name: "web", bell: { mark: 0, covered: true }, windows: [] },
  ],
};
const names = (query: string): string[] => matching(LISTING, query).map((s) => s.name);

describe("matching", () => {
  it("keeps every session when there is no query", () => {
    expect(names("")).toEqual(["Tether", "notes", "web"]);
    expect(names("   ")).toHaveLength(3);
  });

  it("matches a session name case-insensitively", () => {
    expect(names("TETH")).toEqual(["Tether"]);
    expect(names("t")).toEqual(["Tether", "notes"]);
  });


  it("says nothing matches with an empty list", () => {
    expect(names("zzz")).toEqual([]);
  });
});

describe("findSession", () => {
  it("finds a session of this run only", () => {
    expect(findSession(LISTING, { server: "main:1-1", session: 2 })?.name).toBe("notes");
    expect(findSession(LISTING, { server: "main:2-1", session: 2 })).toBeUndefined();
    expect(findSession(LISTING, { server: "main:1-1", session: 99 })).toBeUndefined();
  });
});

describe("windowCount", () => {
  it("is singular for one", () => {
    expect([windowCount(1), windowCount(0), windowCount(3)]).toEqual(["1 window", "0 windows", "3 windows"]);
  });
});
