import { expect, test, type Page, type WebSocket } from "@playwright/test";
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

    const home = async (page: Page): Promise<void> => {
      await page.goto(`${stack.url}/#/`);
      await expect(page.getByRole("heading", { name: "On pop-os" }).or(page.locator("h2", { hasText: /^On / }))).toBeVisible();
    };
    const sessionRow = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name} \\d+ windows?`) }).first();

    test("lists the real sessions, and opening one makes its tab", async ({ page }) => {
      await home(page);
      await expect(sessionRow(page, "alpha")).toContainText("2 windows");
      await sessionRow(page, "alpha").click();
      await expect(page).toHaveURL(/#\/tab$/);
      await page.getByRole("button", { name: "Home" }).click();
      // The tab shows the session's current window, the one tmux made current with new-window.
      await expect(page.getByRole("button", { name: "alpha shell", exact: true })).toBeVisible();
      // The row is marked, and opening it again activates the tab: no duplicate.
      await expect(sessionRow(page, "alpha")).toContainText("open");
      await sessionRow(page, "alpha").click();
      await page.getByRole("button", { name: "Home" }).click();
      await expect(page.getByRole("button", { name: "alpha shell", exact: true })).toHaveCount(1);
    });

    test("creates a session and a window, and the window lands in the session's tab", async ({ page }) => {
      await home(page);
      await page.getByRole("button", { name: "New session" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill("made-here");
      await page.getByRole("button", { name: "Create" }).click();
      await expect(page).toHaveURL(/#\/tab$/);
      expect(stack.tmux("list-sessions", "-F", "#{session_name}")).toContain("made-here");

      await page.getByRole("button", { name: "Home" }).click();
      await sessionRow(page, "made-here").click();
      await page.getByRole("button", { name: "Windows in made-here" }).click();
      await page.getByRole("menuitem", { name: "New window" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill("second");
      await page.getByRole("button", { name: "Create" }).click();
      await expect(page).toHaveURL(/#\/tab$/);
      expect(stack.tmux("list-windows", "-t", "made-here", "-F", "#{window_name}")).toContain("second");
      // The tab follows the session to the new window.
      await expect(page.getByRole("button", { name: /^made-here second, / })).toBeVisible();
      // Back from the tab goes Home, not to the closed dialog.
      await page.goBack();
      await expect(page).toHaveURL(/#\/$/);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    test("a refused start directory shows the daemon's message in the form", async ({ page }) => {
      await home(page);
      await page.getByRole("button", { name: "New session" }).click();
      await page.getByRole("textbox", { name: "Start directory" }).fill("/definitely/not/here");
      await page.getByRole("button", { name: "Create" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByRole("dialog", { name: "New session" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "New session" })).toBeFocused();
    });

    test("a tab under an off-screen Home closes when its session is killed", async ({ page }) => {
      stack.tmux("new-session", "-d", "-s", "doomed", "-n", "only");
      await home(page);
      await sessionRow(page, "doomed").click();
      await expect(page).toHaveURL(/#\/tab$/);
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
