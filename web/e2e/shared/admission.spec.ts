import { expect, test } from "@playwright/test";
import { openFixture, type Scenario } from "./harness";

const desktop: Scenario = { layout: "desktop", scheme: "dark", density: "compact" };
const phone: Scenario = { layout: "phone", scheme: "light", density: "touch" };

test.describe("Enrol", () => {
  test("shows the host, the node and where the code comes from", async ({ page }) => {
    await openFixture(page, "enrol", desktop);
    await expect(page.getByRole("heading", { name: "Set up pop-os" })).toBeVisible();
    await expect(page.getByText("This lets every browser and app on laptop use tether on pop-os.")).toBeVisible();
    await expect(page.getByLabel("Device name")).toHaveValue("laptop");
    await expect(page.getByRole("button", { name: "Enrol this device" })).toHaveAttribute("aria-disabled", "true");
  });

  test("a wrong code is explained under the field; the right one opens Home", async ({ page }) => {
    await openFixture(page, "enrol", phone);
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Enrol this device" }).click();
    await expect(page.getByRole("alert")).toHaveText("That code is wrong or has expired");
    await page.getByLabel("Code").fill("123456");
    await page.getByRole("button", { name: "Enrol this device" }).click();
    await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
    expect(await page.evaluate(() => window.__harness?.platform.daemon.requests.filter((r) => r.startsWith("POST")))).toEqual(["POST /auth/node/enroll", "POST /auth/node/enroll"]);
  });
});

test.describe("admission problems", () => {
  test("a page at the wrong origin names the right one and opens no socket", async ({ page }) => {
    await openFixture(page, "wrongOrigin", desktop);
    await expect(page.getByRole("heading", { name: "Open tether at https://other.tail.ts.net" })).toBeVisible();
    expect(await page.evaluate(() => window.__harness?.platform.links.length)).toBe(0);
  });

  test("a node the daemon refuses gets the reason in words and no form", async ({ page }) => {
    await openFixture(page, "nodeRefused", desktop);
    await expect(page.getByText("This device is a subnet router")).toBeVisible();
    await expect(page.getByLabel("Code")).toHaveCount(0);
  });

  test("browsers refused by the host get the reason and the fix", async ({ page }) => {
    await openFixture(page, "originRefused", desktop);
    await expect(page.getByText("more than one HTTPS entry")).toBeVisible();
  });

  test("an unreachable host keeps the app and offers Retry", async ({ page }) => {
    await openFixture(page, "unreachable", desktop);
    await expect(page.getByText("Can't reach the server")).toBeVisible();
    await page.evaluate(() => { if (window.__harness) window.__harness.platform.daemon.info = { hostId: "h-pop", name: "pop-os", protocol: { min: 1, max: 2 }, browserOrigin: "https://pop-os.tail.ts.net", browserRefused: null }; });
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Can't reach")).toBeHidden();
  });

  test("a socket refused for the connection cap says so on the host banner, and Retry connects again", async ({ page }) => {
    await openFixture(page, "home", desktop);
    await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__harness?.platform.links.length)).toBe(1);
    await page.evaluate(() => { window.__harness?.platform.links[0]?.drop(4005); });
    await expect(page.getByText("Too many connections to pop-os")).toBeVisible();
    await expect(page.getByText("Close tether in another browser or the app, then retry.")).toBeVisible();
    await page.getByRole("status").filter({ hasText: "Too many connections" }).getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Too many connections to pop-os")).toBeHidden();
  });

  test("an undecided daemon keeps the screen and says Checking access after 10 seconds", async ({ page }) => {
    await page.clock.install();
    await openFixture(page, "deciding", desktop);
    await expect(page.getByText("Checking access…")).toBeHidden();
    await page.clock.fastForward(11_000);
    await expect(page.getByText("Checking access…")).toBeVisible();
  });

  test("a token-admitted host is admitted without asking the daemon, and a refusal shows the pairing is gone", async ({ page }) => {
    await openFixture(page, "tokenHost", desktop);
    await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
    expect(await page.evaluate(() => window.__harness?.platform.daemon.requests)).toEqual([]);
    await page.evaluate(() => { window.__harness?.platform.links[0]?.drop(4401); });
    await expect(page.getByText("This app isn't paired with pop-os")).toBeVisible();
  });
});
