import { expect, type Page } from "@playwright/test";

/** Home, with its server card showing a session count ("All N sessions"). */
export async function goHome(page: Page, stackUrl: string): Promise<void> {
  await page.goto(`${stackUrl}/#/`);
  await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
}

/** Opens a session from Home: the card's "All N sessions" sheet, then the session's row. */
export async function openSessionRow(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: /^All \d+ sessions/ }).click();
  await page.getByRole("dialog", { name: /^Sessions on / }).getByRole("button", { name: new RegExp(`^${name} \\d+ windows?`) }).first().click();
}
