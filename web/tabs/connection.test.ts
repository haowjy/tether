import { describe, expect, it } from "vitest";
import { backoffMs, initialState, reduce, type ConnectionEvent, type ConnectionState } from "./connection";

const run = (events: ConnectionEvent[], from: ConnectionState = initialState): ConnectionState =>
  events.reduce(reduce, from);
const lostMid = { type: "linkLost", retryInMs: 500 } as const;

describe("backoffMs", () => {
  it("doubles from 0.5 s and caps at 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map((a) => backoffMs(a, 0.5))).toEqual([
      500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });
  it("jitters within ±20% and never exceeds the cap", () => {
    expect(backoffMs(2, 0)).toBe(1600);
    expect(backoffMs(2, 0.999)).toBeLessThanOrEqual(2400);
    expect(backoffMs(9, 0.999)).toBe(30000);
  });
});

describe("tab connection", () => {
  it("goes connecting -> live on bound", () => {
    expect(run([{ type: "bound" }])).toEqual({ kind: "live" });
  });

  it("shows the host's countdown, refreshed by each failed retry", () => {
    let s = run([{ type: "bound" }, lostMid]);
    expect(s).toEqual({ kind: "reconnecting", attempt: 0, retryInMs: 500, halt: null });
    s = reduce(s, { type: "linkLost", retryInMs: 1000 });
    expect(s).toMatchObject({ kind: "reconnecting", retryInMs: 1000 });
  });

  it("a successful reconnect resets the count", () => {
    const s = run([lostMid, lostMid, { type: "linkUp" }, { type: "bound" }, lostMid]);
    expect(s).toMatchObject({ kind: "reconnecting", attempt: 0, retryInMs: 500 });
  });

  it("linkUp resumes a lost link but not a detached watch", () => {
    expect(run([lostMid, { type: "linkUp" }])).toMatchObject({ kind: "connecting" });
    const detached = run([{ type: "bound" }, { type: "watchEnded", reason: "detached", jitter: 0.5 }]);
    expect(reduce(detached, { type: "linkUp" })).toBe(detached);
    expect(reduce(detached, { type: "linkLost", retryInMs: 500 })).toBe(detached);
  });

  it("nudge retries at once and resets the backoff", () => {
    const s = run([lostMid, { type: "retry" }, lostMid, lostMid, { type: "nudge" }]);
    expect(s).toEqual({ kind: "connecting", attempt: 0 });
  });

  it("a stale timer after a nudge changes nothing", () => {
    const s = run([lostMid, { type: "nudge" }, { type: "retry" }]);
    expect(s).toEqual({ kind: "connecting", attempt: 0 });
  });

  it("incompatible/unauthorized hosts schedule no retry but a tap still works", () => {
    const s = run([{ type: "linkLost", retryInMs: null, halt: "unauthorized" }]);
    expect(s).toMatchObject({ kind: "reconnecting", retryInMs: null, halt: "unauthorized" });
    expect(reduce(s, { type: "retry" })).toBe(s);
    expect(reduce(s, { type: "nudge" })).toEqual({ kind: "connecting", attempt: 0 });
  });

  it("watchEnded detached waits for a tap; error backs off", () => {
    const live = run([{ type: "bound" }]);
    expect(reduce(live, { type: "watchEnded", reason: "detached", jitter: 0.5 })).toMatchObject({
      retryInMs: null,
      halt: "detached",
    });
    expect(reduce(live, { type: "watchEnded", reason: "error", jitter: 0.5 })).toMatchObject({ retryInMs: 500 });
  });

  it("a returning tab rewatches from live only", () => {
    expect(run([{ type: "bound" }, { type: "rewatch" }])).toEqual({ kind: "connecting", attempt: 0 });
    const rec = run([lostMid]);
    expect(reduce(rec, { type: "rewatch" })).toBe(rec);
  });

  it("closes only on window/server closure or the user, from any state, and stays closed", () => {
    for (const from of [initialState, run([{ type: "bound" }]), run([lostMid])]) {
      expect(reduce(from, { type: "windowClosed" })).toEqual({ kind: "closed", reason: "windowClosed" });
      expect(reduce(from, { type: "serverExited" })).toEqual({ kind: "closed", reason: "serverExited" });
      expect(reduce(from, { type: "userClosed" })).toEqual({ kind: "closed", reason: "user" });
    }
    const closed = run([{ type: "windowClosed" }]);
    expect(run([{ type: "bound" }, lostMid, { type: "nudge" }], closed)).toBe(closed);
  });

  it("network loss never closes a tab", () => {
    const s = run(Array.from({ length: 50 }, () => [lostMid, { type: "retry" }] as const).flat());
    expect(s.kind).not.toBe("closed");
  });
});
