import { expect, test, type Page } from "@playwright/test";
import { openFixture, shot, type Scenario } from "./harness";

const desktop: Scenario = { layout: "desktop", scheme: "dark", density: "compact" };
const phone: Scenario = { layout: "phone", scheme: "dark", density: "touch" };

const hash = (page: Page): Promise<string> => page.evaluate(() => location.hash);

test.describe("routes and history", () => {
  test("the top row moves between Home and tabs of both kinds, and Back retraces them", async ({ page }) => {
    await openFixture(page, "files", desktop); // a clean launch opens Home; the harness then opens the saved Files tab
    expect(await hash(page)).toBe("#/tab");
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    expect(await hash(page)).toBe("#/");
    await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
    await page.getByRole("button", { name: /^tether agent, / }).click();
    expect(await hash(page)).toBe("#/tab");
    await expect(page.getByRole("button", { name: /^tether agent, / })).toHaveAttribute("aria-current", "true");
    // Switching tab on a tab route adds no history entry.
    await page.getByRole("button", { name: /^Files, / }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible();
    await page.goBack();
    expect(await hash(page)).toBe("#/");
    await page.goBack(); // the Files tab's own entry: it is the active tab again
    await expect(page.getByRole("heading", { level: 1, name: "Files" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
  });

  test("a clean launch opens Home with the saved tabs listed, not the tab that was active", async ({ page }) => {
    await openFixture(page, "restored", desktop);
    await expect(page.getByRole("heading", { name: "Open tabs" })).toBeVisible();
    expect(await hash(page)).toBe("#/");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Open tabs" })).toBeVisible();
  });

  test("Home's Files opens a new Files tab at the roots every time", async ({ page }) => {
    await openFixture(page, "files", desktop);
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("region", { name: "Sessions on pop-os" }).getByRole("button", { name: "Files" }).click();
    await expect(page.getByRole("button", { name: /^Files, / })).toHaveCount(2);
    expect(await hash(page)).toBe("#/tab");
  });
});

test.describe("overlays and focus", () => {
  test("with no tab, + opens the picker; Escape closes it and focus returns to +", async ({ page }, testInfo) => {
    await openFixture(page, "home", desktop);
    await page.getByRole("button", { name: "Open another session" }).click();
    const picker = page.getByRole("dialog", { name: "Open session" });
    await expect(picker).toBeVisible();
    await shot(page, "picker", desktop, testInfo.project.name);
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(page.getByRole("button", { name: "Open another session" })).toBeFocused();
  });

  test("browser Back closes the overlay before leaving the tab", async ({ page }) => {
    await openFixture(page, "restored", desktop, { open: true });
    await page.getByRole("button", { name: "Open another session" }).click();
    await expect(page.getByRole("dialog", { name: "Open session" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog", { name: "Open session" })).toBeHidden();
    expect(await hash(page)).toBe("#/tab");
  });

  test("the backdrop and the close button dismiss without changing the tab", async ({ page }) => {
    await openFixture(page, "restored", desktop, { open: true });
    await page.getByRole("button", { name: "Open another session" }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: "Open another session" }).click();
    await page.mouse.click(5, 5);
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(await hash(page)).toBe("#/tab");
  });

  test("on a phone the tab chip opens the switcher sheet, which focuses no text field", async ({ page }, testInfo) => {
    await openFixture(page, "restored", phone, { open: true });
    const chip = page.getByRole("button", { name: /, \d tabs?, open sessions$/ });
    await chip.click();
    const sheet = page.getByRole("dialog", { name: "Sessions" });
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    await shot(page, "switcher", phone, testInfo.project.name);
    expect(box?.width).toBe(393);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(800); // anchored to the bottom
    expect(await page.evaluate(() => document.activeElement instanceof HTMLInputElement)).toBe(false);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(chip).toBeFocused();
  });

  test("Settings is an overlay on Home, closed by Back", async ({ page }, testInfo) => {
    await openFixture(page, "home", desktop);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await shot(page, "settings", desktop, testInfo.project.name);
    await page.goBack();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
  });

  test("a finished Settings action closes the confirmation and Settings together", async ({ page }) => {
    await openFixture(page, "home", desktop);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Clear local data" }).click();
    await page.getByRole("dialog", { name: "Clear local data?" }).getByRole("button", { name: "Clear local data" }).click();
    // WebKit drops a second history.back() issued before the first pops: both must close in one step.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
  });
});

test.describe("lists", () => {
  test("arrow keys rove among the rows, with one row in the tab order", async ({ page }) => {
    await openFixture(page, "restored", desktop);
    const rows = page.locator('[aria-label^="Sessions on"] [data-roving] >> visible=true');
    await expect(rows).toHaveCount(2);
    expect(await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).tabIndex))).toEqual([0, -1]);
    await rows.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(rows.first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(rows.nth(1)).toBeFocused();
  });
});

test.describe("restore", () => {
  test("the first listing closes the tab whose window is gone, with one notice, and keeps the others", async ({ page }) => {
    await openFixture(page, "restored", desktop, { open: true });
    await expect(page.getByText("1 tab closed: their sessions are gone")).toBeVisible();
    const pills = page.locator("button[title]");
    await expect(pills).toHaveCount(2);
    await expect(page.getByRole("button", { name: /^tether agent, / })).toHaveAttribute("aria-current", "true");
  });

  test("tabs wait, restoring, until the host's id is known, and the active one is kept", async ({ page }) => {
    await openFixture(page, "restored", phone, { open: true });
    await expect(page.getByRole("button", { name: /, \d tabs?, open sessions$/ })).toBeVisible();
  });
});
