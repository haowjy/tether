import { describe, expect, it } from "vitest";
import { locateRun } from "./anchor";

describe("locateRun", () => {
  it("finds the run where it was expected", () => {
    expect(locateRun(["a", "b", "c", "d", "e"], ["d", "e"], 3)).toBe(3);
  });

  it("finds it moved: the numbering shifted by k rows", () => {
    expect(locateRun(["a", "b", "c", "d", "e"], ["c", "d"], 3)).toBe(2);
  });

  it("takes the match nearest the expected place when a row repeats", () => {
    const rows = ["", "", "", "", "x", "", ""];
    expect(locateRun(rows, ["", ""], 5)).toBe(5);
    expect(locateRun(rows, ["", ""], 1)).toBe(1);
  });

  it("takes the older of two equally near matches", () => {
    expect(locateRun(["", "", "", ""], [""], 1.5)).toBe(1);
  });

  it("is null when the run is not there", () => {
    expect(locateRun(["a", "b"], ["z"], 0)).toBeNull();
    expect(locateRun(["a"], ["a", "b"], 0)).toBeNull();
  });
});
