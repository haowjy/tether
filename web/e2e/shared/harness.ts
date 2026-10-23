import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export interface Scenario {
  layout: "phone" | "desktop";
  scheme: "dark" | "light";
  density: "compact" | "touch";
}

export const SIZES = { phone: { width: 393, height: 852 }, desktop: { width: 1280, height: 800 } } as const;

/** Every layout, theme and density: a touch laptop is `desktop` with `touch`, a small window with a mouse is `phone` with `compact`. */
export const SCENARIOS: Scenario[] = (["desktop", "phone"] as const).flatMap((layout) =>
  (["dark", "light"] as const).flatMap((scheme) => (["compact", "touch"] as const).map((density) => ({ layout, scheme, density }))),
);

export const label = (s: Scenario): string => `${s.layout} ${s.scheme} ${s.density}`;

export interface Opened {
  /** Fails the test if the page logged an error or threw. */
  expectNoConsoleErrors(): void;
}

/** Opens a fixture in the harness at the scenario's size, and waits for the app to render. */
export async function openFixture(page: Page, fixture: string, scenario: Scenario, hash = "#/"): Promise<Opened> {
  const errors: string[] = [];
  page.on("console", (msg) => {
    // WebKit reports the viewport meta's `interactive-widget` (client-architecture.md §5.4) as unknown and ignores it: not an app error.
    if (msg.type() === "error" && !/Viewport argument key "interactive-widget"/.test(msg.text())) errors.push(msg.text());
  });
  page.on("pageerror", (err) => { errors.push(err.message); });
  await page.setViewportSize(SIZES[scenario.layout]);
  const query = new URLSearchParams({ fixture, ...scenario });
  await page.goto(`/harness/index.html?${query.toString()}${hash}`);
  await page.waitForFunction(() => document.querySelector("#app")?.childElementCount);
  await page.evaluate(() => document.fonts.ready);
  return { expectNoConsoleErrors: () => { expect(errors).toEqual([]); } };
}

/** axe on the page as it stands: zero violations, including contrast in both themes. */
export async function expectAccessible(page: Page): Promise<void> {
  // axe reads colours as they are now: let entrance animations (a toast fading in) finish first; endless ones (the spinner) never do.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished)));
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join("; ")})`)).toEqual([]);
}

/** Saves a screenshot when W0_EVIDENCE names a directory: Chromium only, in the pointer's natural density. */
export async function shot(page: Page, name: string, scenario: Scenario, project: string): Promise<void> {
  const dir = process.env["W0_EVIDENCE"];
  const natural = scenario.density === (scenario.layout === "phone" ? "touch" : "compact");
  if (dir && natural && project === "chromium") await page.screenshot({ path: `${dir}/${name}--${scenario.layout}-${scenario.scheme}.png` });
}
