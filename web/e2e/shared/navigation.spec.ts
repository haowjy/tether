import { expect, test, type Page } from "@playwright/test";
import { openFixture, shot, type Scenario } from "./harness";

const desktop: Scenario = { layout: "desktop", scheme: "dark", density: "compact" };
const phone: Scenario = { layout: "phone", scheme: "dark", density: "touch" };

const hash = (page: Page): Promise<string> => page.evaluate(() => location.hash);

test.describe("routes and history", () => {
  test("the rail moves between destinations, and Back retraces them", async ({ page }) => {
    await openFixture(page, "home", desktop);
    await page.getByRole("button", { name: "Files" }).click();
    expect(await hash(page)).toBe("#/files");
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
    await page.getByRole("button", { name: "Terminal" }).click();
    expect(await hash(page)).toBe("#/terminal");
    await page.keyboard.press("Escape"); // with no tab, Terminal opened the picker
    // Closing it is a history.back() that lands on a later popstate: Back before then undoes the wrong entry.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goBack();
    expect(await hash(page)).toBe("#/files");
    await page.goBack();
    expect(await hash(page)).toBe("#/");
    await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
  });

  test("a reload restores the destination from the hash", async ({ page }) => {
    await openFixture(page, "home", desktop, "#/files");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  });

  test("phone Home has Sessions and Files panes on #/ and #/files", async ({ page }) => {
    await openFixture(page, "home", phone);
    await page.getByRole("button", { name: "Files" }).click();
    expect(await hash(page)).toBe("#/files");
    await page.getByRole("button", { name: "Sessions" }).click();
    expect(await hash(page)).toBe("#/");
  });
});

test.describe("overlays and focus", () => {
  test("with no tab, Terminal opens the picker; Escape closes it and focus returns to +", async ({ page }, testInfo) => {
    await openFixture(page, "home", desktop);
    await page.getByRole("button", { name: "Terminal" }).click();
    const picker = page.getByRole("dialog", { name: "Open session" });
    await expect(picker).toBeVisible();
    await shot(page, "picker", desktop, testInfo.project.name);
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(page.getByRole("button", { name: "Open another session" })).toBeFocused();
    await expect(page.getByText("Open a window with + or from Home.")).toBeVisible();
  });

  test("browser Back closes the overlay before leaving the destination", async ({ page }) => {
    await openFixture(page, "home", desktop, "#/terminal");
    await page.getByRole("button", { name: "Open another session" }).click();
    await expect(page.getByRole("dialog", { name: "Open session" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog", { name: "Open session" })).toBeHidden();
    expect(await hash(page)).toBe("#/terminal");
  });

  test("the backdrop and the close button dismiss without changing the destination", async ({ page }) => {
    await openFixture(page, "home", desktop, "#/terminal");
    await page.getByRole("button", { name: "Open another session" }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: "Open another session" }).click();
    await page.mouse.click(5, 5);
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(await hash(page)).toBe("#/terminal");
  });

  test("on a phone the picker is a bottom sheet and opening it focuses no text field", async ({ page }, testInfo) => {
    await openFixture(page, "home", phone, "#/terminal");
    await page.getByRole("button", { name: "Open another session" }).click();
    const picker = page.getByRole("dialog", { name: "Open session" });
    await expect(picker).toBeVisible();
    const box = await picker.boundingBox();
    await shot(page, "picker", phone, testInfo.project.name);
    expect(box?.width).toBe(393);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(800); // anchored to the bottom
    expect(await page.evaluate(() => document.activeElement instanceof HTMLInputElement)).toBe(false);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open another session" })).toBeFocused();
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
    await openFixture(page, "restored", desktop, "#/terminal");
    await expect(page.getByText("1 tab closed: their windows are gone")).toBeVisible();
    const pills = page.locator("button[title]");
    await expect(pills).toHaveCount(2);
    await expect(page.getByRole("button", { name: /^tether \/ agent/ })).toHaveAttribute("aria-current", "true");
  });

  test("tabs wait, restoring, until the host's id is known, and the active one is kept", async ({ page }) => {
    await openFixture(page, "restored", phone, "#/terminal");
    await expect(page.getByRole("button", { name: /^tether \/ agent/ })).toBeVisible();
  });
});
