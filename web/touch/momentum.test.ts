import { describe, expect, it } from "vitest";
import { Momentum } from "./momentum";

describe("Momentum", () => {
  it("coasts about velocity times the time constant", () => {
    const m = new Momentum(2000);
    let total = 0;
    while (!m.done) total += m.step(16);
    expect(total).toBeGreaterThan(900);
    expect(total).toBeLessThan(1010);
  });

  it("covers the same distance however the time is cut into frames", () => {
    const a = new Momentum(1500);
    const b = new Momentum(1500);
    expect(a.step(100)).toBeCloseTo(b.step(50) + b.step(50), 6);
  });

  it("keeps the sign and slows monotonically", () => {
    const m = new Momentum(-1000);
    const first = m.step(16);
    const second = m.step(16);
    expect(first).toBeLessThan(0);
    expect(Math.abs(second)).toBeLessThan(Math.abs(first));
  });

  it("starts at rest below the threshold and clamps an absurd flick", () => {
    expect(new Momentum(10).done).toBe(true);
    expect(new Momentum(10).step(16)).toBe(0);
    expect(Math.abs(new Momentum(1e9).step(1000))).toBeLessThan(4100);
  });
});
