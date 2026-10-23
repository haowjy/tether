import { describe, expect, it } from "vitest";
import { newSessionMsg, newWindowMsg, parseCreation } from "./creation";

describe("parseCreation", () => {
  it("leaves blank fields out, so tmux chooses", () => {
    expect(parseCreation("  ", "")).toEqual({ ok: {} });
  });
  it("trims what is given", () => {
    expect(parseCreation(" notes ", " /home/jimmy/notes ")).toEqual({ ok: { name: "notes", dir: "/home/jimmy/notes" } });
  });
  it("refuses a directory that isn't absolute", () => {
    expect(parseCreation("", "~/notes")).toEqual({ error: expect.stringContaining("absolute") as string });
  });
});

describe("messages", () => {
  it("carry only the fields given", () => {
    expect(newSessionMsg(3, { name: "a" })).toEqual({ type: "newSession", data: { req: 3, name: "a" } });
    expect(newWindowMsg(4, { server: "s", session: 1 }, {})).toEqual({ type: "newWindow", data: { req: 4, session: { server: "s", session: 1 } } });
  });
});
