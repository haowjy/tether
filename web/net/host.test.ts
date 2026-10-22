import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMsg, WindowRef } from "../proto/generated/messages";
import type { ConnectionState } from "../tabs/connection";
import { TabDriver, type TabOptions } from "../tabs/driver";
import { makeHost } from "./fakes";

const server = "main:1-2";
const winA: WindowRef = { server, window: 3 };
const winB: WindowRef = { server, window: 4 };

function setup() {
  const h = makeHost();
  const painted: string[] = [];
  const dec = new TextDecoder();
  const tab = (name: string, window: WindowRef) => {
    const states: ConnectionState[] = [];
    const renderer: TabOptions["renderer"] = {
      output: (b) => painted.push(`${name}:o:${dec.decode(b)}`),
      snapshot: (s) => { painted.push(`${name}:s:${dec.decode(s.restore)}`); return Promise.resolve(); },
    };
    const driver = new TabDriver({ window, renderer, host: h.host, size: () => ({ cols: 80, rows: 24 }), onState: (s) => states.push(s), onNotice: () => undefined, random: () => 0.5 });
    return { driver, state: (): ConnectionState => states[states.length - 1] as ConnectionState };
  };
  const watching = (watch: number, window: WindowRef): ServerMsg => ({
    type: "watching",
    data: { watch, window, session: { server, session: 1 }, pane: 1, cwd: null },
  });
  return { ...h, tab, painted, watching };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("one socket per host", () => {
  it("shares one link, gives each tab its own watch, and routes frames by watch id", () => {
    const t = setup();
    const a = t.tab("a", winA);
    const b = t.tab("b", winB);
    expect(t.links).toHaveLength(1);
    t.link().welcome();
    expect(t.link().sent.map((m) => m.type === "watch" && [m.data.watch, m.data.window.window])).toEqual([[1, 3], [2, 4]]);
    t.link().say(t.watching(1, winA));
    t.link().say(t.watching(2, winB));
    t.link().snapshot(1, "A");
    t.link().output(2, "B");
    expect(t.painted).toEqual(["a:s:A", "b:o:B"]);
    expect(a.state().kind).toBe("live");
    expect(b.state().kind).toBe("live");
  });

  it("routes history replies and errors to the asking tab, and ends to the right tab", async () => {
    const t = setup();
    const a = t.tab("a", winA);
    const b = t.tab("b", winB);
    t.link().welcome();
    t.link().say(t.watching(1, winA));
    t.link().say(t.watching(2, winB));
    const rows = b.driver.history(-1, -1);
    const failed = a.driver.history(-1, -1);
    expect(t.link().sent.slice(-2).map((m) => m.type === "history" && m.data.req)).toEqual([1, 2]);
    t.link().say({ type: "historyChunk", data: { req: 1, watch: 2, start: -1, lines: [btoa("x")] } });
    expect((await rows).map((r) => new TextDecoder().decode(r))).toEqual(["x"]);
    t.link().say({ type: "error", data: { req: 2, code: "busy", message: "no" } });
    await expect(failed).rejects.toThrow("busy");
    t.link().say({ type: "watchEnded", data: { watch: 1, reason: "detached" } });
    expect(a.state()).toMatchObject({ kind: "reconnecting", halt: "detached" });
    expect(b.state().kind).toBe("live");
  });

  it("closes one tab on its windowClosed and the socket with the last tab", () => {
    const t = setup();
    const a = t.tab("a", winA);
    const b = t.tab("b", winB);
    t.link().welcome();
    t.link().say(t.watching(2, winB));
    t.link().say({ type: "windowClosed", data: { window: winA } });
    expect(a.state().kind).toBe("closed");
    expect(b.state().kind).toBe("live");
    expect(t.link().closed).toBe(false);
    t.link().say({ type: "serverExited", data: { server } });
    expect(b.state().kind).toBe("closed");
    expect(t.link().closed).toBe(true);
  });
});

describe("reconnect is per host", () => {
  it("backs off once for all tabs, then re-watches each on the new socket", () => {
    const t = setup();
    const a = t.tab("a", winA);
    const b = t.tab("b", winB);
    t.link().welcome();
    t.link().say(t.watching(1, winA));
    t.link().say(t.watching(2, winB));
    t.link().drop();
    expect(a.state()).toMatchObject({ kind: "reconnecting", retryInMs: 500 });
    expect(b.state()).toMatchObject({ kind: "reconnecting", retryInMs: 500 });
    vi.advanceTimersByTime(499);
    expect(t.links).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(t.links).toHaveLength(2);
    t.link().drop();
    expect(a.state()).toMatchObject({ retryInMs: 1000 });
    vi.advanceTimersByTime(1000);
    t.link().welcome();
    expect(t.link().sent.map((m) => m.type === "watch" && m.data.watch)).toEqual([3, 4]);
  });

  it("on 4401 tells native, stops retrying, and a tap tries again", () => {
    const t = setup();
    const a = t.tab("a", winA);
    t.link().drop(4401);
    expect(t.events).toEqual(["rejected"]);
    expect(a.state()).toMatchObject({ halt: "unauthorized", retryInMs: null });
    vi.advanceTimersByTime(120_000);
    expect(t.links).toHaveLength(1);
    a.driver.nudge();
    expect(t.links).toHaveLength(2);
  });
});

describe("lifecycle", () => {
  it("closes the socket on background without counting a loss, and reconnects at once on foreground", () => {
    const t = setup();
    const a = t.tab("a", winA);
    t.link().welcome();
    t.link().say(t.watching(1, winA));
    t.host.background();
    expect(t.link().closed).toBe(true);
    expect(t.events).toEqual([]);
    expect(a.state()).toEqual({ kind: "connecting", attempt: 0 });
    vi.advanceTimersByTime(120_000);
    expect(t.links).toHaveLength(1);
    t.host.nudge(); // network signals do nothing while in the background
    expect(t.links).toHaveLength(1);
    t.host.foreground();
    expect(t.links).toHaveLength(2);
    t.link().welcome();
    expect(t.link().sent.at(-1)).toMatchObject({ type: "watch", data: { watch: 2 } });
  });

  it("foreground resets a backoff that was running", () => {
    const t = setup();
    t.tab("a", winA);
    t.link().drop();
    t.host.background();
    vi.advanceTimersByTime(60_000);
    expect(t.links).toHaveLength(1);
    t.host.foreground();
    expect(t.links).toHaveLength(2);
  });

  it("a network nudge reconnects a waiting host now, and leaves a live socket alone", () => {
    const t = setup();
    t.tab("a", winA);
    t.link().welcome();
    t.host.nudge();
    expect(t.links).toHaveLength(1);
    t.link().drop();
    t.host.nudge();
    expect(t.links).toHaveLength(2);
    vi.advanceTimersByTime(60_000);
    expect(t.links).toHaveLength(2); // the cancelled backoff timer did not open a third
  });
});

describe("connect timeout", () => {
  it("tries one new socket at once, then asks native to recreate the web view", () => {
    const t = setup();
    const a = t.tab("a", winA);
    t.link().drop(1006, "connectTimeout");
    expect(t.links).toHaveLength(2);
    expect(t.events).toEqual([]);
    t.link().drop(1006, "connectTimeout");
    expect(t.links).toHaveLength(2);
    expect(t.events).toEqual(["stuck"]);
    expect(a.state().kind).toBe("reconnecting");
  });

  it("forgives one timeout once a socket gets through", () => {
    const t = setup();
    t.tab("a", winA);
    t.link().drop(1006, "connectTimeout");
    t.link().welcome();
    t.link().drop();
    vi.advanceTimersByTime(500);
    t.link().drop(1006, "connectTimeout");
    expect(t.events).toEqual([]);
  });
});
