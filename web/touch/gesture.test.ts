import { describe, expect, it } from "vitest";
import { GestureRecognizer, type GestureAction } from "./gesture";

/** Drives a recognizer with a clock; the shell's timer is `tickTo`. */
function rig() {
  const r = new GestureRecognizer();
  let now = 0;
  const out: GestureAction[] = [];
  const take = (actions: GestureAction[]): GestureAction[] => { out.push(...actions); return actions; };
  return {
    out,
    get now() { return now; },
    down: (x: number, y: number, id = 1) => take(r.down(id, x, y, now)),
    move: (x: number, y: number, id = 1) => take(r.move(id, x, y, now)),
    up: (id = 1) => take(r.up(id, now)),
    cancel: () => take(r.cancel()),
    /** Advance the clock by `ms`, firing every deadline on the way. */
    wait: (ms: number) => {
      const end = now + ms;
      for (let d = r.deadline; d !== null && d <= end; d = r.deadline) {
        now = d;
        take(r.advance(now));
      }
      now = end;
    },
    r,
  };
}

const types = (a: GestureAction[]): string[] => a.map((x) => x.type);

describe("GestureRecognizer", () => {
  it("a press released before the long-press, unmoved, is a tap where it began", () => {
    const g = rig();
    g.down(40, 60);
    g.wait(120);
    g.move(43, 62); // inside the slop
    g.up();
    expect(g.out).toEqual([{ type: "tap", x: 40, y: 60 }]);
  });

  it("sends nothing at touch start", () => {
    const g = rig();
    expect(g.down(5, 5)).toEqual([]);
  });

  it("hold then release without moving selects the word under the finger", () => {
    const g = rig();
    g.down(40, 60);
    g.wait(400);
    g.move(44, 63); // inside the dead zone
    g.up();
    expect(g.out).toEqual([
      { type: "longPress", x: 40, y: 60 },
      { type: "selectWord", x: 44, y: 63 },
    ]);
  });

  it("hold then drag is the arrow pad: arrows in the drag's direction, repeating while held, none after release", () => {
    const g = rig();
    g.down(100, 100);
    g.wait(400);
    g.move(100, 100 + 30);
    expect(g.out.at(-1)).toEqual({ type: "arrowPad", direction: "Down" });
    const before = g.out.filter((a) => a.type === "arrowPad").length;
    g.wait(1000);
    expect(g.out.filter((a) => a.type === "arrowPad").length).toBeGreaterThan(before + 3);
    expect(g.out.every((a) => a.type !== "selectWord" && a.type !== "tap" && a.type !== "scroll")).toBe(true);
    g.up();
    expect(g.out.at(-1)).toEqual({ type: "padEnd" });
    const total = g.out.length;
    g.wait(1000);
    expect(g.out).toHaveLength(total);
  });

  it("changing direction sends that direction at once, and returning to the centre rests the pad", () => {
    const g = rig();
    g.down(100, 100);
    g.wait(400);
    g.move(100 - 40, 100);
    expect(g.out.at(-1)).toEqual({ type: "arrowPad", direction: "Left" });
    g.move(100 + 40, 100 + 2);
    expect(g.out.at(-1)).toEqual({ type: "arrowPad", direction: "Right" });
    g.move(102, 101);
    const n = g.out.length;
    g.wait(600);
    expect(g.out).toHaveLength(n);
    g.up();
    // At rest in the dead zone: a release is the word selection, as if it never moved far.
    expect(g.out.at(-1)).toMatchObject({ type: "selectWord" });
  });

  it("repeats faster the further out the finger is", () => {
    const count = (distance: number): number => {
      const g = rig();
      g.down(0, 200);
      g.wait(400);
      g.move(0, 200 - distance);
      g.wait(1000);
      return g.out.filter((a) => a.type === "arrowPad").length;
    };
    expect(count(90)).toBeGreaterThan(count(24) * 2);
  });

  it("movement before the long-press fires is a scroll, and the long-press never fires", () => {
    const g = rig();
    g.down(100, 300);
    g.wait(100);
    g.move(100, 285); // crosses the slop: scrolling starts from here
    g.wait(50);
    g.move(100, 260);
    g.wait(500);
    g.up();
    expect(types(g.out)).toEqual(["scroll", "scrollEnd"]);
    expect(g.out[0]).toMatchObject({ type: "scroll", dy: -25 });
  });

  it("a fast release carries its velocity; a finger that paused before lifting has none", () => {
    const flick = rig();
    flick.down(100, 400);
    for (let y = 400; y >= 300; y -= 10) {
      flick.wait(8);
      flick.move(100, y);
    }
    flick.up();
    const end = flick.out.at(-1);
    expect(end).toMatchObject({ type: "scrollEnd" });
    expect((end as { velocity: number }).velocity).toBeLessThan(-800);

    const paused = rig();
    paused.down(100, 400);
    for (let y = 400; y >= 300; y -= 10) {
      paused.wait(8);
      paused.move(100, y);
    }
    paused.wait(300);
    paused.up();
    expect(paused.out.at(-1)).toEqual({ type: "scrollEnd", velocity: 0 });
  });

  it("a horizontal swipe does nothing at all, even when held", () => {
    const g = rig();
    g.down(10, 300);
    g.wait(50);
    g.move(60, 305);
    g.move(160, 310);
    g.wait(800);
    g.up();
    expect(g.out).toEqual([]);
  });

  it("pointercancel sends nothing but ends what was running", () => {
    const pending = rig();
    pending.down(1, 1);
    pending.cancel();
    pending.wait(1000);
    expect(pending.out).toEqual([{ type: "cancel" }]);

    const pad = rig();
    pad.down(100, 100);
    pad.wait(400);
    pad.move(100, 150);
    pad.cancel();
    const n = pad.out.length;
    pad.wait(1000);
    expect(pad.out).toHaveLength(n);
    expect(types(pad.out.slice(-2))).toEqual(["padEnd", "cancel"]);
    expect(pad.out.some((a) => a.type === "selectWord")).toBe(false);
  });

  it("a second finger cancels the first and resolves nothing until both lift", () => {
    const g = rig();
    g.down(10, 10, 1);
    g.down(200, 10, 2);
    g.wait(800);
    g.up(1);
    g.up(2);
    expect(g.out).toEqual([{ type: "cancel" }]);
    g.down(5, 5, 3);
    g.up(3);
    expect(g.out.at(-1)).toEqual({ type: "tap", x: 5, y: 5 });
  });

  it("a long-press fires the same while output streams: the clock alone decides", () => {
    // Output arrives between events as the shell's concern; the recognizer takes no output input, so a tight stream of moves inside the slop changes nothing.
    const g = rig();
    g.down(50, 50);
    for (let i = 0; i < 40; i++) {
      g.wait(10);
      g.move(50 + (i % 2), 50);
    }
    expect(g.out).toEqual([{ type: "longPress", x: 50, y: 50 }]);
  });
});
