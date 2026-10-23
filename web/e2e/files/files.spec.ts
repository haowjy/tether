import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, label, openFixture, SCENARIOS, type Scenario } from "../shared/harness";

// The Files screen on a fake file tree (harness/files/): browsing, previews, history,
// uploads and the insert-path offer, on the phone and the desktop layout.

const desktop: Scenario = { layout: "desktop", scheme: "dark", density: "compact" };
const phone: Scenario = { layout: "phone", scheme: "dark", density: "touch" };
const SCREENS = [["desktop", desktop], ["phone", phone]] as const;

const REPO = "/home/jimmy/tether";
const hash = (page: Page): Promise<string> => page.evaluate(() => location.hash);
const title = (page: Page, name: string | RegExp) => page.getByRole("heading", { level: 1, name });
const calls = (page: Page): Promise<number> => page.evaluate(() => window.__files?.calls.length ?? -1);
const inserted = (page: Page): Promise<[string, string][]> => page.evaluate(() => window.__files?.inserted ?? []);

/** The active tab's id in the fixture's saved workspace: tether / agent. */
const AGENT = "h-pop/main:1-1/1";
const NOTES = "h-pop/main:1-1/3";

for (const [name, scenario] of SCREENS) {
  test.describe(`files on ${name}`, () => {
    test("browses roots, folders and pages", async ({ page }) => {
      const opened = await openFixture(page, "files", scenario, "#/files");
      await expect(page.getByRole("button", { name: "~/tether", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /~\/tether-uploads/ })).toContainText("Uploads");
      await page.getByRole("button", { name: "~/tether", exact: true }).click();
      await expect(title(page, "tether")).toBeVisible();
      // Folders first, then files. The fake lists eight to a page; the second page loads as the list's end nears the screen.
      const rows = page.getByRole("group", { name: "Contents" }).getByRole("button");
      await expect(rows).toHaveCount(9);
      await expect(rows.first()).toContainText("src");
      expect(await page.evaluate(() => window.__files?.calls.filter((c) => c.startsWith("list")))).toEqual([`list ${REPO} 0`, `list ${REPO} 8`]);
      await expect(page.getByRole("button", { name: /Show more/ })).toHaveCount(0);
      await page.getByRole("button", { name: "Show hidden files" }).click();
      await expect(rows).toHaveCount(11);
      await expect(page.getByRole("button", { name: ".git" })).toBeVisible();
      await expect(page.getByRole("button", { name: ".env" })).toBeVisible();
      opened.expectNoConsoleErrors();
    });

    test("previews code, Markdown, images, video and binary files", async ({ page }) => {
      await openFixture(page, "filesFolder", scenario, "#/files");
      await page.getByRole("button", { name: "src" }).click();
      await page.getByRole("button", { name: "main.rs" }).click();
      await expect(title(page, "main.rs")).toBeVisible();
      await expect(page.getByLabel("Contents of main.rs")).toContainText("fn main()");
      // Shiki coloured it: tokens carry a colour of their own.
      await expect.poll(() => page.locator("pre code span span[style*='color']").count()).toBeGreaterThan(0);

      await page.goBack();
      await page.goBack();
      await page.getByRole("button", { name: "README.md" }).click();
      await expect(page.getByRole("heading", { level: 2, name: "Building" })).toBeVisible();
      await page.goBack();

      await page.getByRole("button", { name: "shot.png" }).click();
      await expect(page.getByRole("img", { name: "shot.png" })).toBeVisible();
      await expect.poll(() => page.getByRole("img", { name: "shot.png" }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      await page.goBack();

      await page.getByRole("button", { name: "demo.mp4" }).click();
      await expect(page.locator("video[controls]")).toBeVisible();
      await page.goBack();

      await page.getByRole("button", { name: "tether.bin" }).click();
      await expect(page.getByRole("button", { name: "Open as text" })).toBeVisible();
      await expect(page.getByText("application/octet-stream")).toBeVisible();
      await page.getByRole("button", { name: "Open as text" }).click();
      await expect(page.getByLabel("Contents of tether.bin")).toBeVisible();
    });

    test("Markdown links open a file here and a web link in the browser", async ({ page }) => {
      await openFixture(page, "filesMarkdown", scenario, "#/files");
      await page.getByRole("link", { name: "the design" }).click();
      await expect(title(page, "plan.md")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Plan", exact: true })).toBeVisible();
      await page.goBack();
      await expect(title(page, "README.md")).toBeVisible();
      const opened = await page.evaluate(() => window.__harness?.platform.opened ?? []);
      expect(opened).toEqual([]);
      await page.getByRole("link", { name: "the site" }).click();
      expect(await page.evaluate(() => window.__harness?.platform.opened ?? [])).toEqual(["https://example.com/"]);
    });

    test("Back retraces preview, folders and destination, and keeps the list as it was", async ({ page }) => {
      await openFixture(page, "files", scenario, "#/files");
      await page.getByRole("button", { name: "~/tether", exact: true }).click();
      await page.getByRole("button", { name: "src" }).click();
      await page.getByRole("button", { name: "main.rs" }).click();
      await expect(title(page, "main.rs")).toBeVisible();
      const listed = await calls(page);

      await page.goBack();
      await expect(title(page, "src")).toBeVisible();
      // The folder was still loaded: Back made no request.
      expect(await calls(page)).toBe(listed);
      await page.goBack();
      await expect(title(page, "tether")).toBeVisible();
      await page.goBack();
      await expect(title(page, "Files")).toBeVisible();
      expect(await hash(page)).toBe("#/files");

      // The in-app back button goes up a level too.
      await page.goForward();
      await page.getByRole("button", { name: "Up one folder" }).or(page.getByRole("button", { name: "All folders" })).click();
      await expect(title(page, "Files")).toBeVisible();
    });

    test("a reload returns to the folder and the preview", async ({ page }) => {
      await openFixture(page, "filesMarkdown", scenario, "#/files");
      await expect(title(page, "README.md")).toBeVisible();
      await page.getByRole("button", { name: "Back to folder" }).click();
      await expect(title(page, "tether")).toBeVisible();
      await expect(page.getByRole("button", { name: "src" })).toBeVisible();
    });

    test("Insert path goes to the active tab, with no Enter, and opens Terminal there", async ({ page }) => {
      await openFixture(page, "filesCode", scenario, "#/files");
      await page.getByRole("button", { name: "Insert path into tether / agent" }).click();
      expect(await inserted(page)).toEqual([[AGENT, `${REPO}/src/main.rs`]]);
      await expect.poll(() => hash(page)).toBe("#/terminal");
      expect(await page.evaluate(() => window.__harness?.app.snapshot.workspace.active)).toBe(AGENT);
    });

    test("Insert path says why it is unavailable with no tab open", async ({ page }) => {
      await openFixture(page, "filesCode", scenario, "#/files");
      await page.evaluate(() => { for (const id of ["h-pop/main:1-1/1", "h-pop/main:1-1/3"]) window.__harness?.app.dispatch({ type: "closed", id }); });
      const button = page.getByRole("button", { name: "Insert path" });
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await expect(button).toHaveAccessibleDescription("Open a terminal tab first");
      await button.click({ force: true });
      expect(await inserted(page)).toEqual([]);
    });

    test("an upload shows progress, then offers the path for the tab it began in", async ({ page }) => {
      await openFixture(page, "filesFolder", scenario, "#/files");
      await page.getByRole("button", { name: "Upload" }).click();
      expect(await page.evaluate(() => window.__files?.uploads.picks)).toBe(1);
      await page.evaluate(() => window.__files?.uploads.push({ id: "u1", progress: 0 }));
      await expect(page.getByText("Waiting to upload")).toBeVisible();
      await page.evaluate(() => window.__files?.uploads.push({ id: "u1", progress: 0.4 }));
      await expect(page.getByText("Uploading 40%")).toBeVisible();
      // Another tab becomes active meanwhile: the offer stays with the first.
      await page.evaluate((id) => window.__harness?.app.dispatch({ type: "activated", id }), NOTES);
      await page.evaluate(() => { window.__files?.uploads.push({ id: "u1", path: "/home/jimmy/tether-uploads/20261022-101010Z-abcd.jpg" }); window.__files?.uploads.end(); });
      await expect(page.getByText("Saved 20261022-101010Z-abcd.jpg")).toBeVisible();
      await page.getByRole("button", { name: "Insert path into tether / agent" }).click();
      expect(await inserted(page)).toEqual([[AGENT, "/home/jimmy/tether-uploads/20261022-101010Z-abcd.jpg"]]);
      await expect.poll(() => hash(page)).toBe("#/terminal");
    });

    test("when the target tab is gone mid-upload nothing is inserted anywhere", async ({ page }) => {
      await openFixture(page, "filesFolder", scenario, "#/files");
      await page.getByRole("button", { name: "Upload" }).click();
      await page.evaluate(() => window.__files?.uploads.push({ id: "u1", progress: 0.5 }));
      await expect(page.getByText("Uploading 50%")).toBeVisible();
      await page.evaluate((id) => window.__harness?.app.dispatch({ type: "closed", id }), AGENT);
      await page.evaluate(() => { window.__files?.uploads.push({ id: "u1", path: "/home/jimmy/tether-uploads/20261022-101010Z-abcd.jpg" }); window.__files?.uploads.end(); });
      await expect(page.getByText("Saved 20261022-101010Z-abcd.jpg")).toBeVisible();
      // The notes tab is still open and now active, but the offer does not move to it.
      const offer = page.getByRole("button", { name: "Insert path" });
      await expect(offer).toHaveAttribute("aria-disabled", "true");
      await expect(offer).toHaveAccessibleDescription("That tab was closed");
      await offer.click({ force: true });
      expect(await inserted(page)).toEqual([]);
      // The file stays in Files.
      await page.getByRole("button", { name: "Preview" }).click();
      await expect(title(page, "20261022-101010Z-abcd.jpg")).toBeVisible();
    });

    test("a failed upload says why and can be dismissed", async ({ page }) => {
      await openFixture(page, "filesFolder", scenario, "#/files");
      await page.getByRole("button", { name: "Upload" }).click();
      await page.evaluate(() => { window.__files?.uploads.push({ id: "u9", error: "Wait for the current uploads to finish" }); window.__files?.uploads.end(); });
      await expect(page.getByRole("alert").filter({ hasText: "Wait for the current uploads to finish" })).toBeVisible();
      await page.getByRole("list", { name: "Uploads" }).getByRole("button", { name: "Dismiss" }).click();
      await expect(page.getByRole("list", { name: "Uploads" })).toHaveCount(0);
    });

    test("states: empty folder, refusal with retry, no roots", async ({ page }) => {
      await openFixture(page, "filesEmpty", scenario, "#/files");
      await expect(page.getByText("This folder is empty")).toBeVisible();
      await openFixture(page, "filesDenied", scenario, "#/files");
      await expect(page.getByText("Permission denied.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      await openFixture(page, "filesNoRoots", scenario, "#/files");
      await expect(page.getByText("No folders to show")).toBeVisible();
    });
  });
}

// Axe on every state in every layout, theme and density.
const STATES = [
  ["roots", "files"],
  ["folder", "filesFolder"],
  ["markdown", "filesMarkdown"],
  ["code", "filesCode"],
  ["image", "filesImage"],
  ["video", "filesVideo"],
  ["binary", "filesBinary"],
  ["empty", "filesEmpty"],
  ["refused", "filesDenied"],
  ["no roots", "filesNoRoots"],
] as const;

for (const scenario of SCENARIOS) {
  test.describe(`accessibility ${label(scenario)}`, () => {
    for (const [state, fixture] of STATES) {
      test(state, async ({ page }) => {
        const opened = await openFixture(page, fixture, scenario, "#/files");
        await title(page, /.+/).first().waitFor();
        // Wait out loading: a spinner is not the state.
        await expect(page.getByRole("status", { name: /^Loading/ })).toHaveCount(0);
        if (fixture === "filesFolder") {
          await page.getByRole("button", { name: "Upload" }).click();
          await page.evaluate(() => { window.__files?.uploads.push({ id: "u1", progress: 0.4 }); window.__files?.uploads.push({ id: "u2", path: "/home/jimmy/tether-uploads/20261022-101010Z-abcd.jpg" }); window.__files?.uploads.push({ id: "u3", error: "That file is over the 128 MiB limit" }); });
          await expect(page.getByText("Saved 20261022-101010Z-abcd.jpg")).toBeVisible();
        }
        await expectAccessible(page);
        await expectNoHorizontalScroll(page);
        opened.expectNoConsoleErrors();
      });
    }
  });
}
