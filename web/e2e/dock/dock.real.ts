// The phone dock against a real daemon on a private tmux (3.4 and 3.7b), at phone size with a
// coarse pointer, so the app takes the owned input and the dock (client-architecture.md §11,
// P3a). Each assertion crosses the whole path (dock, protocol, daemon, tmux) and reads what the
// pane received with `tmux capture-pane`. The iOS Simulator probes (keyboard geometry, cues) are
// by hand: Playwright has no software keyboard.
import { expect, test, type Locator, type Page } from "@playwright/test";
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
    const owned = (page: Page): Locator => page.getByRole("textbox", { name: "Terminal keyboard" });
    const toggle = (page: Page): Locator => page.getByRole("button", { name: /^(Show|Hide) keyboard$/ });
    const key = (page: Page, name: string): Locator => page.getByRole("group", { name: "Terminal keys" }).getByRole("button", { name, exact: true });

    /** Opens `session` from Home and waits until the tab is painted. */
    async function open(page: Page, session: string): Promise<void> {
      await page.goto(`${stack.url}/#/`);
      await page.getByRole("button", { name: new RegExp(`^${session}\\b`) }).click();
      await painted(page);
    }
    async function painted(page: Page): Promise<void> {
      await page.waitForFunction(() => { const host = document.querySelector(".xterm")?.parentElement; return host !== null && host !== undefined && !host.hasAttribute("data-blank"); });
    }

    async function sendLine(page: Page, text: string): Promise<void> {
      await line(page).click();
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
      await painted(page);
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
      await line(page).click();
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
      await line(page).click();
      await page.keyboard.type("draft one");
      // The second session's tab, from the switcher.
      await page.getByRole("button", { name: /, 1 tab, open sessions$/ }).click();
      const sheet = page.getByRole("dialog", { name: "Sessions" });
      await expect(sheet).toBeVisible();
      await sheet.getByRole("button", { name: /^twin \d+ window/ }).click();
      await expect(sheet).toBeHidden();
      await painted(page);
      await expect(line(page)).toHaveValue("");
      await line(page).click();
      await page.keyboard.type("draft two");
      await page.waitForTimeout(500);

      await page.getByRole("button", { name: /, 2 tabs, open sessions$/ }).click();
      await sheet.getByRole("button", { name: /^swap .*, (connected|open)$/ }).click();
      await expect(sheet).toBeHidden();
      await expect(line(page)).toHaveValue("draft one");

      await page.waitForTimeout(500);
      await page.reload();
      await expect(line(page)).toHaveValue("draft one");
    });

    test("the keyboard comes back to the input that held it after a pill tap, a close and the backdrop", async ({ page }) => {
      const s = newSession("env PS1='$ ' sh", "back");
      await open(page, s);
      const sheet = page.getByRole("dialog", { name: "Sessions" });
      const chip = page.getByRole("button", { name: /, \d+ tabs?, open sessions$/ });
      const pill = sheet.getByRole("button", { name: /^back .*, (connected|open)$/ }).first();

      await toggle(page).click();
      await expect(owned(page)).toBeFocused();
      await chip.click();
      await expect(sheet).toBeVisible();
      await pill.click(); // the active tab's own pill: it only closes the sheet
      await expect(sheet).toBeHidden();
      await expect(owned(page)).toBeFocused();

      await line(page).click();
      await chip.click();
      await sheet.getByRole("button", { name: "Close", exact: true }).click();
      await expect(sheet).toBeHidden();
      await expect(line(page)).toBeFocused();

      await chip.click();
      await page.mouse.click(5, 5); // the backdrop, above the sheet
      await expect(sheet).toBeHidden();
      await expect(line(page)).toBeFocused();
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
      await expect(sheet).toBeHidden();
      await expect.poll(() => stack.tmux("display-message", "-p", "-t", s, "#{window_index}").trim()).toBe("0");
      await expect(page.getByRole("button", { name: /, 1 tab, open sessions$/ })).toBeVisible();

      await chip.click();
      await sheet.getByRole("searchbox").fill("oth");
      await expect(sheet.getByRole("button", { name: /^other \d+ window/ })).toBeVisible();
      await expect(sheet.getByRole("button", { name: /^sw \d+ windows/ })).toHaveCount(0);
      await sheet.getByRole("button", { name: /^other \d+ window/ }).click();
      await expect(sheet).toBeHidden();
      await painted(page);
      await expect(page.getByRole("button", { name: /, 2 tabs, open sessions$/ })).toBeVisible();

      await chip.click();
      await expect(sheet.getByText("open", { exact: true })).toBeVisible();
      await sheet.getByRole("searchbox").fill("");

      // Closing a tab from its pill leaves the sheet open and tmux alone.
      await sheet.getByRole("button", { name: /^Close sw / }).first().click();
      await expect(page.getByRole("dialog", { name: "Sessions" })).toBeVisible();
      expect(stack.tmux("list-windows", "-t", s, "-F", "#{window_index}").trim().split("\n")).toHaveLength(2);

      await sheet.getByRole("button", { name: "New session" }).click();
      const create = page.getByRole("dialog", { name: "New session" });
      await create.getByLabel("Name").fill("made");
      await create.getByRole("button", { name: "Create" }).click();
      await expect.poll(() => stack.tmux("list-sessions", "-F", "#{session_name}")).toContain("made");
      await painted(page);
    });
  });
}
