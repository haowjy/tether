import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chip, CompleteRequest, Completion } from "../proto/generated/messages";
import { Suggester, type CompleteFn } from "./suggest";

const chip = (insert: string): Chip => ({ label: insert.trim(), insert, source: "carapace" });
const line = (before: string, after = ""): CompleteRequest => ({ before, after, cwd: "/home/j" });

/** A completer whose answers the test gives, one per request, in any order. */
function setup() {
  const asked: { request: CompleteRequest; signal: AbortSignal; answer(chips: Chip[]): void }[] = [];
  const complete: CompleteFn = (request, signal) =>
    new Promise<Completion>((resolve) => { asked.push({ request, signal, answer: (chips) => { resolve({ chips }); } }); });
  const shown: (string[] | null)[] = [];
  const suggester = new Suggester((chips) => shown.push(chips ? chips.map((c) => c.insert) : null));
  /** The line changes and its answer arrives. */
  const answered = async (request: CompleteRequest, chips: Chip[]): Promise<void> => {
    suggester.set(request, complete);
    vi.advanceTimersByTime(100);
    asked.at(-1)?.answer(chips);
    await vi.runAllTimersAsync();
  };
  return { suggester, complete, asked, shown, answered, last: () => shown.at(-1) };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("Suggester", () => {
  it("asks once the line rests, and keeps only the chips that still extend a typed prefix, cut by it", async () => {
    const t = setup();
    t.suggester.set(line("git c"), t.complete);
    vi.advanceTimersByTime(99);
    expect(t.asked).toHaveLength(0);
    await t.answered(line("git c"), [chip("heckout "), chip("herry-pick "), chip("lone "), chip("h")]);
    expect(t.last()).toEqual(["heckout ", "herry-pick ", "lone ", "h"]);

    // Narrowed at once, before any answer: "h" is used up, so typing it completely drops it.
    t.suggester.set(line("git ch"), t.complete);
    expect(t.last()).toEqual(["eckout ", "erry-pick "]);
    t.suggester.set(line("git che"), t.complete);
    expect(t.last()).toEqual(["ckout ", "rry-pick "]);
    t.suggester.set(line("git chx"), t.complete);
    expect(t.last()).toEqual([]);
  });

  it("drops every chip when the line changes other than by typing at the cursor", async () => {
    const t = setup();
    await t.answered(line("ls "), [chip("src/")]);
    t.suggester.set(line("ls", " "), t.complete); // the cursor moved
    expect(t.last()).toEqual([]);
    await t.answered(line("ls "), [chip("src/")]);
    t.suggester.set({ ...line("ls "), cwd: "/tmp" }, t.complete);
    expect(t.last()).toEqual([]);
  });

  it("narrows by a tapped chip's own text, and not again when the line then shows it", async () => {
    const t = setup();
    await t.answered(line("cd "), [chip("src/"), chip("src/lib/"), chip("docs/")]);
    t.suggester.tapped(chip("src/"));
    expect(t.last()).toEqual(["lib/"]);
    t.suggester.set(line("cd src/"), t.complete);
    expect(t.last()).toEqual(["lib/"]);
  });

  it("drops an answer for a line already left, and aborts its request", async () => {
    const t = setup();
    t.suggester.set(line("git c"), t.complete);
    vi.advanceTimersByTime(100);
    const stale = t.asked[0];
    t.suggester.set(line("git ch"), t.complete);
    expect(stale?.signal.aborted).toBe(true);
    vi.advanceTimersByTime(100);
    t.asked[1]?.answer([chip("eckout ")]);
    await vi.runAllTimersAsync();
    stale?.answer([chip("lone ")]);
    await vi.runAllTimersAsync();
    expect(t.last()).toEqual(["eckout "]);
    expect(t.shown.flat()).not.toContain("lone ");
  });

  it("hides the strip when there is no line, or the answer fails", async () => {
    const t = setup();
    await t.answered(line("git c"), [chip("lone ")]);
    t.suggester.set(null, null);
    expect(t.last()).toBeNull();
    t.suggester.set(line("x"), () => Promise.reject(new Error("busy")));
    await vi.runAllTimersAsync();
    expect(t.last()).toBeNull();
  });
});
