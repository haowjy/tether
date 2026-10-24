import { describe, expect, it } from "vitest";
import { budgetStart, charsAcross, logicalLines, pointOf, selectedText, wordAt } from "./selection";

const cells = (s: string): string[] => s.split("");

describe("wordAt", () => {
  it("selects the run of non-separators around the cell", () => {
    expect(wordAt(cells("ls -la /usr/bin"), 8)).toEqual({ from: 7, to: 15 });
    expect(wordAt(cells("ls -la /usr/bin"), 0)).toEqual({ from: 0, to: 2 });
  });
  it("stops at brackets and quotes like xterm", () => {
    expect(wordAt(cells("f(arg1, 'b')"), 3)).toEqual({ from: 2, to: 6 });
    expect(wordAt(cells("f(arg1, 'b')"), 1)).toEqual({ from: 1, to: 2 });
  });
  it("is null over a blank cell or past the row", () => {
    expect(wordAt(cells("a  b"), 1)).toBeNull();
    expect(wordAt(cells("ab"), 5)).toBeNull();
  });
  it("counts a wide character once and maps columns to text offsets", () => {
    const row = ["x", " ", "日", "", "本", "", "y"];
    expect(wordAt(row, 3)).toEqual({ from: 2, to: 5 });
    expect(wordAt(row, 6)).toEqual({ from: 2, to: 5 });
  });
});

describe("selectedText", () => {
  const lines = ["    indented line", "", "a long command that wrapped across rows   ", "last"];
  it("keeps indentation and blank lines and joins nothing but logical lines", () => {
    expect(selectedText(lines, { line: 0, offset: 0 }, { line: 3, offset: 4 })).toBe("    indented line\n\na long command that wrapped across rows\nlast");
  });
  it("copies a partial selection from its endpoints only", () => {
    expect(selectedText(lines, { line: 0, offset: 4 }, { line: 0, offset: 12 })).toBe("indented");
    expect(selectedText(lines, { line: 2, offset: 2 }, { line: 3, offset: 2 })).toBe("long command that wrapped across rows\nla");
  });
  it("drops trailing blanks only where the line's end is part of the copy", () => {
    expect(selectedText(lines, { line: 2, offset: 0 }, { line: 2, offset: 6 })).toBe("a long");
    expect(selectedText(["ab   "], { line: 0, offset: 0 }, { line: 0, offset: 4 })).toBe("ab  ");
  });
});

describe("budgetStart", () => {
  it("keeps everything under the budget", () => {
    expect(budgetStart(Array.from({ length: 10 }, () => ({ rows: 1, bytes: 10 })), 24)).toBe(0);
  });
  it("drops the oldest lines past 2000 rows above the visible ones", () => {
    const sizes = Array.from({ length: 3000 }, () => ({ rows: 1, bytes: 10 }));
    expect(budgetStart(sizes, 24)).toBe(3000 - 2024);
  });
  it("drops by bytes too", () => {
    const sizes = Array.from({ length: 100 }, () => ({ rows: 1, bytes: 10_000 }));
    const start = budgetStart(sizes, 24);
    expect(100 - start).toBeLessThanOrEqual(52);
    expect(start).toBeGreaterThan(0);
  });
});

describe("logical lines", () => {
  const rows = [
    { text: "docker run --name x ", wrapped: false },
    { text: "--rm image", wrapped: true },
    { text: "", wrapped: false },
    { text: "next", wrapped: false },
  ];
  const logical = logicalLines(rows);
  it("joins rows at soft wraps and keeps blank rows as lines", () => {
    expect(logical.lines).toEqual(["docker run --name x --rm image", "", "next"]);
  });
  it("copies a soft-wrapped command without a newline, from a point on the second row", () => {
    const from = pointOf(logical, 0, 11);
    const to = pointOf(logical, 1, 4);
    expect(to).toEqual({ line: 0, offset: 24 });
    expect(selectedText(logical.lines, from, to)).toBe("--name x --rm");
    expect(selectedText(logical.lines, pointOf(logical, 0, 0), pointOf(logical, 3, 4))).toBe("docker run --name x --rm image\n\nnext");
  });
});

describe("charsAcross", () => {
  it("counts characters, not cells, so wide and combining text moves the cursor right", () => {
    expect(charsAcross("ab日本", 4, "end")).toBe(2);
    expect(charsAcross("ab日本", 3, "end")).toBe(2); // lands inside 日: crossed whole
    expect(charsAcross("e\u0301x", 2, "end")).toBe(2);
    expect(charsAcross("日本cd", 4, "start")).toBe(2);
    expect(charsAcross("日本cd", 3, "start")).toBe(2); // the move stops inside 本: it crosses too
    expect(charsAcross("ab", 9, "start")).toBe(2);
  });
});
