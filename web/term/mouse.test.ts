import { describe, expect, it } from "vitest";
import { mouseInput, mouseReport } from "./mouse";

const text = (b: Uint8Array | null): string | null => (b === null ? null : String.fromCharCode(...b));

describe("mouseReport", () => {
  it("SGR press and release name the one-based cell, release ending in m", () => {
    expect(text(mouseReport("press", 4, 9, "sgr"))).toBe("\x1b[<0;5;10M");
    expect(text(mouseReport("release", 4, 9, "sgr"))).toBe("\x1b[<0;5;10m");
  });

  it("SGR wheel is buttons 64 and 65", () => {
    expect(text(mouseReport("wheelUp", 0, 0, "sgr"))).toBe("\x1b[<64;1;1M");
    expect(text(mouseReport("wheelDown", 0, 0, "sgr"))).toBe("\x1b[<65;1;1M");
  });

  it("the classic format adds 32 and releases as button 3", () => {
    expect([...(mouseReport("press", 0, 0, "x10") ?? [])]).toEqual([0x1b, 0x5b, 0x4d, 32, 33, 33]);
    expect([...(mouseReport("release", 1, 2, "x10") ?? [])]).toEqual([0x1b, 0x5b, 0x4d, 35, 34, 35]);
  });

  it("the classic format cannot reach past column 223, the UTF-8 one can", () => {
    expect(mouseReport("press", 223, 0, "x10")).toBeNull();
    expect(mouseReport("press", 222, 0, "x10")).not.toBeNull();
    expect(mouseReport("press", 300, 0, "utf8")).not.toBeNull();
  });
});

describe("mouseInput", () => {
  const decode = (events: { bytes: string }[] | null): string[] | null => events && events.map((e) => atob(e.bytes));
  it("a tap is a press and a release, a press alone in X10 mode, and nothing without a mouse mode", () => {
    expect(decode(mouseInput("tap", 0, 0, "vt200", "sgr"))).toEqual(["\x1b[<0;1;1M", "\x1b[<0;1;1m"]);
    expect(decode(mouseInput("tap", 0, 0, "x10", "sgr"))).toEqual(["\x1b[<0;1;1M"]);
    expect(mouseInput("tap", 0, 0, "none", "sgr")).toBeNull();
  });
  it("a wheel is one report, and the caller falls back to arrows in X10 mode or past the encoding's reach", () => {
    expect(decode(mouseInput("wheelUp", 1, 2, "any", "sgr"))).toEqual(["\x1b[<64;2;3M"]);
    expect(mouseInput("wheelUp", 1, 2, "x10", "sgr")).toBeNull();
    expect(mouseInput("tap", 300, 0, "vt200", "x10")).toBeNull();
  });
});
