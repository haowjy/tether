import { expect, type Page } from "@playwright/test";

/** Home, with its server card showing a session count ("Sessions and files"). */
export async function goHome(page: Page, stackUrl: string): Promise<void> {
  await page.goto(`${stackUrl}/#/`);
  await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
}

/** Opens a session from Home: the card's "Sessions and files" sheet, then the session's row. The sheet stays open over the new tab until it is closed (Escape). */
export async function openSessionRow(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: /^Sessions and files/ }).click();
  await page.getByRole("dialog", { name: /^Open on / }).getByRole("button", { name: new RegExp(`^${name} \\d+ windows?`) }).first().click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
