import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMsg } from "../proto/generated/messages";
import type { Snapshot } from "../term";
import type { ConnectionState } from "./connection";
import { makeHost, type FakeLink } from "../net/fakes";
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
  const tab = new TabDriver({
    window: window1,
    renderer,
    host,
    size: () => ({ cols: 80, rows: 24 }),
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
  return { tab, links, link, events, painted, notices, watching, bind, state };
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

  it("opens a new link after the socket drops, and stops for a rejected token", () => {
    const t = setup();
    t.bind().drop();
    expect(t.links).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(t.links).toHaveLength(2);
    t.link().drop(4401);
    vi.advanceTimersByTime(60_000);
    expect(t.links).toHaveLength(2);
    expect(t.state()).toMatchObject({ kind: "reconnecting", halt: "unauthorized", retryInMs: null });
    t.tab.nudge();
    expect(t.links).toHaveLength(3);
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
  it("asks again from where a short chunk ended and stops at the end of the range", async () => {
    const t = setup();
    const l = t.bind();
    const b64 = (s: string): string => btoa(s);
    const rows = t.tab.history(-4, -1);
    expect(l.sent.at(-1)).toEqual({ type: "history", data: { req: 1, watch: 1, start: -4, end: -1 } });
    l.say({ type: "historyChunk", data: { req: 1, watch: 1, start: -4, lines: [b64("a"), b64("b")] } });
    await Promise.resolve();
    expect(l.sent.at(-1)).toEqual({ type: "history", data: { req: 2, watch: 1, start: -2, end: -1 } });
    l.say({ type: "historyChunk", data: { req: 2, watch: 1, start: -2, lines: [b64("c"), b64("d")] } });
    expect((await rows).map((r) => new TextDecoder().decode(r))).toEqual(["a", "b", "c", "d"]);
  });

  it("rejects when the watch ends, without asking for the rest", async () => {
    const t = setup();
    const l = t.bind();
    const rows = t.tab.history(-4, -1);
    l.say({ type: "watchEnded", data: { watch: 1, reason: "error" } });
    l.say({ type: "historyChunk", data: { req: 1, watch: 1, start: -4, lines: [btoa("a")] } });
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
});
