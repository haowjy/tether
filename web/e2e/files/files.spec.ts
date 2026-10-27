import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, label, openFixture, SCENARIOS, type Scenario } from "../shared/harness";

// The Files screen on a fake file tree served through the fake daemon (harness/files/):
// browsing, previews, history, uploads and the insert-path offer, on the phone and the
// desktop layout. The app is the real one: specs read the daemon's requests and the input
// the terminal's driver sent.

const desktop: Scenario = { layout: "desktop", scheme: "dark", density: "compact" };
const phone: Scenario = { layout: "phone", scheme: "dark", density: "touch" };
const SCREENS = [["desktop", desktop], ["phone", phone]] as const;

const REPO = "/home/jimmy/tether";
const UPLOADED = "/home/jimmy/tether-uploads/20261022-101010Z-abcd.jpg";
const hash = (page: Page): Promise<string> => page.evaluate(() => location.hash);
/** The id of the tab on screen, and a tap on a tab's pill. */
const activeTab = (page: Page): Promise<string | null | undefined> => page.evaluate(() => window.__harness?.app.snapshot.workspace.active);
const activate = (page: Page, id: string): Promise<void> => page.evaluate((tab) => { window.__harness?.app.dispatch({ type: "activated", id: tab }); }, id);
const title = (page: Page, name: string | RegExp) => page.getByRole("heading", { level: 1, name });
/** The fake daemon's `/fs` requests so far, `"METHOD /path?query"`. */
const fsRequests = (page: Page): Promise<string[]> => page.evaluate(() => window.__harness?.platform.daemon.requests.filter((r) => r.includes(" /fs/")) ?? []);
/** Each `[tmux window, text]` the app typed into a tab: the real driver's `input` messages, by the window they name. */
const typed = (page: Page): Promise<[number, string][]> =>
  page.evaluate(() => {
    const sent = window.__harness?.platform.links.flatMap((l) => l.sent) ?? [];
    return sent.flatMap((m) => (m.type === "input" ? [[m.data.window, m.data.items.map((i) => ("text" in i ? i.text : `<${JSON.stringify(i)}>`)).join("")] as [number, string]] : []));
  });
const script = (page: Page, run: "push" | "end", event?: object): Promise<void> =>
  page.evaluate(([call, e]) => { const s = window.__harness?.platform.uploadScript; if (call === "push") s?.push(e as never); else s?.end(); }, [run, event] as const);

/** The active tab's id in the fixture's saved workspace: the session tether, whose current window is 1. */
const AGENT = "h-pop/main:1-1/$1";
const AGENT_WINDOW = 1;
const NOTES = "h-pop/main:1-1/$2";
/** The Files tab the fixtures open on. */
const FILES = "files-1";

for (const [name, scenario] of SCREENS) {
  test.describe(`files on ${name}`, () => {
    test("browses roots, folders and pages", async ({ page }) => {
      const opened = await openFixture(page, "files", scenario);
      await expect(page.getByRole("button", { name: "~/tether", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /~\/tether-uploads/ })).toContainText("Uploads");
      await page.getByRole("button", { name: "~/tether", exact: true }).click();
      await expect(title(page, "tether")).toBeVisible();
      // Folders first, then files. The fake lists eight to a page; the second page loads as the list's end nears the screen.
      const rows = page.getByRole("group", { name: "Contents" }).getByRole("button");
      await expect(rows).toHaveCount(9);
      await expect(rows.first()).toContainText("src");
      expect((await fsRequests(page)).filter((r) => r.includes("/fs/list/"))).toEqual([`GET /fs/list${REPO}?offset=0&hidden=0`, `GET /fs/list${REPO}?offset=8&hidden=0`]);
      await expect(page.getByRole("button", { name: /Show more/ })).toHaveCount(0);
      await page.getByRole("button", { name: "Show hidden files" }).click();
      await expect(rows).toHaveCount(11);
      await expect(page.getByRole("button", { name: ".git" })).toBeVisible();
      await expect(page.getByRole("button", { name: ".env" })).toBeVisible();
      opened.expectNoConsoleErrors();
    });

    test("previews code, Markdown, images, video and binary files", async ({ page }) => {
      await openFixture(page, "filesFolder", scenario);
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
      await openFixture(page, "filesMarkdown", scenario);
      // The document's own markup that navigates or takes focus is gone, not merely unclicked.
      await expect(page.getByRole("link", { name: "the design" })).toBeVisible();
      await expect(page.locator("article").locator("area, map, details, summary, svg, [usemap]")).toHaveCount(0);
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

    test("Back retraces preview, folders and the tab, and keeps the list as it was", async ({ page }) => {
      await openFixture(page, "files", scenario);
      await page.getByRole("button", { name: "~/tether", exact: true }).click();
      await page.getByRole("button", { name: "src" }).click();
      await page.getByRole("button", { name: "main.rs" }).click();
      await expect(page.getByLabel("Contents of main.rs")).toBeVisible();
      const listed = (await fsRequests(page)).length;

      await page.goBack();
      await expect(title(page, "src")).toBeVisible();
      // The folder was still loaded: Back made no request.
      expect((await fsRequests(page)).length).toBe(listed);
      await page.goBack();
      await expect(title(page, "tether")).toBeVisible();
      await page.goBack();
      await expect(title(page, "Files")).toBeVisible();
      expect(await hash(page)).toBe("#/tab");
      await page.goBack();
      await expect(page.getByRole("heading", { name: "Open tabs" })).toBeVisible();

      // The in-app parent row goes up a level too: absent at a root, the folder's parent below it.
      await page.goForward();
      await expect(page.getByRole("button", { name: /^Up to / })).toHaveCount(0);
      await page.goForward();
      await page.goForward();
      await expect(title(page, "src")).toBeVisible();
      await page.getByRole("button", { name: "Up to tether" }).click();
      await expect(title(page, "tether")).toBeVisible();
    });

    test("restores the preview and saves the browsed folder", async ({ page }) => {
      await openFixture(page, "filesMarkdown", scenario);
      await expect(title(page, "README.md")).toBeVisible();
      await page.getByRole("button", { name: "Back to folder" }).click();
      await expect(title(page, "tether")).toBeVisible();
      await expect(page.getByRole("button", { name: "src" })).toBeVisible();
      await page.getByRole("button", { name: "src" }).click();
      await expect(title(page, "src")).toBeVisible();

      await page.evaluate(() => window.__harness?.app.persist.persistNow());
      const saved = await page.evaluate(() => window.__harness?.platform.savedWorkspaces.at(-1) ?? null);
      expect(saved?.tabs.find((t) => t.kind === "files")).toEqual({ kind: "files", id: FILES, host: "h-pop", place: { kind: "dir", path: `${REPO}/src` } });
    });

    test("Insert path goes to the host's last terminal tab, with no Enter, and shows it", async ({ page }) => {
      await openFixture(page, "filesCode", scenario);
      await page.getByRole("button", { name: "Insert path into tether agent" }).click();
      await expect.poll(() => activeTab(page)).toBe(AGENT);
      // The quoted-or-bare path, as text and nothing else: no Enter. It is typed once the tab's watch binds.
      await expect.poll(() => typed(page), { timeout: 15_000 }).toEqual([[AGENT_WINDOW, `${REPO}/src/main.rs`]]);
    });

    test("Insert path is disabled for a tab the daemon refused for its session limit, and offered again once it connects", async ({ page }) => {
      await openFixture(page, "filesCode", scenario);
      await page.evaluate(() => { const d = window.__harness?.platform.daemon; if (d) d.watch = { limit: "tether on pop-os allows 1 tmux session at a time" }; });
      // Showing the tab asks the daemon to watch it, and the refusal marks it limited.
      await activate(page, AGENT);
      await expect(page.getByText("allows 1 tmux session at a time").first()).toBeVisible();
      await activate(page, FILES);
      const button = page.getByRole("button", { name: "Insert path into tether agent" });
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await expect(button).toHaveAccessibleDescription("That tab isn't connected");
      await button.click({ force: true });
      expect(await typed(page)).toEqual([]);
      // The daemon now answers: the tab's own backoff retries, and Insert is offered again.
      await page.evaluate(() => { const d = window.__harness?.platform.daemon; if (d) d.watch = "ok"; });
      await activate(page, AGENT);
      await expect(page.getByText("allows 1 tmux session at a time")).toHaveCount(0, { timeout: 10_000 });
      await activate(page, FILES);
      await expect(button).not.toHaveAttribute("aria-disabled", "true");
    });

    test("Insert path says why it is unavailable with no tab open", async ({ page }) => {
      await openFixture(page, "filesCode", scenario);
      await page.evaluate(() => { for (const id of ["h-pop/main:1-1/$1", "h-pop/main:1-1/$2"]) window.__harness?.app.dispatch({ type: "closed", id }); });
      const button = page.getByRole("button", { name: "Insert path" });
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await expect(button).toHaveAccessibleDescription("Open a terminal tab first");
      await button.click({ force: true });
      expect(await typed(page)).toEqual([]);
    });

    test("an upload shows progress, then offers the path for the tab it began in", async ({ page }) => {
      await openFixture(page, "filesFolder", scenario);
      await page.getByRole("button", { name: "Upload" }).click();
      expect(await page.evaluate(() => window.__harness?.platform.uploadScript.picks)).toBe(1);
      await script(page, "push", { id: "u1", progress: 0 });
      await expect(page.getByText("Waiting to upload")).toBeVisible();
      await script(page, "push", { id: "u1", progress: 0.4 });
      await expect(page.getByText("Uploading 40%")).toBeVisible();
      // The user goes to another tab and back to Files meanwhile: the offer stays with the first.
      await activate(page, NOTES);
      await expect.poll(() => activeTab(page)).toBe(NOTES);
      await activate(page, FILES);
      await expect(page.getByText("Uploading 40%")).toBeVisible();
      await script(page, "push", { id: "u1", path: UPLOADED });
      await script(page, "end");
      await expect(page.getByText("Saved 20261022-101010Z-abcd.jpg")).toBeVisible();
      await page.getByRole("button", { name: "Insert path into tether agent" }).click();
      await expect.poll(() => activeTab(page)).toBe(AGENT);
      await expect.poll(() => typed(page), { timeout: 15_000 }).toEqual([[AGENT_WINDOW, UPLOADED]]);
    });

    test("when the target tab is gone mid-upload nothing is inserted anywhere", async ({ page }) => {
      await openFixture(page, "filesFolder", scenario);
      await page.getByRole("button", { name: "Upload" }).click();
      await script(page, "push", { id: "u1", progress: 0.5 });
      await expect(page.getByText("Uploading 50%")).toBeVisible();
      await page.evaluate((id) => window.__harness?.app.dispatch({ type: "closed", id }), AGENT);
      await script(page, "push", { id: "u1", path: UPLOADED });
      await script(page, "end");
      await expect(page.getByText("Saved 20261022-101010Z-abcd.jpg")).toBeVisible();
      // The notes tab is still open and now active, but the offer does not move to it.
      const offer = page.getByRole("button", { name: "Insert path" });
      await expect(offer).toHaveAttribute("aria-disabled", "true");
      await expect(offer).toHaveAccessibleDescription("That tab was closed");
      await offer.click({ force: true });
      expect(await typed(page)).toEqual([]);
      // The file stays in Files.
      await page.getByRole("button", { name: "Preview" }).click();
      await expect(title(page, "20261022-101010Z-abcd.jpg")).toBeVisible();
    });

    test("a failed upload says why and can be dismissed", async ({ page }) => {
      await openFixture(page, "filesFolder", scenario);
      await page.getByRole("button", { name: "Upload" }).click();
      await script(page, "push", { id: "u9", error: "Wait for the current uploads to finish" });
      await script(page, "end");
      await expect(page.getByRole("alert").filter({ hasText: "Wait for the current uploads to finish" })).toBeVisible();
      await page.getByRole("list", { name: "Uploads" }).getByRole("button", { name: "Dismiss" }).click();
      await expect(page.getByRole("list", { name: "Uploads" })).toHaveCount(0);
    });

    test("Remove asks first, keeps the folder on Cancel, and removes it on confirm", async ({ page }) => {
      await openFixture(page, "files", scenario);
      const notes = page.getByRole("button", { name: "~/notes", exact: true });
      await page.getByRole("button", { name: "Remove ~/notes" }).click();
      const dialog = page.getByRole("dialog", { name: "Remove this folder?" });
      await expect(dialog).toContainText("~/notes will no longer show in Files");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      await expect(notes).toBeVisible();
      await expect(page.getByRole("button", { name: "Remove ~/notes" })).toBeFocused();

      await page.getByRole("button", { name: "Remove ~/notes" }).click();
      await dialog.getByRole("button", { name: "Remove folder" }).click();
      await expect(dialog).toBeHidden();
      await expect(notes).toHaveCount(0);
      await expect(page.getByText("Removed ~/notes")).toBeVisible();
      // The row that held the button is gone: focus goes to Add folder.
      await expect(page.getByRole("button", { name: "Add folder…" })).toBeFocused();
      // Uploads is not a root and has no Remove.
      await expect(page.getByRole("button", { name: /Remove ~\/tether-uploads/ })).toHaveCount(0);
    });

    test("with no folders, the empty state's Add folder starts the path field at home", async ({ page }) => {
      await openFixture(page, "filesNoRoots", scenario);
      await page.getByRole("button", { name: "Add folder…" }).click();
      const field = page.getByRole("textbox", { name: "Go to folder" });
      await expect(field).toBeFocused();
      await expect(field).toHaveValue("~/");
      await page.getByRole("option", { name: /^code/ }).click();
      await page.keyboard.press("Enter");
      await expect(title(page, "code")).toBeVisible();
      await page.getByRole("button", { name: "Add this folder" }).click();
      await expect(page.getByText("Added ~/code")).toBeVisible();
      await expect(page.getByText("Not one of your folders")).toHaveCount(0);
    });

    test("states: empty folder, refusal with retry, no roots", async ({ page }) => {
      await openFixture(page, "filesEmpty", scenario);
      await expect(page.getByText("This folder is empty")).toBeVisible();
      await openFixture(page, "filesDenied", scenario);
      await expect(page.getByText("Permission denied.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      await openFixture(page, "filesNoRoots", scenario);
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
  ["remove folder", "files"],
] as const;

for (const scenario of SCENARIOS) {
  test.describe(`accessibility ${label(scenario)}`, () => {
    for (const [state, fixture] of STATES) {
      test(state, async ({ page }) => {
        const opened = await openFixture(page, fixture, scenario);
        await title(page, /.+/).first().waitFor();
        // Wait out loading: a spinner is not the state.
        await expect(page.getByRole("status", { name: /^Loading/ })).toHaveCount(0);
        if (fixture === "filesFolder") {
          await page.getByRole("button", { name: "Upload" }).click();
          await script(page, "push", { id: "u1", progress: 0.4 });
          await script(page, "push", { id: "u2", path: UPLOADED });
          await script(page, "push", { id: "u3", error: "That file is over the 128 MiB limit" });
          await expect(page.getByText("Saved 20261022-101010Z-abcd.jpg")).toBeVisible();
        }
        if (state === "remove folder") {
          await page.getByRole("button", { name: "Remove ~/notes" }).click();
          await expect(page.getByRole("dialog", { name: "Remove this folder?" })).toBeVisible();
        }
        await expectAccessible(page);
        await expectNoHorizontalScroll(page);
        opened.expectNoConsoleErrors();
      });
    }
  });
}
