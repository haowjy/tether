import { expect, type Page } from "@playwright/test";

/** Home, with its server card showing a session count ("All sessions and files"). */
export async function goHome(page: Page, stackUrl: string): Promise<void> {
  await page.goto(`${stackUrl}/#/`);
  await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
}

/** Opens a session from Home on the phone: the card's "All sessions and files" row lands on a tab and opens
 * the half sheet over it, then the session's row. The sheet stays open over the tab until it is closed (Escape). */
export async function openSessionRow(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: /^All sessions and files/ }).click();
  await page.getByRole("dialog", { name: "Open" }).getByRole("button", { name: new RegExp(`^${name} \\d+ windows?`) }).first().click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
