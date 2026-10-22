import { describe, expect, it } from "vitest";
import type { Viewport } from "../native/bridge";
import { cursorPan, fitSize, TerminalSizer } from "./size";

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
      edge: () => 4,
      onChange: (s) => changes.push(`${String(s.cols)}x${String(s.rows)}`),
    });
    return { sizer, changes, setCell: (c: typeof cell) => { current = c; } };
  }

  it("sizes from width and collapsedHeight on initial and rotation, keeping the edge gap where no inset gives it", () => {
    const { sizer, changes } = setup();
    expect(sizer.size).toEqual({ cols: 80, rows: 24 });
    sizer.setViewport(vp());
    sizer.setViewport(vp({ width: 852, collapsedHeight: 393, reason: "rotation", safeArea: { top: 0, right: 59, bottom: 21, left: 59 } }));
    expect(changes).toEqual(["55x45", "104x20"]);
  });

  it("never resizes for the keyboard, whatever the live height", () => {
    const { sizer, changes } = setup();
    sizer.setViewport(vp());
    sizer.setViewport(vp({ height: 400, keyboard: true, reason: "keyboard" }));
    sizer.setViewport(vp({ reason: "keyboard" }));
    expect(changes).toEqual(["55x45"]);
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
    expect(changes).toEqual(["55x45", "42x38"]);
  });
});

describe("cursorPan", () => {
  // 45 rows of 15 px = 675 px of terminal.
  it("stays put while every row fits", () => {
    expect(cursorPan(44, 45, 15, 675)).toBe(0);
  });

  it("slides the cursor row's bottom to the bottom of what the keyboard leaves", () => {
    expect(cursorPan(44, 45, 15, 300)).toBe(375); // last row: everything above slides
    expect(cursorPan(30, 45, 15, 300)).toBe(165);
    expect(cursorPan(5, 45, 15, 300)).toBe(0); // cursor near the top: no slide
  });

  it("never slides past the last row", () => {
    expect(cursorPan(60, 45, 15, 300)).toBe(375);
  });
});
