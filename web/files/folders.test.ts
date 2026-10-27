import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFs, type FakeTree } from "../platform/test/fs";
import { Folders, KEPT, MAX_PAGES, SETTLE_MS } from "./folders";
import { folderKey, type Where } from "./pathfield";

const many = (n: number): string[] => Array.from({ length: n }, (_, i) => `/home/j/repos/d${String(i).padStart(3, "0")}`);
const tree = (extra: string[] = []): FakeTree => ({
  home: "/home/j",
  roots: ["/home/j/repos/tether"],
  uploads: "/home/j/up",
  dirs: ["/home/j", "/home/j/repos", "/home/j/repos/tether", "/home/j/repos/tether/web", "/home/j/up", ...extra],
  files: { "/home/j/repos/tether/README.md": "text/markdown" },
});
const where: Where = { home: "/home/j", scope: ["/home/j/repos/tether", "/home/j/up"] };

function setup(extra: string[] = [], page = 3) {
  const fs = new FakeFs(tree(extra), page);
  return { fs, folders: new Folders(fs, () => where) };
}
const held = (f: Folders, path: string) => f.snapshot.held.get(folderKey(path, false))?.names ?? undefined;

describe("Folders", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("asks once typing settles, for the last folder only", async () => {
    const { fs, folders } = setup();
    folders.ask({ path: "/home/j", hidden: false });
    folders.ask({ path: "/home/j/repos", hidden: false });
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    expect(fs.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(fs.calls).toEqual(["dirs /home/j/repos 0"]);
    expect(held(folders, "/home/j/repos")).toMatchObject({ status: "ready", names: ["tether"] });
  });

  it("lists inside a root with /fs/list and keeps folders only", async () => {
    const { fs, folders } = setup();
    await folders.load("/home/j/repos/tether", false);
    expect(fs.calls).toEqual(["list /home/j/repos/tether 0"]);
    expect(held(folders, "/home/j/repos/tether")).toMatchObject({ names: ["web"] });
  });

  it("does not ask again for a folder it holds or has under way", async () => {
    const { fs, folders } = setup();
    fs.hold = true;
    folders.ask({ path: "/home/j/repos", hidden: false });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    folders.ask({ path: "/home/j/repos", hidden: false });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(fs.calls).toHaveLength(1);
    fs.release();
    await vi.advanceTimersByTimeAsync(0);
    folders.ask({ path: "/home/j/repos", hidden: false });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(fs.calls).toHaveLength(1);
  });

  it("follows a page of folders with the next, up to the page limit, then says it is capped", async () => {
    const { fs, folders } = setup(many(40), 4);
    await folders.load("/home/j/repos", false);
    expect(fs.calls).toHaveLength(MAX_PAGES);
    const state = held(folders, "/home/j/repos");
    expect(state).toMatchObject({ status: "ready", capped: true });
    expect(state?.status === "ready" && state.names).toHaveLength(MAX_PAGES * 4);
  });

  it("stops at the page that holds the last folder", async () => {
    const { fs, folders } = setup(many(5), 4);
    await folders.load("/home/j/repos", false);
    expect(fs.calls).toEqual(["dirs /home/j/repos 0", "dirs /home/j/repos 4"]);
    expect(held(folders, "/home/j/repos")).toMatchObject({ capped: false });
  });

  it("caches the first page it fetched, until a refresh drops it", async () => {
    const { fs, folders } = setup();
    await folders.load("/home/j/repos/tether", false);
    expect(await folders.settled("/home/j/repos/tether", false)).toMatchObject({ path: "/home/j/repos/tether", via: "list" });
    expect(folders.peek("/home/j/repos/tether", false)).not.toBeNull();
    expect(folders.peek("/home/j/repos/tether", true)).toBeNull();
    folders.drop("/home/j/repos/tether");
    expect(folders.peek("/home/j/repos/tether", false)).toBeNull();
    expect(fs.calls).toHaveLength(1);
  });

  it("a settled waits for the fetch under way instead of asking again", async () => {
    const { fs, folders } = setup();
    fs.hold = true;
    const loading = folders.load("/home/j/repos", false);
    const taken = folders.settled("/home/j/repos", false);
    fs.release();
    await loading;
    expect(await taken).toMatchObject({ via: "dirs" });
    expect(fs.calls).toHaveLength(1);
  });

  it("asks again for a folder whose listing failed for want of a connection, not for one that is missing", async () => {
    const { fs, folders } = setup();
    const ask = async (): Promise<void> => { folders.ask({ path: "/home/j/repos", hidden: false }); await vi.advanceTimersByTimeAsync(SETTLE_MS); };
    fs.offline = true;
    await ask();
    expect(held(folders, "/home/j/repos")).toMatchObject({ status: "error" });
    fs.offline = false;
    await ask();
    expect(held(folders, "/home/j/repos")).toMatchObject({ status: "ready" });
    folders.ask({ path: "/home/j/nope", hidden: false });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    folders.ask({ path: "/home/j/nope", hidden: false });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(fs.calls.filter((c) => c.includes("nope"))).toHaveLength(1);
  });

  it("keeps the 32 most recent folders and drops a refreshed one", () => {
    const { folders } = setup();
    for (let i = 0; i < KEPT + 3; i++) folders.seed({ path: `/p${String(i)}`, root: "/", parent: null, total: 0, offset: 0, truncated: false, entries: [] }, false);
    expect(folders.snapshot.held.size).toBe(KEPT);
    expect(held(folders, "/p0")).toBeUndefined();
    folders.drop("/p10");
    expect(held(folders, "/p10")).toBeUndefined();
  });

  it("seeds from a listing that holds all its folders, not from a partial page of folders", () => {
    const { folders } = setup();
    const entry = (name: string, kind: "dir" | "file") => ({ name, kind, link: false });
    const listing = (entries: ReturnType<typeof entry>[], total: number) => ({ path: "/a", root: "/", parent: null, total, offset: 0, truncated: false, entries });
    folders.seed(listing([entry("x", "dir")], 5), false);
    expect(held(folders, "/a")).toBeUndefined();
    folders.seed(listing([entry("x", "dir"), entry("f", "file")], 5), false);
    expect(held(folders, "/a")).toMatchObject({ names: ["x"] });
  });
});
