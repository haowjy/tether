import { describe, expect, it } from "vitest";
import { cellsOf, cssColor, historyRows, parseSgrRow, pushRun, rowText, styleCss } from "./rows";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("parseSgrRow", () => {
  it("splits runs where the style changes and keeps the text", () => {
    const runs = parseSgrRow(bytes("plain \x1b[1;31mred bold\x1b[0m done"));
    expect(runs.map((r) => r.text)).toEqual(["plain ", "red bold", " done"]);
    expect(runs[1]?.style).toEqual({ bold: true, fg: 1 });
    expect(runs[2]?.style).toEqual({});
  });

  it("reads 256-colour, 24-bit and bright colours", () => {
    const runs = parseSgrRow(bytes("\x1b[38;5;202ma\x1b[48;2;1;2;3mb\x1b[93mc"));
    expect(runs.map((r) => r.style)).toEqual([{ fg: 202 }, { fg: 202, bg: "#010203" }, { fg: 11, bg: "#010203" }]);
  });

  it("drops escapes that are not colour and keeps wide text whole", () => {
    expect(rowText({ runs: parseSgrRow(bytes("a\x1b[2Kb 日本 \x1b[m")), wrapped: false })).toBe("ab 日本 ");
  });
});

describe("colours", () => {
  const theme = { red: "#c00", brightRed: "#f00", foreground: "#ddd", background: "#111" };
  it("takes the first sixteen from the theme and computes the rest", () => {
    expect(cssColor(1, theme)).toBe("#c00");
    expect(cssColor(9, theme)).toBe("#f00");
    expect(cssColor(16, theme)).toBe("#000000");
    expect(cssColor(231, theme)).toBe("#ffffff");
    expect(cssColor(232, theme)).toBe("#080808");
  });
  it("inverse swaps, falling back to the theme's defaults", () => {
    expect(styleCss({ inverse: true }, theme)).toBe("color:#111;background:#ddd");
    expect(styleCss({ fg: 1, bold: true }, theme)).toBe("color:#c00;font-weight:bold");
  });
});

describe("pushRun", () => {
  it("merges adjacent runs of one style", () => {
    const line: ReturnType<typeof parseSgrRow> = [];
    pushRun(line, "a", {});
    pushRun(line, "b", {});
    pushRun(line, "", { bold: true });
    expect(line).toEqual([{ text: "ab", style: {} }]);
  });
});

describe("historyRows", () => {
  it("marks the row after a continuing one as wrapped, and keeps the blanks only where the line goes on", () => {
    const rows = historyRows([
      { bytes: bytes("long line "), continues: true },
      { bytes: bytes("tail   "), continues: false },
      { bytes: bytes("next   "), continues: false },
    ]);
    expect(rows.map((r) => [rowText(r), r.wrapped])).toEqual([["long line ", false], ["tail", true], ["next", false]]);
  });
});

describe("cellsOf", () => {
  it("gives a wide character two cells and anything else one", () => {
    expect(cellsOf("a日b")).toEqual(["a", "日", "", "b"]);
    expect(cellsOf("e\u0301x")).toEqual(["e\u0301", "x"]);
  });
  it("gives emoji presentation two cells, and © ™ ✔ one, as xterm does", () => {
    expect(cellsOf("😀")).toEqual(["😀", ""]);
    expect(cellsOf("©™✔")).toEqual(["©", "™", "✔"]);
  });
});
