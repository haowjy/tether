import { describe, expect, it } from "vitest";
import { restingMode } from "./focus";

describe("restingMode", () => {
  it("rests in terminal or hidden on Terminal with no overlay", () => {
    expect(restingMode("terminal", false, true)).toBe("terminal");
    expect(restingMode("terminal", false, false)).toBe("hidden");
  });
  it("lets web fields take the keyboard everywhere else", () => {
    expect(restingMode("terminal", true, true)).toBe("webText");
    expect(restingMode("home", false, false)).toBe("webText");
    expect(restingMode("files", false, true)).toBe("webText");
  });
});
