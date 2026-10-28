import { describe, expect, it } from "vitest";
import { entryPlace, FileBrowser, parentPlace } from "./browser";
import { FakeFs, type FakeTree } from "../platform/test/fs";

const tree = (): FakeTree => ({
  home: "/home/j",
  favorites: ["/home/j/repo"],
  uploads: "/home/j/up",
  dirs: ["/", "/home", "/etc", "/home/j", "/home/j/repo", "/home/j/repo/src", "/home/j/repo/.git", "/home/j/up", "/home/j/other", "/home/j/repo2"],
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

describe("FileBrowser", () => {
  it("opens ~ as the home the favorites name, and a folder the tab names", async () => {
    const { browser, fs } = setup();
    await browser.follow({ kind: "dir", path: "~" });
    expect(browser.snapshot.place).toEqual({ kind: "dir", path: "/home/j" });
    expect(browser.snapshot.favorites?.favorites.map((r) => r.path)).toEqual(["/home/j/repo"]);
    await browser.follow({ kind: "dir", path: "/home/j/repo/src" });
    expect(browser.snapshot.pages?.entries.map((e) => e.name)).toEqual(["main.rs"]);
    expect(fs.calls).toEqual(["favorites", "list /home/j 0", "list /home/j/repo/src 0"]);
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
    if (!place) throw new Error("no place");
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

  it("goes up a level to `/`, which has no parent", async () => {
    const { browser } = setup();
    await browser.follow({ kind: "file", path: "/home/j/repo/src/main.rs" });
    expect(parentPlace(browser.snapshot)).toEqual({ kind: "dir", path: "/home/j/repo/src" });
    await browser.follow({ kind: "dir", path: "/home/j" });
    expect(parentPlace(browser.snapshot)).toEqual({ kind: "dir", path: "/home" });
    await browser.follow({ kind: "dir", path: "/" });
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

  it("lists a folder outside home, and a vanished folder has no stale entries and still a way up", async () => {
    const { browser } = setup();
    await browser.follow({ kind: "dir", path: "/home/j/repo" });
    await browser.follow({ kind: "dir", path: "/etc" });
    expect(browser.snapshot.pages?.path).toBe("/etc");
    await browser.follow({ kind: "dir", path: "/home/j/gone/deeper" });
    expect(browser.snapshot.error?.code).toBe("not_found");
    expect(browser.snapshot.pages).toBeNull();
    expect(parentPlace(browser.snapshot)).toEqual({ kind: "dir", path: "/home/j/gone" });
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
