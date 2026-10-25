import { describe, expect, it } from "vitest";
import { HttpRefusal } from "../net/http";
import { accept, complete, folderKey, go, parseTyped, scopeOf, slashAccepts, type CompleteContext, type FolderState, type Where } from "./pathfield";

const where: Where = { home: "/home/j", scope: ["/home/j/repos/tether", "/home/j/up"] };
const ready = (names: string[], capped = false): FolderState => ({ status: "ready", names, capped });

/** The listings held, by `path` (hidden=0 unless the key says otherwise). */
function ctxOf(held: Record<string, FolderState>, showHidden = false): CompleteContext {
  return { where, showHidden, folder: (key) => held[key] };
}
const at = (path: string, state: FolderState, hidden = false): Record<string, FolderState> => ({ [folderKey(path, hidden)]: state });

const repos = ctxOf({
  ...at("/home/j/repos", ready(["many", "tether", "tether-old", "test-data", "Zed"])),
  ...at("/home/j/repos/tether", ready(["src", "web"])),
  ...at("/home/j", ready(["repos", "other"])),
});

describe("parseTyped", () => {
  it("splits at the last slash and resolves ~, . and ..", () => {
    expect(parseTyped("~/repos/te", "/home/j")).toEqual({ prefix: "~/repos/", segment: "te", parent: "/home/j/repos", named: "/home/j/repos/te" });
    expect(parseTyped("~", "/home/j")).toMatchObject({ prefix: "~/", segment: "", parent: "/home/j" });
    expect(parseTyped("~/repos/../other/./x", "/home/j")).toMatchObject({ parent: "/home/j/other", segment: "x" });
    expect(parseTyped("/srv/", "/home/j")).toMatchObject({ prefix: "/srv/", segment: "", parent: "/srv", named: "/srv" });
    expect(parseTyped("/..", "/home/j")).toMatchObject({ parent: "/", named: "/" });
  });

  it("is not a path without a ~ or / start", () => {
    expect(parseTyped("repos", "/home/j")).toBeNull();
    expect(parseTyped("~repos/", "/home/j")).toBeNull();
    expect(parseTyped("", "/home/j")).toBeNull();
  });
});

describe("scopeOf", () => {
  it("is list in a root, dirs elsewhere under home, roots above the roots, else outside", () => {
    expect(scopeOf("/home/j/repos/tether/web", where)).toBe("list");
    expect(scopeOf("/home/j/repos", where)).toBe("dirs");
    expect(scopeOf("/home/j/repos/tether2", where)).toBe("dirs");
    expect(scopeOf("/", where)).toBe("roots");
    expect(scopeOf("/srv", where)).toBe("outside");
  });
});

describe("complete", () => {
  it("lists the parent's folders that start with the segment, case folded, and predicts the first", () => {
    const c = complete("~/repos/te", repos);
    expect(c.rows.map((r) => r.name)).toEqual(["tether", "tether-old", "test-data"]);
    expect(c.predicted?.name).toBe("tether");
    expect(c.ghost).toBe("ther/");
    expect(complete("~/repos/z", repos).rows.map((r) => r.name)).toEqual(["Zed"]);
  });

  it("lists every folder and predicts none while the segment is empty", () => {
    const c = complete("~/repos/", repos);
    expect(c.rows).toHaveLength(5);
    expect(c.predicted).toBeNull();
    expect(c.ghost).toBe("");
  });

  it("marks folders outside every root 'not added' (a root or one inside reads like any folder)", () => {
    const c = complete("~/repos/", repos);
    expect(Object.fromEntries(c.rows.map((r) => [r.name, r.added]))).toMatchObject({ tether: true, many: false });
  });

  it("shows a step toward a root without 'not added'", () => {
    expect(complete("/ho", ctxOf({})).rows).toEqual([{ name: "home", path: "/home", added: true }]);
  });

  it("asks for the typed parent, hidden only for a dot segment or the toggle, and only until it is held", () => {
    const none = ctxOf({});
    expect(complete("~/repos/te", none).ask).toEqual({ path: "/home/j/repos", hidden: false });
    expect(complete("~/repos/.g", none).ask).toEqual({ path: "/home/j/repos", hidden: true });
    expect(complete("~/repos/te", ctxOf({}, true)).ask).toEqual({ path: "/home/j/repos", hidden: true });
    // A held hidden listing is a different cache entry.
    expect(complete("~/repos/.g", repos).rows).toEqual([]);
  });

  it("completes root paths above the roots without a listing", () => {
    const c = complete("/home/j/re", ctxOf({}));
    expect(c.ask).toEqual({ path: "/home/j", hidden: false });
    const top = complete("/", ctxOf({}));
    expect(top.ask).toBeNull();
    expect(top.rows.map((r) => r.name)).toEqual(["home"]);
    expect(complete("/h", ctxOf({})).predicted?.name).toBe("home");
  });

  it("says when the text is no path or leads outside the folders", () => {
    expect(complete("repos", repos).note).toBe("start");
    expect(complete("/srv/x", repos).note).toBe("outside");
  });

  it("carries the cap and the refusal of the listing", () => {
    expect(complete("~/repos/", ctxOf(at("/home/j/repos", ready(["a"], true)))).capped).toBe(true);
    const error = { status: "error" as const, error: new HttpRefusal(403, "denied") };
    expect(complete("~/repos/", ctxOf(at("/home/j/repos", error))).folder).toBe(error);
  });
});

describe("accept and slash", () => {
  it("accept puts the full path and a slash", () => {
    const typed = parseTyped("~/repos/te", "/home/j");
    expect(typed && accept(typed, "tether")).toBe("~/repos/tether/");
  });

  it("a slash after a partial name accepts the prediction", () => {
    expect(slashAccepts("~/repos/te", repos)).toBe("~/repos/tether/");
    expect(slashAccepts("~/re", repos)).toBe("~/repos/");
  });

  it("a slash after . or .. is just a slash, though hidden folders start with a dot", () => {
    const hidden = ctxOf({ ...at("/home/j/repos/tether", ready([".git", "src"]), true) });
    expect(slashAccepts("~/repos/tether/.", hidden)).toBeNull();
    expect(slashAccepts("~/repos/tether/..", hidden)).toBeNull();
    expect(slashAccepts("~/repos/tether/.g", hidden)).toBe("~/repos/tether/.git/");
  });

  it("a slash after an exact folder name, or with nothing predicted, is just a slash", () => {
    expect(slashAccepts("~/repos/tether", repos)).toBeNull();
    expect(slashAccepts("~/repos/", repos)).toBeNull();
    expect(slashAccepts("~/repos/qq", repos)).toBeNull();
  });
});

describe("go", () => {
  it("opens the highlighted row", () => {
    const row = complete("~/repos/te", repos).predicted;
    expect(go("~/repos/te", row, repos)).toEqual({ open: "/home/j/repos/tether" });
  });

  it("with no highlight opens the folder the text names, right after an accept too", () => {
    expect(go("~/repos/tether/", null, repos)).toEqual({ open: "/home/j/repos/tether" });
    expect(go("~/repos/many", null, repos)).toEqual({ open: "/home/j/repos/many" });
  });

  it("says when the text names nothing, and waits for a listing it has not got", () => {
    expect(go("~/repos/tetherx", null, repos)).toEqual({ say: "No folder ~/repos/tetherx" });
    expect(go("~/repos/tether", null, ctxOf({}))).toEqual({ wait: true });
    const missing: FolderState = { status: "error", error: new HttpRefusal(404, "not_found") };
    expect(go("~/gone/", null, ctxOf(at("/home/j/gone", missing)))).toEqual({ say: "No folder ~/gone" });
  });

  it("opens nothing above the roots or outside them, and leaves other refusals to the list", () => {
    expect(go("/", null, repos)).toEqual({ say: "Outside your folders" });
    expect(go("/srv/x", null, repos)).toEqual({ say: "Outside your folders" });
    const denied: FolderState = { status: "error", error: new HttpRefusal(403, "denied") };
    expect(go("~/x/", null, ctxOf(at("/home/j/x", denied)))).toEqual({ say: null });
    expect(go("repos", null, repos)).toEqual({ say: "Start with ~ or /" });
  });

  it("opens nothing for a row above the roots", () => {
    const row = complete("/ho", ctxOf({})).predicted;
    expect(go("/ho", row, ctxOf({}))).toEqual({ say: "Outside your folders" });
  });

  it("opens a folder named whole without waiting for a listing, and one past the scan cap that the list lacks", () => {
    expect(go("~/repos/tether/", null, ctxOf({}))).toEqual({ open: "/home/j/repos/tether" });
    expect(go("~/repos/zzz", null, ctxOf(at("/home/j/repos", ready(["a"], true))))).toEqual({ open: "/home/j/repos/zzz" });
  });

  it("opens the parent for a trailing .. without checking the listing", () => {
    expect(go("~/repos/tether/..", null, repos)).toEqual({ open: "/home/j/repos" });
  });
});
