import { describe, expect, it } from "vitest";
import { BUDGETS, budgetBreaches, findColourPrimitiveUses, findCopyViolations } from "./checks.mjs";

describe("copy rule", () => {
  it("fails on a middle dot, a bullet and a dot marker", () => {
    expect(findCopyViolations("a · b")).toHaveLength(1);
    expect(findCopyViolations("ok\n• item")).toHaveLength(1);
    expect(findCopyViolations("status ● live")).toHaveLength(1);
  });
  it("passes plain copy", () => {
    expect(findCopyViolations("tether / agent, 2 windows. Checking access…")).toEqual([]);
  });
});

describe("colour tokens", () => {
  it("fails on a colour scale read outside semantic.css", () => {
    expect(findColourPrimitiveUses("ui/primitives/Button.module.css", "color: var(--gray-5);")).toHaveLength(1);
    expect(findColourPrimitiveUses("screens/home/Home.module.css", "background: var( --blue-9 );")).toHaveLength(1);
  });
  it("passes semantic.css, and scales that aren't colour", () => {
    expect(findColourPrimitiveUses("ui/tokens/semantic.css", "--color-bg: var(--gray-12);")).toEqual([]);
    expect(findColourPrimitiveUses("screens/home/Home.module.css", "gap: var(--space-3); color: var(--color-text);")).toEqual([]);
  });
});

describe("budgets", () => {
  const entry = { file: "assets/index.js", isEntry: true, imports: ["_vendor"], css: ["assets/index.css"] };
  const manifest = { "index.html": entry, _vendor: { file: "assets/vendor.js" } };
  const file = (path: string, gz: number) => ({ path, bytes: gz, gz });
  const ok = [file("assets/index.js", 50_000), file("assets/vendor.js", 100_000), file("assets/index.css", 6_000)];

  it("passes a build within budget", () => {
    expect(budgetBreaches(ok, manifest)).toEqual([]);
  });
  it("fails initial JS over 190 KB, counting static imports", () => {
    const over = [file("assets/index.js", 50_000), file("assets/vendor.js", BUDGETS.initialJs), file("assets/index.css", 1)];
    expect(budgetBreaches(over, manifest).join()).toContain("initial JS");
  });
  it("fails initial CSS over 15 KB", () => {
    expect(budgetBreaches([...ok.slice(0, 2), file("assets/index.css", BUDGETS.initialCss + 1)], manifest).join()).toContain("initial CSS");
  });
  it("fails a terminal font over 120 KB and the symbols over 150 KB", () => {
    expect(budgetBreaches([...ok, file("assets/tether-mono-bold-x.woff2", BUDGETS.terminalFont + 1)], manifest).join()).toContain("tether-mono-bold");
    expect(budgetBreaches([...ok, file("assets/tether-symbols-x.woff2", BUDGETS.symbolsFont + 1)], manifest).join()).toContain("tether-symbols");
  });
  it("counts every file, stubs included", () => {
    const many = [...ok, ...Array.from({ length: BUDGETS.shellFiles }, (_, i) => file(`assets/stub-${String(i)}.js`, 44))];
    expect(budgetBreaches(many, manifest).join()).toContain("files");
  });
  it("fails a shell over 1.5 MiB", () => {
    expect(budgetBreaches([...ok, file("assets/big.js", BUDGETS.shell)], manifest).join()).toContain("the shell is");
  });
});
