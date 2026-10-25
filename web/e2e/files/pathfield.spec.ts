import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, label, openFixture, SCENARIOS, type Scenario } from "../shared/harness";

// Files' path field (browser-behaviors.md "Files"): finding a folder by completing its path,
// on a fake home with one root (`~/repos/tether`) inside `~/repos`, in both layouts. Taps
// are the phone's way to accept; the keyboard's Tab, arrows and Return are the desktop's.

const desktop: Scenario = { layout: "desktop", scheme: "dark", density: "compact" };
const phone: Scenario = { layout: "phone", scheme: "dark", density: "touch" };

const field = (page: Page) => page.getByRole("textbox", { name: "Go to folder" });
const option = (page: Page, name: string | RegExp) => page.getByRole("option", { name });
const title = (page: Page, name: string | RegExp) => page.getByRole("heading", { level: 1, name });
/** The daemon's folder listings so far, `"GET /fs/dirs/path?…"`. */
const listings = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__harness?.platform.daemon.requests.filter((r) => /\/fs\/(list|dirs)\//.test(r)) ?? []);
const hash = (page: Page): Promise<string> => page.evaluate(() => location.hash);
/** Starts typing in the field with `text` replacing what it holds. */
async function typeInto(page: Page, text: string): Promise<void> {
  await field(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
}

for (const [name, scenario] of [["desktop", desktop], ["phone", phone]] as const) {
  test.describe(`path field on ${name}`, () => {
    test("at rest it reads the folder; a tap starts editing at its subfolders", async ({ page }) => {
      await openFixture(page, "filesFind", scenario, "#/files");
      await expect(field(page)).toHaveValue("~/repos/tether");
      expect(await listings(page)).toHaveLength(1);
      await field(page).click();
      await expect(field(page)).toHaveValue("~/repos/tether/");
      await expect(page.getByText("in ~/repos/tether")).toBeVisible();
      // Every subfolder, hidden ones left out, and nothing predicted yet. The folder's own listing seeded this: no request.
      await expect(page.getByRole("listbox", { name: "Folders" }).getByRole("option")).toHaveText([/^src/, /^web/, /^docs/, /^empty/]);
      await expect(page.getByRole("option", { selected: true })).toHaveCount(0);
      await page.waitForTimeout(400);
      expect(await listings(page)).toHaveLength(1);
    });

    test("typing narrows the list, predicts the first match and ghosts the rest", async ({ page }) => {
      await openFixture(page, "filesFind", scenario, "#/files");
      await field(page).click();
      await page.keyboard.type("w");
      await expect(page.getByRole("listbox", { name: "Folders" }).getByRole("option")).toHaveCount(1);
      await expect(option(page, /^web/)).toHaveAttribute("aria-selected", "true");
      await expect(field(page).locator("xpath=..")).toContainText("eb/");
      await page.keyboard.type("x");
      await expect(page.getByText("No folder in ~/repos/tether starts with wx")).toBeVisible();
    });

    test("tapping a row accepts it, lists its subfolders, and keeps the field focused", async ({ page }) => {
      await openFixture(page, "filesFind", scenario, "#/files");
      await field(page).click();
      await option(page, /^web/).click();
      await expect(field(page)).toHaveValue("~/repos/tether/web/");
      await expect(field(page)).toBeFocused();
      await expect(page.getByText("in ~/repos/tether/web")).toBeVisible();
      await expect(option(page, /^src/)).toBeVisible();
      // Accepting does not leave the folder the user is in.
      await expect(title(page, "tether")).toBeVisible();
    });

    test("a slash after a partial name accepts the prediction; after an exact name it is a slash", async ({ page }) => {
      await openFixture(page, "filesFindRoots", scenario, "#/files");
      await typeInto(page, "~/re");
      await expect(option(page, /^repos/)).toBeVisible();
      await page.keyboard.type("/");
      await expect(field(page)).toHaveValue("~/repos/");
      await page.keyboard.type("tether");
      await expect(option(page, /^tether-old/)).toBeVisible();
      await page.keyboard.type("/");
      await expect(field(page)).toHaveValue("~/repos/tether/");
      // The prediction needs the folder's listing, which comes once typing pauses.
      await expect(option(page, /^web/)).toBeVisible();
      await page.keyboard.type("we/");
      await expect(field(page)).toHaveValue("~/repos/tether/web/");
    });

    test("Tab and the arrow keys complete on a hardware keyboard", async ({ page }) => {
      await openFixture(page, "filesFind", scenario, "#/files");
      await typeInto(page, "~/repos/te");
      await expect(option(page, /^tether-old/)).toBeVisible();
      await expect(option(page, /^tether$/)).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("ArrowDown");
      await expect(option(page, /^tether-old/)).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("ArrowUp");
      await expect(option(page, /^tether$/)).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Tab");
      await expect(field(page)).toHaveValue("~/repos/tether/");
      await expect(field(page)).toBeFocused();
      await page.keyboard.type("d");
      await page.keyboard.press("ArrowRight");
      await expect(field(page)).toHaveValue("~/repos/tether/docs/");
    });

    test("Go opens the predicted folder, adds a history entry, and Back returns", async ({ page }) => {
      await openFixture(page, "filesFind", scenario, "#/files");
      await typeInto(page, "~/repos/tether/we");
      await page.keyboard.press("Enter");
      await expect(title(page, "web")).toBeVisible();
      await expect(field(page)).toHaveValue("~/repos/tether/web");
      await expect(field(page)).not.toBeFocused();
      await page.goBack();
      await expect(title(page, "tether")).toBeVisible();
      await expect(field(page)).toHaveValue("~/repos/tether");
    });

    test("Go right after an accept opens the accepted folder", async ({ page }) => {
      await openFixture(page, "filesFind", scenario, "#/files");
      await field(page).click();
      await option(page, /^docs/).click();
      await page.keyboard.press("Enter");
      await expect(title(page, "docs")).toBeVisible();
    });

    test("Go on a path naming nothing says so and opens nothing; Escape and Cancel restore the path", async ({ page }) => {
      await openFixture(page, "filesFind", scenario, "#/files");
      const before = await hash(page);
      await typeInto(page, "~/repos/tetherx");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("alert")).toHaveText("No folder ~/repos/tetherx");
      expect(await hash(page)).toBe(before);
      await page.keyboard.press("Escape");
      await expect(field(page)).toHaveValue("~/repos/tether");
      await expect(field(page)).not.toBeFocused();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await field(page).click();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(field(page)).toHaveValue("~/repos/tether");
      await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    });

    test("typing ~/repos/tether/web straight through costs one listing", async ({ page }) => {
      await openFixture(page, "filesFindRoots", scenario, "#/files");
      await typeInto(page, "~/repos/tether/web");
      await expect(option(page, /^web/)).toBeVisible();
      await page.waitForTimeout(400);
      expect(await listings(page)).toEqual(["GET /fs/list/home/jimmy/repos/tether?offset=0&hidden=0"]);
    });

    test("typing ~/repos/tether/web with a pause in each folder costs at most four listings: home, repos, tether", async ({ page }) => {
      await openFixture(page, "filesFindRoots", scenario, "#/files");
      await field(page).click();
      for (const step of ["", "repos/", "tether/", "web"]) {
        await page.waitForTimeout(350);
        await page.keyboard.type(step);
      }
      await page.waitForTimeout(350);
      const slow = await listings(page);
      expect(slow.length).toBeLessThanOrEqual(4);
      expect(slow).toEqual(["GET /fs/dirs/home/jimmy?offset=0&hidden=0", "GET /fs/dirs/home/jimmy/repos?offset=0&hidden=0", "GET /fs/list/home/jimmy/repos/tether?offset=0&hidden=0"]);
    });

    test("outside the roots under home, rows say 'not added'; a root reads like any folder", async ({ page }) => {
      await openFixture(page, "filesFindRoots", scenario, "#/files");
      await typeInto(page, "~/repos/");
      await expect(option(page, /^many/)).toContainText("not added");
      await expect(option(page, /^tether$/)).not.toContainText("not added");
    });

    test("above the roots, only the roots are offered, and elsewhere says it is outside", async ({ page }) => {
      await openFixture(page, "filesFindRoots", scenario, "#/files");
      await typeInto(page, "/");
      await expect(page.getByRole("listbox", { name: "Folders" }).getByRole("option")).toHaveText([/^home/]);
      await page.keyboard.type("home/jimmy/repos/");
      await expect(page.getByRole("listbox", { name: "Folders" }).getByRole("option")).toHaveCount(5);
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("/srv/x");
      await expect(page.getByText("Outside your folders")).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("alert")).toHaveText("Outside your folders");
      expect(await listings(page)).not.toContainEqual(expect.stringContaining("/srv"));
    });

    test("a folder outside the roots opens with its subfolders and 'Add this folder', which makes it one", async ({ page }) => {
      await openFixture(page, "filesFindRoots", scenario, "#/files");
      await typeInto(page, "~/repos/zebra");
      await page.keyboard.press("Enter");
      await expect(title(page, "zebra")).toBeVisible();
      await expect(page.getByText("Not one of your folders")).toBeVisible();
      await page.getByRole("button", { name: "Add this folder" }).click();
      await expect(page.getByText("Added ~/repos/zebra")).toBeVisible();
      await expect(page.getByText("Not one of your folders")).toHaveCount(0);
    });

    test("Add this folder is disabled at home itself, and the daemon's refusal shows in words", async ({ page }) => {
      await openFixture(page, "filesFindRoots", scenario, "#/files");
      await typeInto(page, "~/");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Add this folder" })).toHaveAccessibleDescription("Open a folder inside your home folder first");
      await typeInto(page, "~/escape");
      await page.keyboard.press("Enter");
      await expect(title(page, "escape")).toBeVisible();
      await page.getByRole("button", { name: "Add this folder" }).click();
      await expect(page.getByRole("alert")).toHaveText("Only folders inside your home folder can be added.");
    });

    test("hidden folders only appear when the segment starts with a dot or the toggle is on", async ({ page }) => {
      await openFixture(page, "filesFind", scenario, "#/files");
      await typeInto(page, "~/repos/tether/");
      await expect(option(page, /^web/)).toBeVisible();
      await expect(option(page, /^\.git/)).toHaveCount(0);
      await page.keyboard.type(".g");
      await expect(option(page, /^\.git/)).toBeVisible();
      expect((await listings(page)).filter((r) => r.includes("hidden=1"))).toHaveLength(1);
    });

    test("pages of folders are followed, and the last page's folders are all matched", async ({ page }) => {
      await openFixture(page, "filesFind", scenario, "#/files");
      await typeInto(page, "~/repos/many/folder-");
      await expect(page.getByRole("listbox", { name: "Folders" }).getByRole("option")).toHaveCount(20);
      // 20 folders at 8 to a page: three pages, each asked for once.
      expect((await listings(page)).filter((r) => r.includes("/repos/many?"))).toHaveLength(3);
    });

    test("Add folder… on the roots list starts the field at ~/", async ({ page }) => {
      await openFixture(page, "filesFindRoots", scenario, "#/files");
      await page.getByRole("button", { name: "Add folder…" }).click();
      await expect(field(page)).toBeFocused();
      await expect(field(page)).toHaveValue("~/");
      await expect(option(page, /^repos/)).toBeVisible();
    });

    test("tap-browsing still works at rest", async ({ page }) => {
      await openFixture(page, "filesFind", scenario, "#/files");
      await page.getByRole("button", { name: "web" }).click();
      await expect(title(page, "web")).toBeVisible();
      await expect(field(page)).toHaveValue("~/repos/tether/web");
    });
  });
}

// States of the list under the field, axe on each, in every layout, theme and density.
const STATES = [
  ["completing", "filesFind", "~/repos/tether/w", /^web/],
  ["loading a folder", "filesFindSlow", "~/repos/tether/src/", "Loading the folder"],
  ["refused folder", "filesFindDenied", "~/repos/tether/docs/", "Permission denied."],
  ["offline", "filesFindOffline", "~/repos/tether/src/", /unreachable|reach/i],
  ["scan cap", "filesFindCapped", "~/repos/tether/web/", "Only the first 1,000 folders are searched, keep typing to narrow."],
  ["empty folder", "filesFind", "~/repos/tether/empty/", "No folders in ~/repos/tether/empty"],
  ["outside", "filesFind", "/srv/", "Outside your folders"],
  ["not a path", "filesFind", "repos", "Type a path that starts with ~ or /."],
] as const;

for (const scenario of SCENARIOS) {
  test.describe(`path field states ${label(scenario)}`, () => {
    for (const [state, fixture, typed, expected] of STATES) {
      test(state, async ({ page }) => {
        const opened = await openFixture(page, fixture, scenario, "#/files");
        await typeInto(page, typed);
        if (state === "completing") await expect(option(page, expected)).toBeVisible();
        else if (state === "loading a folder") await expect(page.getByRole("status", { name: expected as string })).toBeVisible();
        else if (state === "offline") await expect(page.getByText(expected).first()).toBeVisible();
        else await expect(page.getByText(expected as string)).toBeVisible();
        if (state === "refused folder" || state === "offline") await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
        await expectAccessible(page);
        await expectNoHorizontalScroll(page);
        opened.expectNoConsoleErrors();
      });
    }

    test("a folder outside the roots", async ({ page }) => {
      const opened = await openFixture(page, "filesNotAdded", scenario, "#/files");
      await expect(page.getByText("Not one of your folders")).toBeVisible();
      await expectAccessible(page);
      await expectNoHorizontalScroll(page);
      opened.expectNoConsoleErrors();
    });
  });
}
