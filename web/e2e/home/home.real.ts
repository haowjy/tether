import { expect, test, type Page, type WebSocket } from "@playwright/test";
import { goHome } from "../shared/home";
import { startStack, type Stack, type TmuxVersion } from "../shared/stack";

// Home, the picker and creation against a real daemon and a real tmux (3.4 and 3.7b), in both
// browsers. Each version starts its own isolated stack (e2e/shared/stack.ts); the tests share
// it and run in order, since they share its tmux server.
const VERSIONS = (process.env["TETHER_E2E_TMUX"] ?? "3.4,3.7b").split(",") as TmuxVersion[];
test.use({ viewport: { width: 1440, height: 900 } });

for (const version of VERSIONS) {
  test.describe(`tmux ${version}`, () => {
    test.describe.configure({ mode: "serial" });
    let stack: Stack;

    test.beforeAll(async () => {
      test.setTimeout(120_000);
      stack = await startStack({ tmux: version, name: `home-${test.info().project.name}-${version}` });
      stack.tmux("new-session", "-d", "-s", "alpha", "-n", "editor");
      stack.tmux("new-window", "-t", "alpha", "-n", "shell");
    });
    test.afterAll(async () => { await stack.stop(); });

    const home = (page: Page): Promise<void> => goHome(page, stack.url);
    const serverSheet = (page: Page) => page.getByRole("dialog", { name: /^Open on / });
    const sessionRow = (page: Page, name: string) => serverSheet(page).getByRole("button", { name: new RegExp(`^${name} \\d+ windows?`) }).first();
    const allSessions = (page: Page) => page.getByRole("button", { name: /^Sessions and files/ });

    /** The server sheet's "New session" row, on its Sessions side. */
    const newSession = async (page: Page): Promise<void> => {
      await allSessions(page).click();
      await serverSheet(page).getByRole("button", { name: "New session", exact: true }).click();
    };

    test("lists the real sessions, and opening one makes its tab", async ({ page }) => {
      await home(page);
      await allSessions(page).click();
      await expect(sessionRow(page, "alpha")).toContainText("2 windows");
      await sessionRow(page, "alpha").click();
      await expect(page).toHaveURL(/#\/tab$/);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Home" }).click();
      // The tab shows the session's current window, the one tmux made current with new-window.
      await expect(page.getByRole("button", { name: "alpha shell", exact: true })).toBeVisible();
      // The row is marked, and opening it again activates the tab: no duplicate.
      await allSessions(page).click();
      await expect(sessionRow(page, "alpha")).toContainText("open");
      await sessionRow(page, "alpha").click();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Home" }).click();
      await expect(page.getByRole("button", { name: "alpha shell", exact: true })).toHaveCount(1);
    });

    test("creates a session, and its tab opens", async ({ page }) => {
      await home(page);
      await newSession(page);
      await page.getByRole("textbox", { name: "Name" }).fill("made-here");
      await page.getByRole("button", { name: "Create" }).click();
      await expect(page).toHaveURL(/#\/tab$/);
      expect(stack.tmux("list-sessions", "-F", "#{session_name}")).toContain("made-here");

      // The sheet stays open over the new tab, which is the route under it; closing it leaves the tab, and Back goes Home.
      await expect(page.getByRole("dialog", { name: /^Open on / }).getByText("here", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.goBack();
      await expect(page).toHaveURL(/#\/$/);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    test("a refused start directory shows the daemon's message in the form", async ({ page }) => {
      await home(page);
      await newSession(page);
      await page.getByRole("textbox", { name: "Start directory" }).fill("/definitely/not/here");
      await page.getByRole("button", { name: "Create" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByRole("heading", { name: /^New session on / })).toBeVisible();
      // Escape returns from the form to the list; Escape again closes the sheet, and focus goes back to what opened it.
      await page.keyboard.press("Escape");
      await expect(serverSheet(page).getByRole("button", { name: "New session", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(allSessions(page)).toBeFocused();
    });

    test("a tab under an off-screen Home closes when its session is killed", async ({ page }) => {
      stack.tmux("new-session", "-d", "-s", "doomed", "-n", "only");
      await home(page);
      await allSessions(page).click();
      await sessionRow(page, "doomed").click();
      await expect(page).toHaveURL(/#\/tab$/);
      await page.keyboard.press("Escape");
      // Off screen: Home covers the tab, and the daemon's closure broadcast removes it without a notice.
      await page.getByRole("button", { name: "Home" }).click();
      await expect(page.getByRole("button", { name: "doomed only", exact: true })).toBeVisible();
      stack.tmux("kill-session", "-t", "doomed");
      await expect(page.getByRole("button", { name: "doomed only", exact: true })).toHaveCount(0);
    });

    test("one listSessions per reconnect", async ({ page }) => {
      const sockets: { ws: WebSocket; lists: number }[] = [];
      page.on("websocket", (ws) => {
        if (!ws.url().endsWith("/ws")) return; // Vite's own hot-reload socket
        const entry = { ws, lists: 0 };
        sockets.push(entry);
        ws.on("framesent", (f) => { if (typeof f.payload === "string" && f.payload.includes('"listSessions"')) entry.lists++; });
      });
      await home(page);
      await expect.poll(() => sockets[0]?.lists).toBe(1);
      // The daemon goes away and comes back: the page reconnects once and asks once.
      await stack.stopDaemon();
      await expect.poll(() => sockets[0]?.ws.isClosed()).toBe(true);
      await stack.startDaemon();
      await expect.poll(() => sockets.length, { timeout: 30_000 }).toBeGreaterThan(1);
      await expect.poll(() => sockets.at(-1)?.lists, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
      await page.waitForTimeout(1500);
      expect(sockets.at(-1)?.lists).toBe(1);
    });
  });
}
