import { describe, expect, it } from "vitest";
import { entryPlace, FileBrowser, parentPlace } from "./browser";
import { within } from "./paths";
import { FakeFs, type FakeTree } from "../platform/test/fs";

const tree = (): FakeTree => ({
  home: "/home/j",
  roots: ["/home/j/repo"],
  uploads: "/home/j/up",
  dirs: ["/home/j", "/home/j/repo", "/home/j/repo/src", "/home/j/repo/.git", "/home/j/up", "/home/j/other", "/home/j/repo2"],
  files: {
    "/home/j/repo/README.md": "text/markdown; charset=utf-8",
    "/home/j/repo/a.ts": "text/plain; charset=utf-8",
    "/home/j/repo/b.png": "image/png",
    "/home/j/repo/c.rs": "text/plain; charset=utf-8",
    "/home/j/repo/src/main.rs": "text/plain; charset=utf-8",
  },
});

function setup(t = tree()) {
  const fs = new FakeFs(t);
  const browser = new FileBrowser({ api: fs, hidden: false });
  return { fs, browser };
}

describe("within", () => {
  it("compares by component", () => {
    expect(within("/a/repo/x", "/a/repo")).toBe(true);
    expect(within("/a/repo", "/a/repo")).toBe(true);
    expect(within("/a/repo2", "/a/repo")).toBe(false);
    expect(within("/anything", "/")).toBe(true);
  });
});

describe("FileBrowser", () => {
  it("shows the roots for no place, and a folder the router names", async () => {
    const { browser, fs } = setup();
    await browser.follow(null);
    expect(browser.snapshot.place).toEqual({ kind: "roots" });
    expect(browser.snapshot.roots?.roots.map((r) => r.path)).toEqual(["/home/j/repo"]);
    await browser.follow({ kind: "dir", path: "/home/j/repo/src" });
    expect(browser.snapshot.pages?.entries.map((e) => e.name)).toEqual(["main.rs"]);
    expect(fs.calls).toEqual(["roots", "list /home/j/repo/src 0"]);
  });

  it("lists directories first, pages on demand, and keeps hidden files out until asked", async () => {
    const { browser, fs } = setup();
    await browser.follow({ kind: "dir", path: "/home/j/repo" });
    expect(browser.snapshot.pages?.entries.map((e) => e.name)).toEqual(["src", "README.md", "a.ts"]);
    await browser.more();
    expect(browser.snapshot.pages?.entries.map((e) => e.name)).toEqual(["src", "README.md", "a.ts", "b.png", "c.rs"]);
    await browser.more(); // nothing left: no request
    expect(fs.calls.filter((c) => c.startsWith("list"))).toEqual(["list /home/j/repo 0", "list /home/j/repo 3"]);
    await browser.toggleHidden();
    expect(browser.snapshot.pages?.entries.map((e) => e.name)).toContain(".git");
  });

  it("opens a listed file from the listing it came from, and returns to it without relisting", async () => {
    const { browser, fs } = setup();
    await browser.follow({ kind: "dir", path: "/home/j/repo" });
    const readme = browser.snapshot.pages?.entries.find((e) => e.name === "README.md");
    if (!readme) throw new Error("no README");
    const place = entryPlace("/home/j/repo", readme);
    expect(place).toEqual({ kind: "file", path: "/home/j/repo/README.md" });
    await browser.follow(place);
    expect(browser.snapshot.place).toMatchObject({ kind: "file", file: { name: "README.md", mime: "text/markdown; charset=utf-8", size: 10 } });
    const calls = fs.calls.length;
    await browser.follow({ kind: "dir", path: "/home/j/repo" });
    expect(browser.snapshot.place).toEqual({ kind: "dir", path: "/home/j/repo" });
    expect(fs.calls.length).toBe(calls);
  });

  it("opens a file by path with a probe, and a folder that a link led to as a listing", async () => {
    const { browser } = setup();
    await browser.follow({ kind: "file", path: "/home/j/repo/src/main.rs" });
    expect(browser.snapshot.place).toMatchObject({ kind: "file", file: { name: "main.rs", mime: "text/plain; charset=utf-8" } });
    expect(await browser.resolve("/home/j/repo/src")).toEqual({ kind: "dir", path: "/home/j/repo/src" });
    expect(await browser.resolve("/home/j/repo/src/main.rs")).toEqual({ kind: "file", path: "/home/j/repo/src/main.rs" });
  });

  it("goes up to the root's top, then to the roots", async () => {
    const { browser } = setup();
    await browser.follow({ kind: "file", path: "/home/j/repo/src/main.rs" });
    expect(parentPlace(browser.snapshot)).toEqual({ kind: "dir", path: "/home/j/repo/src" });
    await browser.follow({ kind: "dir", path: "/home/j/repo/src" });
    expect(parentPlace(browser.snapshot)).toEqual({ kind: "dir", path: "/home/j/repo" });
    await browser.follow({ kind: "dir", path: "/home/j/repo" });
    expect(parentPlace(browser.snapshot)).toEqual({ kind: "roots" });
    await browser.follow(null);
    expect(parentPlace(browser.snapshot)).toBeNull();
  });

  it("drops an answer for a folder already left", async () => {
    const { browser, fs } = setup();
    await browser.follow({ kind: "dir", path: "/home/j/repo" });
    fs.hold = true;
    const slow = browser.follow({ kind: "dir", path: "/home/j/repo/src" });
    fs.hold = false;
    await browser.follow({ kind: "dir", path: "/home/j/up" });
    fs.release();
    await slow;
    expect(browser.snapshot.place).toEqual({ kind: "dir", path: "/home/j/up" });
    expect(browser.snapshot.pages?.path).toBe("/home/j/up");
  });

  it("shows a refusal and no stale entries for a folder outside the roots and $HOME", async () => {
    const { browser } = setup();
    await browser.follow({ kind: "dir", path: "/home/j/repo" });
    await browser.follow({ kind: "dir", path: "/etc" });
    expect(browser.snapshot.error?.code).toBe("outside_home");
    expect(browser.snapshot.pages).toBeNull();
    expect(parentPlace(browser.snapshot)).toEqual({ kind: "roots" });
  });

  it("lists a folder under $HOME outside the roots by the picker, subfolders only, and in full once added", async () => {
    const { browser, fs } = setup();
    await browser.follow({ kind: "dir", path: "/home/j/repo" });
    await browser.follow({ kind: "dir", path: "/home/j/other" });
    expect(fs.calls.at(-1)).toBe("dirs /home/j/other 0");
    expect(browser.snapshot.pages?.via).toBe("dirs");
    await browser.addRoot("/home/j/other");
    expect(browser.snapshot.pages?.via).toBe("list");
  });

  it("falls back to the picker when a root's folder leads out of the roots", async () => {
    const { browser, fs } = setup();
    // Roots unknown yet: the first listing is asked of /fs/list, which refuses it.
    await browser.follow({ kind: "dir", path: "/home/j/other" });
    expect(fs.calls).toContain("list /home/j/other 0");
    expect(browser.snapshot.pages?.via).toBe("dirs");
  });

  it("relists the folder on screen when an upload lands in it", async () => {
    const { browser, fs } = setup();
    await browser.follow({ kind: "dir", path: "/home/j/up" });
    const before = fs.calls.length;
    await browser.uploaded("/home/j/repo/x.jpg");
    expect(fs.calls.length).toBe(before);
    await browser.uploaded("/home/j/up/20261022-101010Z-abcd.jpg");
    expect(fs.calls.at(-1)).toBe("list /home/j/up 0");
  });
});
