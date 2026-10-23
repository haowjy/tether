import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMsg } from "../proto/generated/messages";
import type { Snapshot } from "../term";
import type { ConnectionState } from "./connection";
import { makeHost, type FakeLink } from "../platform/test/host";
import { TabDriver, type TabOptions } from "./driver";

const window1 = { server: "main:1-2", window: 3 };

function setup() {
  const { host, links, link, events } = makeHost();
  const painted: string[] = [];
  const states: ConnectionState[] = [];
  const notices: string[] = [];
  const dec = new TextDecoder();
  const renderer: TabOptions["renderer"] = {
    output: (b) => painted.push(`o:${dec.decode(b)}`),
    snapshot: (s: Snapshot) => { painted.push(`s:${dec.decode(s.restore)}`); return Promise.resolve(); },
  };
  let size = { cols: 80, rows: 24 };
  const tab = new TabDriver({
    window: window1,
    renderer,
    host,
    size: () => size,
    onState: (s) => states.push(s),
    onNotice: (n) => notices.push(n),
    random: () => 0.5,
  });
  const watching = (watch: number): ServerMsg => ({
    type: "watching",
    data: { watch, window: window1, session: { server: window1.server, session: 1 }, pane: 1, cwd: null },
  });
  /** Welcome and bind watch 1. */
  const bind = (): FakeLink => { link().welcome(); link().say(watching(1)); return link(); };
  const state = (): ConnectionState => states[states.length - 1] as ConnectionState;
  const resizeTo = (cols: number, rows: number): void => { size = { cols, rows }; };
  return { tab, links, link, events, painted, notices, watching, bind, state, resizeTo };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("watching", () => {
  it("watches with the terminal size once welcomed, then applies snapshot and output in order", () => {
    const t = setup();
    expect(t.link().sent).toEqual([]);
    t.link().welcome();
    expect(t.link().sent).toEqual([{ type: "watch", data: { watch: 1, window: window1, size: { cols: 80, rows: 24 } } }]);
    t.link().say(t.watching(1));
    expect(t.state().kind).toBe("live");
    t.link().snapshot(1, "S");
    t.link().output(1, "A");
    t.link().output(9, "stale");
    expect(t.painted).toEqual(["s:S", "o:A"]);
  });

  it("treats a repeated watching for the same watch as an update", () => {
    const t = setup();
    const l = t.bind();
    l.snapshot(1, "S");
    const sent = l.sent.length;
    const again = t.watching(1);
    if (again.type === "watching") again.data.cwd = "/tmp";
    l.say(again);
    expect(t.state().kind).toBe("live");
    expect(l.sent).toHaveLength(sent);
    l.output(1, "A");
    expect(t.painted).toEqual(["s:S", "o:A"]);
  });

  it("unwatches when covered, drops frames meanwhile, and rewatches with a new id on return", () => {
    const t = setup();
    const l = t.bind();
    t.tab.cover();
    expect(l.sent.at(-1)).toEqual({ type: "unwatch", data: { watch: 1 } });
    l.output(1, "late");
    expect(t.painted).toEqual([]);
    t.tab.uncover();
    expect(l.sent.at(-1)).toMatchObject({ type: "watch", data: { watch: 2 } });
    l.say(t.watching(2));
    l.snapshot(2, "fresh");
    expect(t.painted).toEqual(["s:fresh"]);
    expect(t.links).toHaveLength(1);
  });
});

describe("ending a tab", () => {
  it("tells the daemon when the user closes a bound tab, or one whose watch is still in flight", () => {
    const t = setup();
    const l = t.bind();
    t.tab.close();
    expect(l.sent.at(-1)).toEqual({ type: "unwatch", data: { watch: 1 } });
    const u = setup();
    u.link().welcome();
    u.tab.close();
    expect(u.link().sent.at(-1)).toEqual({ type: "unwatch", data: { watch: 1 } });
  });

  it("sends no unwatch for a covered tab, which has none", () => {
    const t = setup();
    const l = t.bind();
    t.tab.cover();
    t.tab.close();
    expect(l.types()).toEqual(["watch", "unwatch"]);
  });
});

describe("resizing", () => {
  it("sends a size that changed while the watch was in flight, once it binds", () => {
    const t = setup();
    t.link().welcome();
    t.resizeTo(60, 60);
    t.tab.resize({ cols: 60, rows: 60 }); // dropped: not bound yet
    expect(t.link().types()).toEqual(["watch"]);
    t.link().say(t.watching(1));
    expect(t.link().sent.at(-1)).toEqual({ type: "resize", data: { watch: 1, size: { cols: 60, rows: 60 } } });
  });

  it("sends nothing when the size is the one watched with", () => {
    const t = setup();
    const l = t.bind();
    expect(l.types()).toEqual(["watch"]);
    t.tab.resize({ cols: 80, rows: 24 });
    expect(l.types()).toEqual(["watch"]);
    t.tab.resize({ cols: 90, rows: 30 });
    expect(l.types()).toEqual(["watch", "resize"]);
  });
});

describe("losing the watch or the link", () => {
  it("waits for a tap after watchEnded detached, then watches again on the same socket", () => {
    const t = setup();
    const l = t.bind();
    l.say({ type: "watchEnded", data: { watch: 1, reason: "detached" } });
    vi.advanceTimersByTime(60_000);
    expect(l.types()).toEqual(["watch"]);
    t.tab.nudge();
    expect(l.sent.at(-1)).toMatchObject({ type: "watch", data: { watch: 2 } });
  });

  it("retries after a backoff when the watch ends in error", () => {
    const t = setup();
    const l = t.bind();
    l.say({ type: "watchEnded", data: { watch: 1, reason: "error", message: "x" } });
    expect(l.types()).toEqual(["watch"]);
    vi.advanceTimersByTime(500);
    expect(l.types()).toEqual(["watch", "watch"]);
  });

  it("a watch that keeps failing backs off and shows the daemon's message", () => {
    const t = setup();
    const l = t.bind();
    l.say({ type: "watchEnded", data: { watch: 1, reason: "error", message: "boom" } });
    expect(t.state()).toMatchObject({ kind: "reconnecting", message: "boom" });
    vi.advanceTimersByTime(500);
    l.say({ type: "watchEnded", data: { watch: 2, reason: "error", message: "boom" } });
    vi.advanceTimersByTime(999);
    expect(l.types()).toEqual(["watch", "watch"]);
    vi.advanceTimersByTime(1);
    expect(l.types()).toEqual(["watch", "watch", "watch"]);
  });

  it("keeps a tab the daemon refused for its session limit, with the daemon's message, and asks again on a growing backoff", () => {
    const t = setup();
    const l = t.bind();
    l.say({ type: "watchEnded", data: { watch: 1, reason: "limit", message: "tether on pop-os allows 3 tmux sessions at a time; open now: a, b, c" } });
    expect(t.state()).toMatchObject({ kind: "limited", message: "tether on pop-os allows 3 tmux sessions at a time; open now: a, b, c" });
    vi.advanceTimersByTime(500);
    expect(l.types()).toEqual(["watch", "watch"]);
    l.say({ type: "watchEnded", data: { watch: 2, reason: "limit" } });
    vi.advanceTimersByTime(999);
    expect(l.types()).toEqual(["watch", "watch"]);
    vi.advanceTimersByTime(1);
    expect(l.types()).toEqual(["watch", "watch", "watch"]);
    // Retry asks at once and keeps the count, so the next refusal waits longer still.
    l.say({ type: "watchEnded", data: { watch: 3, reason: "limit" } });
    t.tab.nudge();
    expect(l.types()).toEqual(["watch", "watch", "watch", "watch"]);
    l.say(t.watching(4));
    expect(t.state().kind).toBe("live");
  });

  it("opens a new link after the socket drops", () => {
    const t = setup();
    t.bind().drop();
    expect(t.links).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(t.links).toHaveLength(2);
  });

  it("closes on windowClosed for its own window only, and on serverExited", () => {
    const t = setup();
    const l = t.bind();
    l.say({ type: "windowClosed", data: { window: { ...window1, window: 4 } } });
    expect(t.state().kind).toBe("live");
    l.say({ type: "windowClosed", data: { window: window1 } });
    expect(t.state()).toEqual({ kind: "closed", reason: "windowClosed" });
    expect(l.closed).toBe(true);

    const u = setup();
    u.bind().say({ type: "serverExited", data: { server: window1.server } });
    expect(u.state()).toEqual({ kind: "closed", reason: "serverExited" });
  });
});

describe("history", () => {
  it("follows the true start after clamping, asks again after a short chunk, and stops at the end", async () => {
    const t = setup();
    const l = t.bind();
    const b64 = (s: string): string => btoa(s);
    const rows = t.tab.history(-400, -1);
    expect(l.sent.at(-1)).toEqual({ type: "history", data: { req: 1, watch: 1, start: -400, end: -1 } });
    l.say({ type: "historyChunk", data: { req: 1, watch: 1, start: -4, lines: [], wraps: b64("") } });
    await Promise.resolve();
    expect(l.sent.at(-1)).toEqual({ type: "history", data: { req: 2, watch: 1, start: -4, end: -1 } });
    l.say({ type: "historyChunk", data: { req: 2, watch: 1, start: -4, lines: [b64("a"), b64("b")], wraps: b64("\x02") } });
    await Promise.resolve();
    expect(l.sent.at(-1)).toEqual({ type: "history", data: { req: 3, watch: 1, start: -2, end: -1 } });
    l.say({ type: "historyChunk", data: { req: 3, watch: 1, start: -2, lines: [b64("c"), b64("d")], wraps: b64("") } });
    expect((await rows).map((r) => new TextDecoder().decode(r))).toEqual(["a", "bc", "d"]);
  });

  it("rejects when the watch ends, without asking for the rest", async () => {
    const t = setup();
    const l = t.bind();
    const rows = t.tab.history(-4, -1);
    l.say({ type: "watchEnded", data: { watch: 1, reason: "error" } });
    l.say({ type: "historyChunk", data: { req: 1, watch: 1, start: -4, lines: [btoa("a")], wraps: btoa("") } });
    await expect(rows).rejects.toThrow("watch ended");
    expect(l.types().filter((type) => type === "history")).toHaveLength(1);
  });
});

describe("input", () => {
  it("goes only to a bound watch, in order, with paste as its own message", () => {
    const t = setup();
    expect(t.tab.input([{ text: "x" }])).toBe(false);
    const l = t.bind();
    expect(t.tab.input([{ text: "ls" }, { key: "Enter" }, { paste: "big" }, { key: "Up" }])).toBe(true);
    expect(l.sent.slice(1)).toEqual([
      { type: "input", data: { watch: 1, items: [{ text: "ls" }, { key: "Enter" }] } },
      { type: "paste", data: { watch: 1, text: "big" } },
      { type: "input", data: { watch: 1, items: [{ key: "Up" }] } },
    ]);
  });

  it("splits text over the 4 KiB limit", () => {
    const t = setup();
    const l = t.bind();
    t.tab.input([{ text: "é".repeat(3000) }]); // 6000 bytes
    const sizes = l.sent.slice(1).map((m) => (m.type === "input" ? JSON.stringify(m.data.items).length : 0));
    expect(l.sent).toHaveLength(3);
    expect(Math.max(...sizes)).toBeLessThan(4200);
  });
});

describe("upload insertion", () => {
  it("waits for the watch, then types the quoted path without Enter", () => {
    const t = setup();
    t.tab.insertPath("/up/my photo.jpg");
    t.link().welcome();
    expect(t.link().types()).toEqual(["watch"]);
    t.link().say(t.watching(1));
    expect(t.link().sent.at(-1)).toEqual({ type: "input", data: { watch: 1, items: [{ text: "'/up/my photo.jpg'" }] } });
    t.tab.insertPath("/up/b.png");
    expect(t.link().sent.at(-1)).toEqual({ type: "input", data: { watch: 1, items: [{ text: "/up/b.png" }] } });
  });

  it("is dropped with a notice naming the file when the tab closes first", () => {
    const t = setup();
    t.tab.insertPath("/up/a.jpg");
    t.link().say({ type: "windowClosed", data: { window: window1 } });
    expect(t.notices).toEqual(["Could not insert a.jpg: the tab closed."]);
    t.tab.insertPath("/up/b.jpg");
    expect(t.notices).toHaveLength(2);
  });

  it("is dropped with a notice when the watch fails before it binds, and refused outright while disconnected", () => {
    const t = setup();
    t.link().welcome();
    expect(t.tab.insertPath("/up/a.jpg")).toBe(false);
    t.link().say({ type: "watchEnded", data: { watch: 1, reason: "error" } });
    expect(t.notices).toHaveLength(1);
    expect(t.notices[0]).toContain("a.jpg");
    expect(t.tab.insertPath("/up/b.jpg")).toBe(false);
    expect(t.notices).toHaveLength(2);
    vi.advanceTimersByTime(500);
    t.link().say(t.watching(2));
    expect(t.link().types()).not.toContain("input");
  });

  it("reports whether the path was typed now", () => {
    const t = setup();
    const l = t.bind();
    expect(t.tab.insertPath("/up/a.jpg")).toBe(true);
    t.tab.cover();
    expect(t.tab.insertPath("/up/b.jpg")).toBe(false);
    expect(l.types()).toEqual(["watch", "input", "unwatch"]);
  });
});
