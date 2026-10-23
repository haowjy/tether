import { expect, test, type Locator, type Page } from "@playwright/test";
import { openFixture, type Scenario } from "../shared/harness";

// Home and the session picker with the keyboard alone: Tab, the arrow keys, Enter and Escape,
// never a click or a tap. A fine pointer's desktop layout, in both browsers.
const desktop: Scenario = { layout: "desktop", scheme: "dark", density: "compact" };

/** Safari leaves buttons out of Tab unless Option is held (its default setting): Playwright's WebKit does the same. */
const tab = (page: Page, browser: string, shift = false): Promise<void> =>
  page.keyboard.press(`${browser === "webkit" ? "Alt+" : ""}${shift ? "Shift+" : ""}Tab`);

/** Tabs forward until `target` has focus; fails if it is not in the tab order. */
async function tabTo(page: Page, browser: string, target: Locator, max = 40): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await tab(page, browser);
  }
  await expect(target).toBeFocused();
}

const session = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name} \\d+ windows?`) });

test.describe("keyboard only", () => {
  test("Home: search, the sessions list, expansion and opening a window", async ({ page, browserName }) => {
    await openFixture(page, "home", desktop);
    await expect(page.getByRole("heading", { name: "On pop-os" })).toBeVisible();

    // Search narrows the list as it is typed, and clearing it brings the rest back.
    const search = page.getByRole("searchbox", { name: "Find a session" });
    await tabTo(page, browserName, search);
    await page.keyboard.type("note");
    await expect(session(page, "notes")).toBeVisible();
    await expect(session(page, "tether")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await expect(session(page, "tether")).toBeVisible();

    // One session row is in the tab order; the arrows move among the rows.
    await tabTo(page, browserName, session(page, "tether"));
    await page.keyboard.press("ArrowDown");
    await expect(session(page, "notes")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(session(page, "tether")).toBeFocused();

    // Enter expands; the windows join the arrow order; Enter on one opens its tab.
    await page.keyboard.press("Enter");
    await expect(session(page, "tether")).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("button", { name: "0: agent" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("button", { name: "1: shell" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/terminal");
    await expect(page.getByRole("button", { name: /^tether \/ shell, / })).toBeVisible();
  });

  test("the picker: opens from the keyboard, traps focus, and Escape returns focus to +", async ({ page, browserName }) => {
    // The terminal's input keeps Tab for the shell, so the way in is the rail: with no tab open, Terminal opens the picker.
    await openFixture(page, "home", desktop);
    await tabTo(page, browserName, page.getByRole("button", { name: "Terminal" }));
    await page.keyboard.press("Enter");
    const plus = page.getByRole("button", { name: "Open another session" });
    const picker = page.getByRole("dialog", { name: "Open session" });
    await expect(picker).toBeVisible();
    // A fine pointer starts in the search.
    await expect(picker.getByRole("searchbox", { name: "Find a session" })).toBeFocused();

    // Tab never reaches the page behind the dialog: focus is inside it, or out in the browser's own chrome (body).
    const contained = (): Promise<boolean> => picker.evaluate((el) => document.activeElement === document.body || el.contains(document.activeElement));
    for (let i = 0; i < 12; i++) {
      await tab(page, browserName);
      expect(await contained()).toBe(true);
    }
    await tab(page, browserName, true);
    expect(await contained()).toBe(true);

    // Into the list, expand, pick the first window: the dialog closes and Terminal shows the tab.
    await picker.getByRole("searchbox").focus();
    await tab(page, browserName);
    await expect(picker.getByRole("button", { name: /^tether \d+ windows?/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await expect(picker.getByRole("button", { name: "0: agent" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(plus).toBeFocused();
    expect(await page.evaluate(() => location.hash)).toBe("#/terminal");

    // Opened again, Enter on a window opens its tab.
    await page.keyboard.press("Enter");
    await expect(picker).toBeVisible();
    await tab(page, browserName);
    // The session stayed expanded from the first open: the arrow goes straight to its first window.
    await page.keyboard.press("ArrowDown");
    await expect(picker.getByRole("button", { name: "0: agent" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(picker).toBeHidden();
    await expect(page.getByRole("button", { name: /^tether \/ agent, / })).toBeVisible();
  });

  test("a focused terminal is left with Ctrl+Shift+F, which moves focus to the tab strip", async ({ page }) => {
    await openFixture(page, "restored", desktop, "#/terminal");
    const active = page.getByRole("button", { name: /^tether \/ agent, / });
    await expect(active).toBeVisible();
    // The terminal's own input holds focus on arrival.
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("xterm-helper-textarea"))).toBe(true);
    await page.keyboard.press("Control+Shift+F");
    await expect(active).toBeFocused();
    // The chord is not typed into the shell.
    const typed = await page.evaluate(() => window.__harness?.platform.links.flatMap((l) => l.sent).filter((m) => m.type === "input").length);
    expect(typed).toBe(0);
    // Enter on the tab returns to the terminal.
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("xterm-helper-textarea"))).toBe(true);
  });
});
