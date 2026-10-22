import { describe, expect, it } from "vitest";
import type { Viewport } from "../native/bridge";
import { fitSize, TerminalSizer } from "./size";

const cell = { width: 7, height: 15 };
const vp = (over: Partial<Viewport> = {}): Viewport => ({
  width: 393,
  height: 852,
  safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  keyboard: false,
  collapsedHeight: 852,
  reason: "initial",
  ...over,
});

describe("fitSize", () => {
  it("fits whole cells and keeps a minimum", () => {
    expect(fitSize(393, 780, cell)).toEqual({ cols: 56, rows: 52 });
    expect(fitSize(40, 20, cell)).toEqual({ cols: 20, rows: 4 });
  });
});

describe("TerminalSizer", () => {
  function setup(measured: typeof cell | null = cell) {
    const changes: string[] = [];
    let current = measured;
    const sizer = new TerminalSizer({
      cell: () => current,
      chromeHeight: () => 72,
      onChange: (s) => changes.push(`${String(s.cols)}x${String(s.rows)}`),
    });
    return { sizer, changes, setCell: (c: typeof cell) => { current = c; } };
  }

  it("sizes from width and collapsedHeight on initial and rotation", () => {
    const { sizer, changes } = setup();
    expect(sizer.size).toEqual({ cols: 80, rows: 24 });
    sizer.setViewport(vp());
    sizer.setViewport(vp({ width: 852, collapsedHeight: 393, reason: "rotation", safeArea: { top: 0, right: 59, bottom: 21, left: 59 } }));
    expect(changes).toEqual(["56x45", "104x20"]);
  });

  it("never resizes for the keyboard, whatever the live height", () => {
    const { sizer, changes } = setup();
    sizer.setViewport(vp());
    sizer.setViewport(vp({ height: 400, keyboard: true, reason: "keyboard" }));
    sizer.setViewport(vp({ reason: "keyboard" }));
    expect(changes).toEqual(["56x45"]);
  });

  it("recomputes when the font changes or the cell first becomes measurable", () => {
    const { sizer, changes, setCell } = setup(null);
    sizer.setViewport(vp());
    expect(changes).toEqual([]);
    setCell(cell);
    sizer.remeasure();
    setCell({ width: 9, height: 18 });
    sizer.remeasure();
    sizer.remeasure(); // same size: no change event
    expect(changes).toEqual(["56x45", "43x38"]);
  });
});
