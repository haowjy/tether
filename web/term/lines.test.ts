import { Terminal } from "@xterm/headless";
import { describe, expect, it } from "vitest";
import { logicalLines, selectedText } from "../touch/selection";
import { bufferRows } from "./lines";
import { rowText } from "./rows";

/** A real xterm buffer: `isWrapped` comes from the parser, as it does for the app. */
async function copied(cols: number, data: string, rows = 10): Promise<string> {
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  await new Promise<void>((resolve) => { term.write(data, resolve); });
  const { rows: all } = bufferRows(term.buffer.active, 0);
  const logical = logicalLines(all.map((row) => ({ text: rowText(row), wrapped: row.wrapped })));
  const last = logical.lines.length - 1;
  return selectedText(logical.lines, { line: 0, offset: 0 }, { line: last, offset: logical.lines[last]?.length ?? 0 });
}

describe("copying a real buffer", () => {
  it("joins a soft wrap with no newline", async () => {
    expect((await copied(10, "0123456789abcdefghij12345\r\nnext", 4)).trimEnd()).toBe("0123456789abcdefghij12345\nnext");
  });

  it("keeps a hard break at the exact last column", async () => {
    expect((await copied(10, "0123456789\r\nabc", 2))).toBe("0123456789\nabc");
  });

  it("keeps blank lines and drops trailing blanks only at a line's end", async () => {
    expect((await copied(10, "one  \r\n\r\n\r\ntwo", 4))).toBe("one\n\n\ntwo");
  });

  it("keeps indentation and the space a wrap splits at", async () => {
    expect((await copied(10, "    indented\r\n  x y z", 3))).toBe("    indented\n  x y z");
    expect((await copied(5, "ab cd ef", 2))).toBe("ab cd ef");
  });
});

describe("a buffer row's cells", () => {
  it("come from the terminal's own widths: a wide character is followed by an empty cell, © takes one", async () => {
    const term = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    await new Promise<void>((resolve) => { term.write("© 日本x", resolve); });
    const [row] = bufferRows(term.buffer.active, 0).rows;
    expect(row?.cells?.slice(0, 8)).toEqual(["©", " ", "日", "", "本", "", "x", " "]);
  });
});
