import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeFrame } from "./frames";

// The daemon's encoder emits these (tests/fixtures/proto/frames.json); both sides decode them.
interface Golden { kind: "output" | "snapshot"; watch: number; cols?: number; rows?: number; bytes?: string; restore?: string; frame: string }
const golden = JSON.parse(readFileSync(new URL("../../tests/fixtures/proto/frames.json", import.meta.url), "utf8")) as Golden[];

const bytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

describe("decodeFrame", () => {
  it.each(golden)("decodes the shared $kind fixture for watch $watch", (g) => {
    const f = decodeFrame(bytes(g.frame).buffer as ArrayBuffer);
    expect(f).toEqual(
      g.kind === "output"
        ? { kind: "output", watch: g.watch, bytes: bytes(g.bytes ?? "") }
        : { kind: "snapshot", watch: g.watch, cols: g.cols, rows: g.rows, restore: bytes(g.restore ?? "") },
    );
  });

  it("rejects short frames and unknown kinds", () => {
    expect(() => decodeFrame(bytes("0200000001").buffer as ArrayBuffer)).toThrow();
    expect(() => decodeFrame(bytes("0900000001").buffer as ArrayBuffer)).toThrow();
  });
});
