import { describe, expect, it } from "vitest";
import type { TmuxListing } from "../proto/generated/messages";
import { findWindow, groups, sessionKey, windowCount } from "./groups";

const win = (id: number, name: string) => ({ id, index: id, name, active: false, activity: 0 });
const LISTING: TmuxListing = {
  server: "main:1-1",
  version: "3.4",
  sessions: [
    { id: 1, name: "Tether", attachedElsewhere: false, windows: [win(1, "agent"), win(2, "shell")] },
    { id: 2, name: "notes", attachedElsewhere: false, windows: [win(3, "Shell"), win(4, "todo")] },
    { id: 3, name: "web", attachedElsewhere: false, windows: [win(5, "dev")] },
  ],
};
const first = <T,>(items: T[], i = 0): T => {
  const item = items[i];
  if (item === undefined) throw new Error("fixture index");
  return item;
};
const names = (query: string, open: string[] = []) => groups(LISTING, query, new Set(open)).map((g) => `${g.session.name}${g.expanded ? "+" : ""}:${g.windows.map((w) => w.name).join(",")}`);

describe("groups", () => {
  it("starts collapsed and keeps every session when there is no query", () => {
    expect(groups(LISTING, "", new Set()).map((g) => g.expanded)).toEqual([false, false, false]);
    expect(groups(LISTING, "   ", new Set())).toHaveLength(3);
  });

  it("shows the sessions the user opened", () => {
    expect(names("", [sessionKey("main:1-1", first(LISTING.sessions, 1))])).toEqual(["Tether:agent,shell", "notes+:Shell,todo", "web:dev"]);
  });

  it("matches a session name case-insensitively and keeps all its windows, as the user left it", () => {
    expect(names("TETH")).toEqual(["Tether:agent,shell"]);
  });

  it("a window-only match opens its parent and shows only the matching windows", () => {
    expect(names("shell")).toEqual(["Tether+:shell", "notes+:Shell"]);
  });

  it("a session that matches by name and by window opens and shows every window", () => {
    expect(names("t")).toEqual(["Tether+:agent,shell", "notes+:Shell,todo"]);
  });

  it("clearing the query restores the explicit expansion: search never writes it", () => {
    const open = new Set<string>();
    groups(LISTING, "shell", open);
    expect(open.size).toBe(0);
    expect(names("")).toEqual(["Tether:agent,shell", "notes:Shell,todo", "web:dev"]);
  });

  it("says nothing matches with an empty list", () => {
    expect(names("zzz")).toEqual([]);
  });

  it("handles 24 and more groups", () => {
    const many: TmuxListing = {
      server: "main:1-1",
      version: "3.4",
      sessions: Array.from({ length: 30 }, (_, i) => ({ id: i, name: `s${String(i).padStart(2, "0")}`, attachedElsewhere: false, windows: [win(i * 10, i % 2 ? "odd" : "even"), win(i * 10 + 1, "shell")] })),
    };
    const open = new Set([sessionKey(many.server, first(many.sessions, 27))]);
    expect(groups(many, "", open)).toHaveLength(30);
    expect(groups(many, "", open).filter((g) => g.expanded).map((g) => g.session.name)).toEqual(["s27"]);
    expect(groups(many, "s2", open).map((g) => g.session.name)).toEqual(["s20", "s21", "s22", "s23", "s24", "s25", "s26", "s27", "s28", "s29"]);
    // "odd" matches only windows: fifteen parents open for the search, the rest hidden.
    const odd = groups(many, "odd", open);
    expect(odd).toHaveLength(15);
    expect(odd.every((g) => g.expanded && g.windows.length === 1)).toBe(true);
  });

  it("scopes the key to the tmux run", () => {
    expect(sessionKey("main:1-1", first(LISTING.sessions))).not.toBe(sessionKey("main:2-9", first(LISTING.sessions)));
  });
});

describe("findWindow", () => {
  it("finds a window of this run only", () => {
    expect(findWindow(LISTING, { server: "main:1-1", window: 4 })?.session.name).toBe("notes");
    expect(findWindow(LISTING, { server: "main:2-1", window: 4 })).toBeUndefined();
    expect(findWindow(LISTING, { server: "main:1-1", window: 99 })).toBeUndefined();
  });
});

describe("windowCount", () => {
  it("is singular for one", () => {
    expect([windowCount(1), windowCount(0), windowCount(3)]).toEqual(["1 window", "0 windows", "3 windows"]);
  });
});
