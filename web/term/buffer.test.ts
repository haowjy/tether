import { Terminal } from "@xterm/headless";
import { describe, expect, it } from "vitest";
import { bufferText } from "./buffer";

/** A real xterm buffer: `isWrapped` comes from the parser, as it does for the app. */
async function written(cols: number, data: string): Promise<Terminal> {
  const term = new Terminal({ cols, rows: 10, allowProposedApi: true });
  await new Promise<void>((resolve) => { term.write(data, resolve); });
  return term;
}
const text = (term: Terminal, from = 0, to = term.buffer.active.length): string => bufferText(term.buffer.active, { from, to });

describe("bufferText", () => {
  it("joins a soft wrap with no newline", async () => {
    const term = await written(10, "0123456789abcdefghij12345\r\nnext");
    expect(term.buffer.active.getLine(1)?.isWrapped).toBe(true);
    expect(text(term, 0, 4)).toBe("0123456789abcdefghij12345\nnext");
  });

  it("keeps a hard break at the exact last column", async () => {
    const term = await written(10, "0123456789\r\nabc");
    expect(term.buffer.active.getLine(1)?.isWrapped).toBe(false);
    expect(text(term, 0, 2)).toBe("0123456789\nabc");
  });

  it("keeps blank lines and drops trailing blanks only at a line's end", async () => {
    const term = await written(10, "one  \r\n\r\n\r\ntwo");
    expect(text(term, 0, 4)).toBe("one\n\n\ntwo");
  });

  it("keeps indentation and the space a wrap splits at", async () => {
    const term = await written(10, "    indented\r\n  x y z");
    // "    indent" wraps into "ed"; the leading blanks survive, the row's trailing blanks do not.
    expect(text(term, 0, 3)).toBe("    indented\n  x y z");
    const split = await written(5, "ab cd ef");
    expect(text(split, 0, 2)).toBe("ab cd ef");
  });

  it("copies only the rows asked for, and stops at the buffer's end", async () => {
    const term = await written(10, "one\r\ntwo\r\nthree");
    expect(text(term, 1, 3)).toBe("two\nthree");
    expect(text(term, 2, 99)).toBe(["three", ...Array<string>(7).fill("")].join("\n"));
  });
});
