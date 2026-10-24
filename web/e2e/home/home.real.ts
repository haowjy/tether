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

    test("lists the real sessions, and opening a window makes its tab", async ({ page }) => {
      await home(page);
      await sessionRow(page, "alpha").click();
      await expect(page.getByText("0: editor")).toBeVisible();
      await page.getByRole("button", { name: "1: shell" }).click();
      await expect(page).toHaveURL(/#\/terminal$/);
      await page.getByRole("button", { name: "Home" }).click();
      await expect(page.getByRole("button", { name: "alpha / shell", exact: true })).toBeVisible();
      // The row is marked Open, and opening it again activates the tab: no duplicate.
      await expect(page.getByRole("button", { name: /1: shell/ })).toContainText("open");
      await page.getByRole("button", { name: /1: shell/ }).click();
      await page.getByRole("button", { name: "Home" }).click();
      await expect(page.getByRole("button", { name: "alpha / shell", exact: true })).toHaveCount(1);
    });

    test("creates a session and a window, and each lands in its tab", async ({ page }) => {
      await home(page);
      await page.getByRole("button", { name: "New session" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill("made-here");
      await page.getByRole("button", { name: "Create" }).click();
      await expect(page).toHaveURL(/#\/terminal$/);
      expect(stack.tmux("list-sessions", "-F", "#{session_name}")).toContain("made-here");

      await page.getByRole("button", { name: "Home" }).click();
      await sessionRow(page, "made-here").click();
      await page.getByRole("button", { name: "New window" }).first().click();
      await page.getByRole("textbox", { name: "Name" }).fill("second");
      await page.getByRole("button", { name: "Create" }).click();
      await expect(page).toHaveURL(/#\/terminal$/);
      expect(stack.tmux("list-windows", "-t", "made-here", "-F", "#{window_name}")).toContain("second");
      // Back from the new tab goes Home, not to the closed dialog.
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

    test("warns that another terminal is attached", async ({ page }) => {
      const laptop = await stack.attach("alpha");
      try {
        await page.goto(`${stack.url}/#/`);
        await sessionRow(page, "alpha").click();
        await expect(page.getByText("Another terminal is attached. Opening may resize it.")).toBeVisible();
      } finally {
        laptop.detach();
      }
    });

    test("a tab under an off-screen Home is pruned when its window is killed", async ({ page }) => {
      stack.tmux("new-session", "-d", "-s", "doomed", "-n", "only");
      stack.tmux("new-window", "-t", "doomed", "-n", "keep");
      await home(page);
      await sessionRow(page, "doomed").click();
      await page.getByRole("button", { name: "0: only" }).click();
      await expect(page).toHaveURL(/#\/terminal$/);
      // Off screen: Home covers the tab, so only a listing can say its window is gone.
      await page.getByRole("button", { name: "Home" }).click();
      await expect(page.getByRole("button", { name: "doomed / only", exact: true })).toBeVisible();
      stack.tmux("kill-window", "-t", "doomed:only");
      await expect(page.getByText(/1 tab closed/)).toBeVisible();
      await expect(page.getByRole("button", { name: "doomed / only", exact: true })).toHaveCount(0);
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
