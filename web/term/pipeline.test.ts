import { Terminal } from "@xterm/headless";
import { describe, expect, it } from "vitest";
import { WritePipeline } from "./pipeline";

const enc = new TextEncoder();
const row = (t: Terminal): string => t.buffer.active.getLine(0)?.translateToString(true) ?? "";

// Restore "ABC", cursor home. Like the daemon's restore, it only switches on modes that were on.
const restore = enc.encode("ABC\x1b[1;1H");
const snapshot = { cols: 20, rows: 5, restore };

describe("WritePipeline (review p17 #1)", () => {
  it("naive reset/resize/write keeps queued pre-snapshot modes: XABC", async () => {
    const t = new Terminal({ cols: 20, rows: 5, allowProposedApi: true });
    t.write(enc.encode("\x1b[4h")); // old output, still queued
    t.reset();
    t.resize(20, 5);
    t.write(restore);
    await new Promise<void>((r) => { t.write(enc.encode("X"), r); });
    expect(row(t)).toBe("XABC");
  });

  it("applies the snapshot only after earlier writes parsed: XBC", async () => {
    const t = new Terminal({ cols: 20, rows: 5, allowProposedApi: true });
    const p = new WritePipeline(t);
    p.output(enc.encode("\x1b[4h")); // stale insert mode, queued before the snapshot
    const restored = p.snapshot(snapshot);
    p.output(enc.encode("X")); // later output queues behind the snapshot
    await restored;
    await new Promise<void>((r) => { t.write("", r); });
    expect(row(t)).toBe("XBC");
  });

  it("applies back-to-back snapshots in order, with output between them", async () => {
    const t = new Terminal({ cols: 20, rows: 5, allowProposedApi: true });
    const p = new WritePipeline(t);
    void p.snapshot({ cols: 20, rows: 5, restore: enc.encode("one") });
    p.output(enc.encode("1"));
    await p.snapshot({ cols: 10, rows: 3, restore: enc.encode("two") });
    await new Promise<void>((r) => { t.write("", r); });
    expect(row(t)).toBe("two");
    expect(t.cols).toBe(10);
  });
});
