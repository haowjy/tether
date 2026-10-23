import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewport } from "../platform/types";
import { cursorPan, fitSize, TerminalSizer, terminalSize } from "./size";

const cell = { width: 7, height: 15 };
const vp = (over: Partial<Viewport> = {}): Viewport => ({
  layout: "phone",
  density: "touch",
  directInput: "owned",
  scheme: "dark",
  width: 393,
  stableHeight: 852,
  visibleHeight: 852,
  safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  keyboard: false,
  ...over,
});
const chrome = { x: 0, y: 52 };
const key = (s: { cols: number; rows: number }): string => `${String(s.cols)}x${String(s.rows)}`;

describe("fitSize", () => {
  it("fits whole cells and keeps a minimum", () => {
    expect(fitSize(393, 780, cell)).toEqual({ cols: 56, rows: 52 });
    expect(fitSize(40, 20, cell)).toEqual({ cols: 20, rows: 4 });
  });
});

describe("terminalSize", () => {
  it("takes the safe area and the chrome out of the stable box", () => {
    expect(terminalSize(vp(), chrome, cell)).toEqual({ cols: 56, rows: 47 });
  });
});

describe("TerminalSizer", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function setup(measured: typeof cell | null = cell) {
    const changes: string[] = [];
    let current = measured;
    const sizer = new TerminalSizer({ cell: () => current, onChange: (s) => changes.push(key(s)) });
    return { sizer, changes, setCell: (c: typeof cell) => { current = c; } };
  }

  it("knows no size until the viewport, the chrome and the cell are all known", () => {
    const { sizer } = setup(null);
    expect(sizer.measured).toBe(false);
    sizer.setViewport(vp());
    sizer.setChrome(chrome);
    expect(sizer.measured).toBe(false);
  });

  it("claims the first size for the first watch and sends only later changes, after they settle", () => {
    const { sizer, changes } = setup();
    sizer.setViewport(vp());
    sizer.setChrome(chrome);
    expect(key(sizer.claim())).toBe("56x47");
    vi.advanceTimersByTime(500);
    expect(changes).toEqual([]);
    sizer.setViewport(vp({ width: 852, stableHeight: 393, safeArea: { top: 0, right: 59, bottom: 21, left: 59 } }));
    vi.advanceTimersByTime(149);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual(["104x21"]);
  });

  it("sends a window drag once: only the trailing size", () => {
    const { sizer, changes } = setup();
    const still = { top: 0, right: 0, bottom: 0, left: 0 };
    sizer.setViewport(vp({ width: 800, safeArea: still }));
    sizer.setChrome({ x: 56, y: 44 });
    sizer.claim();
    for (let width = 820; width <= 1200; width += 20) {
      sizer.setViewport(vp({ width, safeArea: still }));
      vi.advanceTimersByTime(20);
    }
    vi.advanceTimersByTime(150);
    expect(changes).toEqual(["163x53"]);
  });

  it("never resizes for the keyboard: it changes none of the inputs", () => {
    const { sizer, changes } = setup();
    sizer.setViewport(vp());
    sizer.setChrome(chrome);
    sizer.claim();
    sizer.setViewport(vp({ visibleHeight: 400, keyboard: true }));
    sizer.setViewport(vp());
    vi.advanceTimersByTime(500);
    expect(changes).toEqual([]);
  });

  it("recomputes when the font changes or the cell first becomes measurable", () => {
    const { sizer, changes, setCell } = setup(null);
    sizer.setViewport(vp());
    sizer.setChrome(chrome);
    setCell(cell);
    sizer.remeasure();
    sizer.claim();
    setCell({ width: 9, height: 18 });
    sizer.remeasure();
    sizer.remeasure(); // same size: nothing more to send
    vi.advanceTimersByTime(150);
    expect(changes).toEqual(["43x39"]);
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
