import { describe, expect, it } from "vitest";
import { FileBrowser, within } from "./browser";
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
  it("opens at the tab's cwd when a root holds it", async () => {
    const { browser } = setup();
    await browser.start("/home/j/repo/src");
    expect(browser.snapshot.place).toEqual({ kind: "dir", path: "/home/j/repo/src" });
    expect(browser.snapshot.pages?.entries.map((e) => e.name)).toEqual(["main.rs"]);
  });

  it("opens at the roots when no root holds the cwd, without listing it", async () => {
    const { browser, fs } = setup();
    await browser.start("/home/j/repo2");
    expect(browser.snapshot.place).toEqual({ kind: "roots" });
    expect(fs.calls).toEqual(["roots"]);
  });

  it("lists directories first, pages on demand, and keeps hidden files out until asked", async () => {
    const { browser, fs } = setup();
    await browser.start("/home/j/repo");
    expect(browser.snapshot.pages?.entries.map((e) => e.name)).toEqual(["src", "README.md", "a.ts"]);
    await browser.more();
    expect(browser.snapshot.pages?.entries.map((e) => e.name)).toEqual(["src", "README.md", "a.ts", "b.png", "c.rs"]);
    await browser.more(); // nothing left: no request
    expect(fs.calls.filter((c) => c.startsWith("list"))).toEqual(["list /home/j/repo 0", "list /home/j/repo 3"]);
    await browser.toggleHidden();
    expect(browser.snapshot.pages?.entries.map((e) => e.name)).toContain(".git");
  });

  it("goes back from a viewer to the listing it came from without relisting", async () => {
    const { browser, fs } = setup();
    await browser.start("/home/j/repo");
    const readme = browser.snapshot.pages?.entries.find((e) => e.name === "README.md");
    if (!readme) throw new Error("no README");
    await browser.openEntry(readme);
    expect(browser.snapshot.place).toMatchObject({ kind: "file", file: { path: "/home/j/repo/README.md", mime: "text/markdown; charset=utf-8" } });
    const lists = fs.calls.length;
    await browser.back();
    expect(browser.snapshot.place).toEqual({ kind: "dir", path: "/home/j/repo" });
    expect(fs.calls.length).toBe(lists);
  });

  it("walks up to the root's top, then to the roots", async () => {
    const { browser } = setup();
    await browser.start("/home/j/repo/src");
    await browser.back();
    expect(browser.snapshot.place).toEqual({ kind: "dir", path: "/home/j/repo" });
    await browser.back();
    expect(browser.snapshot.place).toEqual({ kind: "roots" });
  });

  it("drops an answer for a folder already left", async () => {
    const { browser, fs } = setup();
    await browser.start("/home/j/repo");
    fs.hold = true;
    const slow = browser.openDir("/home/j/repo/src");
    fs.hold = false;
    await browser.openDir("/home/j/up");
    fs.release();
    await slow;
    expect(browser.snapshot.place).toEqual({ kind: "dir", path: "/home/j/up" });
    expect(browser.snapshot.pages?.path).toBe("/home/j/up");
  });

  it("shows a refusal and no stale entries for a folder outside the roots", async () => {
    const { browser } = setup();
    await browser.start("/home/j/repo");
    await browser.openDir("/home/j/other");
    expect(browser.snapshot.error?.code).toBe("outside_roots");
    expect(browser.snapshot.pages).toBeNull();
  });

  it("opens a linked path as a file or a folder", async () => {
    const { browser } = setup();
    await browser.start("/home/j/repo");
    await browser.openPath("/home/j/repo/src/main.rs");
    expect(browser.snapshot.place).toMatchObject({ kind: "file", file: { name: "main.rs", path: "/home/j/repo/src/main.rs" } });
    await browser.openPath("/home/j/repo/src");
    expect(browser.snapshot.place).toEqual({ kind: "dir", path: "/home/j/repo/src" });
  });

  it("adds a root from the $HOME picker and returns to Settings", async () => {
    const { browser, fs } = setup();
    await browser.start(null);
    browser.showSettings();
    await browser.pick("root");
    expect(browser.snapshot.place).toEqual({ kind: "pick", purpose: "root", path: "/home/j" });
    expect(browser.snapshot.pages?.entries.every((e) => e.kind === "dir")).toBe(true);
    const other = browser.snapshot.pages?.entries.find((e) => e.name === "other");
    if (!other) throw new Error("no other");
    await browser.openEntry(other);
    await browser.choose();
    expect(fs.calls).toContain("add /home/j/other");
    expect(browser.snapshot.place).toEqual({ kind: "settings" });
    expect(browser.snapshot.roots?.roots.map((r) => r.path)).toEqual(["/home/j/repo", "/home/j/other"]);
    await browser.removeRoot("/home/j/repo");
    expect(browser.snapshot.roots?.roots.map((r) => r.path)).toEqual(["/home/j/other"]);
  });

  it("goes back from the picker's top to Settings", async () => {
    const { browser } = setup();
    await browser.start(null);
    await browser.pick("uploads");
    await browser.back();
    expect(browser.snapshot.place).toEqual({ kind: "settings" });
  });

  it("relists the folder on screen when an upload lands in it", async () => {
    const { browser, fs } = setup();
    await browser.start("/home/j/up");
    const before = fs.calls.length;
    await browser.uploaded("/home/j/repo/x.jpg");
    expect(fs.calls.length).toBe(before);
    await browser.uploaded("/home/j/up/20261022-101010Z-abcd.jpg");
    expect(fs.calls.at(-1)).toBe("list /home/j/up 0");
  });
});
