// The phone dock against a real daemon on a private tmux (3.4 and 3.7b), at phone size with a
// coarse pointer, so the app takes the owned input and the dock (client-architecture.md §11,
// P3a). Each assertion crosses the whole path (dock, protocol, daemon, tmux) and reads what the
// pane received with `tmux capture-pane`. The iOS Simulator probes (keyboard geometry, cues) are
// by hand: Playwright has no software keyboard.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { goHome, openSessionRow } from "../shared/home";
import { startStack, type Stack, type TmuxVersion } from "../shared/stack";

const VERSIONS = (process.env["TETHER_E2E_TMUX"] ?? "3.4,3.7b").split(",") as TmuxVersion[];

test.use({ viewport: { width: 393, height: 852 }, hasTouch: true });

for (const version of VERSIONS) {
  test.describe(`tmux ${version}`, () => {
    test.describe.configure({ mode: "serial" });
    let stack: Stack;
    let sessions = 0;

    test.beforeAll(async () => {
      test.setTimeout(120_000);
      stack = await startStack({ tmux: version, name: `dock-${test.info().project.name}-${version}`, memoryMiB: 72 });
    });
    test.afterAll(async () => { await stack.stop(); });

    /** A fresh session. `sh` with a `$ ` prompt unless a command is given. */
    function newSession(command = "env PS1='$ ' sh", name = `s${String(++sessions)}`): string {
      stack.tmux("new-session", "-d", "-s", name, "-x", "100", "-y", "30", command);
      return name;
    }
    const pane = (session: string, target = session): string => stack.tmux("capture-pane", "-p", "-J", "-t", target);
    const paneIncludes = async (session: string, text: string | RegExp, timeout = 10_000): Promise<void> => {
      await expect.poll(() => pane(session), { timeout }).toMatch(typeof text === "string" ? new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : text);
    };

    const line = (page: Page): Locator => page.getByRole("textbox", { name: /^Line for / });
    /** The line field's value is readable at rest, where it is hidden. */
    const draft = (page: Page): Locator => page.getByRole("textbox", { name: /^Line for /, includeHidden: true });
    const owned = (page: Page): Locator => page.getByRole("textbox", { name: "Terminal keyboard" });
    const toggle = (page: Page): Locator => page.getByRole("button", { name: /^(Show|Hide) keyboard$/ });
    const key = (page: Page, name: string): Locator => page.getByRole("group", { name: "Terminal keys" }).getByRole("button", { name, exact: true });

    /** Opens `session` from Home and waits until the tab is painted. */
    async function open(page: Page, session: string): Promise<void> {
      await goHome(page, stack.url);
      await openSessionRow(page, session);
      await painted(page);
    }
    /** A reload opens Home: the saved tab for `session` is one tap away on its server's card. */
    async function reopen(page: Page, session: string): Promise<void> {
      await page.getByRole("button", { name: new RegExp(`^${session}\\b`) }).click();
      await painted(page);
    }
    async function painted(page: Page): Promise<void> {
      await page.waitForFunction(() => { const host = document.querySelector(".xterm")?.parentElement; return host !== null && host !== undefined && !host.hasAttribute("data-blank"); });
    }

    /** The line field is hidden at rest: the toggle raises the keyboard for the terminal, and a tap on the box takes typing. */
    async function raiseLine(page: Page): Promise<void> {
      if (await toggle(page).getAttribute("aria-label") === "Show keyboard") await toggle(page).click();
      await line(page).click();
    }

    async function sendLine(page: Page, text: string): Promise<void> {
      await raiseLine(page);
      await page.keyboard.type(text);
      await page.keyboard.press("Enter");
    }

    for (const shell of [
      { name: "bash", command: "env PS1='$ ' bash --norc --noprofile" },
      { name: "zsh", command: "env PROMPT='$ ' zsh -f" },
    ]) {
      test(`Return runs echo hi once in ${shell.name}, and the line clears and keeps focus`, async ({ page }) => {
        const s = newSession(shell.command);
        await open(page, s);
        await paneIncludes(s, /\$ /);
        await sendLine(page, "echo hi");
        await paneIncludes(s, /^hi$/m);
        await page.waitForTimeout(500);
        expect(pane(s).match(/^hi$/gm)).toHaveLength(1);
        await expect(line(page)).toHaveValue("");
        await expect(line(page)).toBeFocused();
      });
    }

    test("an empty Return is Enter", async ({ page }) => {
      const s = newSession();
      await open(page, s);
      await paneIncludes(s, /\$ /);
      await sendLine(page, "echo one");
      await paneIncludes(s, /^one$/m);
      await line(page).press("Enter");
      await expect.poll(() => (pane(s).match(/^\$ $/gm) ?? []).length).toBeGreaterThanOrEqual(1);
    });

    test("a refused line comes back marked Not sent, and no Enter runs", async ({ page }) => {
      const s = newSession();
      await page.routeWebSocket(/\/ws/, (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((frame) => {
          const msg = typeof frame === "string" ? (JSON.parse(frame) as { type: string; data: { req: number; watch: number } }) : null;
          if (msg?.type === "paste") {
            ws.send(JSON.stringify({ type: "error", data: { req: msg.data.req, watch: msg.data.watch, code: "busy", message: "tether is busy, try again" } }));
            return;
          }
          server.send(frame);
        });
        server.onMessage((frame) => { ws.send(frame); });
      });
      await open(page, s);
      await paneIncludes(s, /\$ /);
      await sendLine(page, "echo never");
      await expect(page.getByRole("status").filter({ hasText: "Not sent: tether is busy, try again" })).toBeVisible();
      await expect(line(page)).toHaveValue("echo never");
      await page.waitForTimeout(500);
      expect(pane(s)).not.toContain("never");
    });

    test("every key-row key reaches tmux, and ctrl armed turns the next character into a chord", async ({ page }) => {
      const s = newSession();
      await open(page, s);
      await paneIncludes(s, /\$ /);
      // The toggle raises the keyboard for the terminal, and the key row comes with it.
      await expect(page.getByRole("group", { name: "Terminal keys" })).toHaveCount(0);
      await toggle(page).click();
      await expect(page.getByRole("group", { name: "Terminal keys" })).toBeVisible();
      await expect(toggle(page)).toHaveAccessibleName("Hide keyboard");

      const command = (): string => stack.tmux("display-message", "-p", "-t", s, "#{pane_current_command}").trim();
      // ^C interrupts a running command (the tty is still cooked here).
      await page.keyboard.type("sleep 100");
      await page.keyboard.press("Enter");
      await expect.poll(command).toBe("sleep");
      await key(page, "Control C").click();
      await expect.poll(command).not.toBe("sleep");

      // Everything else arrives as bytes the raw tty hands to cat -vt.
      await page.keyboard.type("stty raw -echo; cat -vt");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(400);
      for (const name of ["esc", "Up arrow", "Down arrow", "Control R", "tab"]) await key(page, name).click();
      await paneIncludes(s, "^[^[[A^[[B^R^I");
      for (const name of ["|", "~", "/", "-"]) await key(page, name).click();
      await paneIncludes(s, "|~/-");

      // An armed ctrl turns the next typed character into a chord, then disarms.
      stack.tmux("respawn-pane", "-k", "-t", s, "env PS1='$ ' sh");
      await page.keyboard.type("sleep 100");
      await page.keyboard.press("Enter");
      await expect.poll(command).toBe("sleep");
      await key(page, "ctrl").click();
      await expect(key(page, "ctrl")).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.type("c");
      await expect.poll(command).not.toBe("sleep");
      await expect(key(page, "ctrl")).toHaveAttribute("aria-pressed", "false");
    });

    test("the toggle lowers either keyboard, and a tap on the line field raises it for the field", async ({ page }) => {
      const s = newSession();
      await open(page, s);
      await toggle(page).click();
      await expect(owned(page)).toBeFocused();
      await line(page).click();
      await expect(line(page)).toBeFocused();
      await expect(page.getByRole("group", { name: "Terminal keys" })).toBeVisible();
      await expect(toggle(page)).toHaveAccessibleName("Hide keyboard");
      await toggle(page).click();
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
      await expect(page.getByRole("group", { name: "Terminal keys" })).toHaveCount(0);
      // A tap on the terminal changes nothing.
      await page.locator(".xterm-screen").click();
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
      await toggle(page).click();
      await page.locator(".xterm-screen").click();
      await expect(owned(page)).toBeFocused();
    });

    test("a held arrow stops sending when the key row goes away mid-hold", async ({ page }) => {
      const s = newSession();
      await open(page, s);
      const ups: number[] = [];
      await page.routeWebSocket(/\/ws/, (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((frame) => {
          if (typeof frame === "string" && frame.includes('"Up"')) ups.push(Date.now());
          server.send(frame);
        });
        server.onMessage((frame) => { ws.send(frame); });
      });
      await page.reload();
      await reopen(page, s);
      await toggle(page).click();
      const up = key(page, "Up arrow");
      const box = await up.boundingBox();
      if (!box) throw new Error("no Up key");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await expect.poll(() => ups.length, { timeout: 5_000 }).toBeGreaterThan(3); // repeating
      await toggle(page).evaluate((el: HTMLElement) => { el.click(); }); // the row unmounts with the key still held
      await expect(page.getByRole("group", { name: "Terminal keys" })).toHaveCount(0);
      const after = ups.length;
      await page.waitForTimeout(400);
      expect(ups.length).toBeLessThanOrEqual(after + 1);
      await page.mouse.up();
    });

    test("a character key lands in the line field at its caret while the field has the keyboard", async ({ page }) => {
      const s = newSession();
      await open(page, s);
      await raiseLine(page);
      await page.keyboard.type("ls ");
      await key(page, "/").click();
      await key(page, "-").click();
      await expect(line(page)).toHaveValue("ls /-");
      await expect(line(page)).toBeFocused();
    });

    test("a paste of several lines into the field goes to the terminal unsent", async ({ page }) => {
      const s = newSession();
      await open(page, s);
      await paneIncludes(s, /\$ /);
      await sendLine(page, "stty -echo; cat");
      await paneIncludes(s, /stty -echo/);
      await line(page).click();
      await line(page).evaluate((el) => {
        const data = new DataTransfer();
        data.setData("text/plain", "alpha\nbeta");
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      });
      await paneIncludes(s, /^alpha$/m);
      await page.waitForTimeout(300);
      expect(pane(s)).not.toMatch(/^beta$/m); // no Enter ran after the paste
      await expect(line(page)).toHaveValue("");
      await expect(page.getByText(/several lines/)).toBeVisible();
    });

    test("each tab keeps its own draft: a tab switch swaps it and a reload restores it", async ({ page }) => {
      const s = newSession("env PS1='$ ' sh", "swap");
      newSession("env PS1='$ ' sh", "twin");
      await open(page, s);
      await raiseLine(page);
      await page.keyboard.type("draft one");
      // The switcher's button replaces the key row: lower the keyboard to reach it. The draft stays.
      await toggle(page).click();
      // The second session's tab, from the switcher.
      await page.getByRole("button", { name: /, 1 tab, open sessions$/ }).click();
      const sheet = page.getByRole("dialog", { name: "Sessions" });
      await expect(sheet).toBeVisible();
      // A row switches the tab behind the sheet, which stays until it is closed.
      await sheet.getByRole("button", { name: /^twin \d+ window/ }).click();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await painted(page);
      await expect(draft(page)).toHaveValue("");
      await raiseLine(page);
      await page.keyboard.type("draft two");
      await page.waitForTimeout(500);
      await toggle(page).click();

      await page.getByRole("button", { name: /, 2 tabs, open sessions$/ }).click();
      await sheet.getByRole("button", { name: /^swap .*, (connected|open)$/ }).click();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(draft(page)).toHaveValue("draft one");

      await page.waitForTimeout(500);
      await page.reload();
      await reopen(page, s);
      await expect(draft(page)).toHaveValue("draft one");
    });

    test("the switcher: windows switch, the list opens a session, pills close, search filters, New session creates", async ({ page }) => {
      const s = newSession("env PS1='$ ' sh", "sw");
      stack.tmux("new-window", "-t", s, "-n", "shell", "env PS1='$ ' sh");
      stack.tmux("new-session", "-d", "-s", "other", "-x", "100", "-y", "30", "env PS1='$ ' sh");
      await open(page, s);
      const chip = page.getByRole("button", { name: /, \d+ tabs?, open sessions$/ });
      await chip.click();
      const sheet = page.getByRole("dialog", { name: "Sessions" });
      await expect(sheet).toBeVisible();
      // The session holding the active tab is marked "here".
      await expect(sheet.getByText("here")).toBeVisible();
      // The search is not focused, so opening never raises the keyboard.
      await expect(sheet.getByRole("searchbox")).not.toBeFocused();

      // The window rows of the active tab's session: choosing one moves the session's current window, and the tab stays one tab.
      await expect(sheet.getByRole("button", { name: /^1: shell/ })).toContainText("shown");
      await sheet.getByRole("button", { name: /^0: / }).click();
      await expect.poll(() => stack.tmux("display-message", "-p", "-t", s, "#{window_index}").trim()).toBe("0");

      // A row switches the tab behind the sheet, which stays until it is closed.
      await sheet.getByRole("searchbox").fill("oth");
      await expect(sheet.getByRole("button", { name: /^other \d+ window/ })).toBeVisible();
      await expect(sheet.getByRole("button", { name: /^sw \d+ windows/ })).toHaveCount(0);
      await sheet.getByRole("button", { name: /^other \d+ window/ }).click();
      await painted(page);
      await sheet.getByRole("searchbox").fill("");
      // "here" follows the tab on screen; the other open session reads "open".
      await expect(sheet.getByText("open", { exact: true })).toBeVisible();

      // Closing a tab from its pill leaves the sheet open and tmux alone.
      await sheet.getByRole("button", { name: /^Close other / }).first().click();
      await expect(page.getByRole("dialog", { name: "Sessions" })).toBeVisible();
      expect(stack.tmux("list-windows", "-t", s, "-F", "#{window_index}").trim().split("\n")).toHaveLength(2);

      await sheet.getByRole("button", { name: "New session or Browse files" }).click();
      await page.getByRole("button", { name: "New session", exact: true }).click();
      const create = page.getByRole("dialog", { name: "New session" });
      await create.getByLabel("Name").fill("made");
      await create.getByRole("button", { name: "Create" }).click();
      await expect.poll(() => stack.tmux("list-sessions", "-F", "#{session_name}")).toContain("made");
      await painted(page);
    });
  });
}
