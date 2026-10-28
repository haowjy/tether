// The terminal against a real daemon on a private tmux (3.4 and 3.7b), in Chromium and WebKit
// (client-architecture.md §11, W2). Each group starts its own isolated stack (e2e/shared/stack.ts)
// and checks what the pane received with `tmux capture-pane`, so every assertion crosses the
// whole path: key handler, protocol, daemon, tmux.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { startStack, type Laptop, type Stack, type TmuxVersion } from "../shared/stack";

const VERSIONS = (process.env["TETHER_E2E_TMUX"] ?? "3.4,3.7b").split(",") as TmuxVersion[];
const DESKTOP = { width: 1440, height: 900 };

for (const version of VERSIONS) {
  test.describe(`tmux ${version}`, () => {
    test.describe.configure({ mode: "serial" });
    let stack: Stack;
    let sessions = 0;

    // One tmux session at a time is what the daemon's 58 MiB tier admits: a second watcher is refused with its message.
    test.beforeAll(async () => {
      // Starting a daemon and a dev server, cold, takes a while on a busy machine.
      test.setTimeout(120_000);
      stack = await startStack({ tmux: version, name: `${test.info().project.name}-${version}`, memoryMiB: 58 });
    });
    test.afterAll(async () => { await stack.stop(); });

    /** A fresh session running a plain `sh`, so the prompt is `$ ` whatever the machine's shell is. */
    function newSession(command = "env PS1='$ ' sh"): string {
      const name = `s${String(++sessions)}`;
      stack.tmux("new-session", "-d", "-s", name, "-x", "100", "-y", "30", command);
      return name;
    }
    const pane = (session: string): string => stack.tmux("capture-pane", "-p", "-J", "-t", session);
    const paneIncludes = async (session: string, text: string | RegExp, timeout = 10_000): Promise<void> => {
      await expect.poll(() => pane(session), { timeout }).toMatch(typeof text === "string" ? new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : text);
    };

    /** Opens `session` from Home and waits until the tab is connected and holds the focus. */
    async function openTerminal(page: Page, session: string, connected = true, viewport = DESKTOP): Promise<void> {
      await page.setViewportSize(viewport);
      await page.goto(`${stack.url}/#/`);
      // The desktop + popover lists every session without opening one first; Home's card row lands on the
      // first session, which would hold this tier's single watcher.
      await page.getByRole("button", { name: "Open a session or folder" }).click();
      await page.getByRole("dialog", { name: "Open" }).getByRole("button", { name: new RegExp(`^${session} \\d+ windows?`) }).first().click();
      if (connected) {
        // Let the tab connect (and register its input) behind the open popover, so closing it hands the
        // keyboard to the terminal rather than the + it opened from.
        await expect(page.locator("[aria-current='true']").first()).toHaveAttribute("aria-label", /, connected$/);
      }
      await page.keyboard.press("Escape");
      if (!connected) {
        await expect(page.locator("[aria-current='true']").first()).toBeVisible();
        return;
      }
      await expect(page.locator("[aria-current='true']").first()).toHaveAttribute("aria-label", /, connected$/);
      await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
      // The prompt is drawn once the first snapshot has been applied.
      await paneIncludes(session, /\$ /);
    }

    test("types into the pane, and the tab stays the active pill", async ({ page }) => {
      const s = newSession();
      await openTerminal(page, s);
      await page.keyboard.type("echo typed-ok");
      await page.keyboard.press("Enter");
      await paneIncludes(s, /^typed-ok$/m);
      await expect(page.locator("[aria-current='true']")).toHaveAttribute("aria-label", new RegExp(`^${s} `));
    });

    test("routes named keys by name: vim and less", async ({ page }) => {
      const s = newSession();
      const file = path.join(stack.dir, `vim-${s}.txt`);
      writeFileSync(file, "\n");
      await openTerminal(page, s);
      await page.keyboard.type(`vim -u NONE -N ${file}`);
      await page.keyboard.press("Enter");
      await paneIncludes(s, /^~/m);
      await page.keyboard.type("ihello");
      await page.keyboard.press("Escape");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.type("x");
      await page.keyboard.type(":wq");
      await page.keyboard.press("Enter");
      // hello, Escape leaves the cursor on the last "o"; two Lefts reach the second "l"; x removes it.
      await expect.poll(() => readFileSync(file, "utf8")).toBe("helo\n");

      const list = path.join(stack.dir, `less-${s}.txt`);
      writeFileSync(list, Array.from({ length: 200 }, (_, i) => String(i + 1)).join("\n") + "\n");
      await page.keyboard.type(`less ${list}`);
      await page.keyboard.press("Enter");
      await paneIncludes(s, /^1$/m);
      await page.keyboard.press("PageDown");
      await expect.poll(() => Number(pane(s).split("\n")[0])).toBeGreaterThan(20);
      await page.keyboard.press("End");
      await paneIncludes(s, /\(END\)/);
      await page.keyboard.press("Home");
      await expect.poll(() => pane(s).split("\n")[0]).toBe("1");
      await page.keyboard.type("q");
      await paneIncludes(s, /\$ $/m);
    });

    test("Shift+Enter reaches cat -v as ^[[13;2u exactly once", async ({ page }) => {
      const s = newSession();
      await openTerminal(page, s);
      await page.keyboard.type("stty -echo; echo READY; cat -v");
      await page.keyboard.press("Enter");
      await paneIncludes(s, /^READY$/m);
      await page.keyboard.press("Shift+Enter");
      await page.keyboard.press("Enter");
      await paneIncludes(s, /\^\[\[13;2u/);
      expect(pane(s).match(/\^\[\[13;2u/g)).toHaveLength(1);
    });

    test("an IME keeps its arrows while composing, and the committed text arrives", async ({ page }) => {
      const s = newSession();
      await openTerminal(page, s);
      await page.keyboard.type("echo READY; cat");
      await page.keyboard.press("Enter");
      await paneIncludes(s, /^READY$/m);
      const prevented = await page.evaluate(() => {
        const ta = document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
        if (!ta) throw new Error("no xterm textarea");
        const composition = (type: string, data: string): void => { ta.dispatchEvent(new CompositionEvent(type, { data, bubbles: true })); };
        const results: boolean[] = [];
        composition("compositionstart", "");
        ta.value = "にほん";
        composition("compositionupdate", "にほん");
        // Candidate selection: the IME's arrows, Enter and Escape reach the page as keydowns with isComposing.
        for (const key of ["ArrowDown", "ArrowDown", "ArrowUp", "Escape"]) {
          const event = new KeyboardEvent("keydown", { key, keyCode: 229, isComposing: true, bubbles: true, cancelable: true });
          ta.dispatchEvent(event);
          results.push(event.defaultPrevented);
        }
        ta.value = "日本";
        composition("compositionupdate", "日本");
        composition("compositionend", "日本");
        return results;
      });
      // The handler cancelled none of them, and tmux was sent nothing for them.
      expect(prevented).toEqual([false, false, false, false]);
      await paneIncludes(s, /日本/);
      expect(pane(s)).not.toContain("^[");
    });

    for (const bracketed of [true, false]) {
      test(`a paste with bracketed paste ${bracketed ? "on" : "off"} is never double-bracketed`, async ({ page }) => {
        const s = newSession();
        await openTerminal(page, s);
        await page.keyboard.type(`stty -echo; ${bracketed ? "printf '\\033[?2004h'; " : ""}echo READY; cat -v`);
        await page.keyboard.press("Enter");
        await paneIncludes(s, /^READY$/m);
        await page.evaluate(() => {
          const ta = document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
          const data = new DataTransfer();
          data.setData("text/plain", "pasted words");
          ta?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        });
        await page.keyboard.press("Enter");
        await paneIncludes(s, /pasted words/);
        const markers = pane(s).match(/\^\[\[20[01]~/g) ?? [];
        expect(markers).toHaveLength(bracketed ? 2 : 0);
        if (bracketed) expect(pane(s)).toMatch(/\^\[\[200~pasted words\^\[\[201~/);
      });
    }

    test("a 300 KiB paste is refused before anything is sent", async ({ page }) => {
      const s = newSession();
      await openTerminal(page, s);
      await page.keyboard.type("stty -echo; echo READY; cat");
      await page.keyboard.press("Enter");
      await paneIncludes(s, /^READY$/m);
      await page.evaluate(() => {
        const ta = document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
        const data = new DataTransfer();
        data.setData("text/plain", "Z".repeat(300 * 1024));
        ta?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      });
      await expect(page.getByText("Too large to paste (300 KiB; the limit is 256 KiB)")).toBeVisible();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
      expect(pane(s)).not.toContain("ZZZZ");
    });

    test("a session over the daemon's limit is refused with its message, and Retry succeeds once the other closes", async ({ page, browser }) => {
      const first = newSession();
      const second = newSession();
      // Another tether window holds the one tmux session this tier allows.
      const other = await signedIn(browser);
      await openTerminal(other, first);

      await openTerminal(page, second, false);
      const band = page.getByRole("status").filter({ hasText: "tmux session" });
      await expect(band).toContainText(/allows 1 tmux session at a time; open now: s\d+/);
      await expect(band).toContainText("Close tabs from other sessions");
      await expect(page.locator("[aria-current='true']").first()).toHaveAttribute("aria-label", /session limit$/);

      await other.context().close();
      await band.getByRole("button", { name: "Retry" }).click();
      await expect(page.locator("[aria-current='true']").first()).toHaveAttribute("aria-label", /, connected$/, { timeout: 15_000 });
      await expect(band).toHaveCount(0);
    });

    /** A second tether window: its own browser context, so its saved workspace is its own. */
    async function signedIn(browser: Browser): Promise<Page> {
      const context = await browser.newContext({ viewport: DESKTOP });
      return await context.newPage();
    }

    test("reconnects after a socket kill and takes input again", async ({ page }) => {
      const s = newSession();
      await openTerminal(page, s);
      await page.keyboard.type("echo before");
      await page.keyboard.press("Enter");
      await paneIncludes(s, /^before$/m);

      const dropped = stack.dropSockets();
      expect(dropped).toBeGreaterThan(0);
      await page.waitForFunction(() => /reconnecting|connecting/.test(document.querySelector("[aria-current='true']")?.getAttribute("aria-label") ?? ""), undefined, { polling: "raf" });
      await expect(page.locator("[aria-current='true']").first()).toHaveAttribute("aria-label", /, connected$/, { timeout: 15_000 });
      await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
      await page.keyboard.type("echo after");
      await page.keyboard.press("Enter");
      await paneIncludes(s, /^after$/m);
    });

    // Window size follows the client that acted last (daemon-core.md §3.6; client-architecture.md §5.4).
    {
      const SMALL = { width: 900, height: 600 };
      const windowSize = (s: string): string => stack.tmux("display-message", "-p", "-t", s, "#{window_width}x#{window_height}").trim();
      /**
       * Types in the laptop until the window is its size. The daemon sees an act a second after it,
       * and a key in the same second as the last reported act shows only with the next one. Returns
       * when the window was seen at `size`.
       */
      async function takeWindow(s: string, laptop: Laptop, size: string, line: string): Promise<number> {
        laptop.type(line);
        const deadline = Date.now() + 15_000;
        for (let nudged = Date.now(); Date.now() < deadline; await new Promise((r) => setTimeout(r, 50))) {
          if (windowSize(s) === size) return Date.now();
          if (Date.now() - nudged >= 1100) {
            laptop.type("\r");
            nudged = Date.now();
          }
        }
        throw new Error(`the window never became ${size}`);
      }
      const band = (page: Page) => page.getByRole("status").filter({ hasText: "Sized for another terminal" });
      /** What xterm draws: its row count and the transform that pans it. */
      const drawn = (page: Page) => page.evaluate(() => {
        const term = document.querySelector<HTMLElement>(".xterm");
        const screen = document.querySelector<HTMLElement>(".xterm-screen");
        return {
          rows: document.querySelectorAll(".xterm-rows > div").length,
          canvases: document.querySelectorAll(".xterm-screen canvas").length,
          transform: term?.style.transform ?? "",
          left: screen?.getBoundingClientRect().left ?? -1,
          width: screen?.getBoundingClientRect().width ?? 0,
          height: screen?.getBoundingClientRect().height ?? 0,
          hostHeight: term?.parentElement?.getBoundingClientRect().height ?? 0,
          hostWidth: term?.parentElement?.getBoundingClientRect().width ?? 0,
        };
      });

      test("a larger pane is drawn at the tab's font, clipped, with the band after 1 s; Fit takes the window back", async ({ page }) => {
        const s = newSession();
        await openTerminal(page, s, true, SMALL);
        await expect.poll(() => windowSize(s)).not.toBe("100x30");
        const phone = windowSize(s);
        const laptop = await stack.attach(s, { cols: 250, rows: 70 });
        try {
          const since = await takeWindow(s, laptop, "250x69", "seq 1 100\r");
          await expect(band(page)).toBeVisible();
          expect(Date.now() - since).toBeGreaterThanOrEqual(800);
          const view = await drawn(page);
          expect(view.rows).toBe(69);
          expect(view.canvases).toBe(0); // the DOM renderer while larger
          expect(view.left).toBeLessThanOrEqual(view.hostWidth); // pinned left
          expect(view.width).toBeGreaterThan(view.hostWidth); // clipped on the right, never scaled
          // seq filled the pane, so the cursor is on the last row and the pan follows it.
          expect(view.transform).toMatch(/translateY\(-\d+/);
          // Scrolled into history, the pan anchors to the top. The snapshot holds the visible pane only, so more output pushes rows into it.
          laptop.type("seq 1 10\r");
          await page.locator(".xterm-screen").hover();
          await expect.poll(async () => {
            await page.mouse.wheel(0, -400);
            return (await drawn(page)).transform;
          }).toBe("");

          await band(page).getByRole("button", { name: "Fit" }).click();
          await expect.poll(() => windowSize(s)).toBe(phone);
          await expect(band(page)).toHaveCount(0);
        } finally {
          laptop.detach();
        }
      });

      test("a smaller pane sits top-left, with the band after 1 s; Fit takes the window back", async ({ page }) => {
        const s = newSession();
        await openTerminal(page, s, true, SMALL);
        await expect.poll(() => windowSize(s)).not.toBe("100x30");
        const phone = windowSize(s);
        const laptop = await stack.attach(s, { cols: 60, rows: 20 });
        try {
          const since = await takeWindow(s, laptop, "60x19", "echo hi\r");
          // 19 rows of a box that holds 30 or so.
          await expect.poll(async () => { const v = await drawn(page); return v.height < v.hostHeight * 0.7; }).toBe(true);
          const view = await drawn(page);
          expect(view.width).toBeLessThan(view.hostWidth);
          expect(view.transform).toBe("");
          // The band says so for a smaller window as for a larger one.
          await expect(band(page)).toBeVisible();
          expect(Date.now() - since).toBeGreaterThanOrEqual(800);

          await band(page).getByRole("button", { name: "Fit" }).click();
          await expect.poll(() => windowSize(s)).toBe(phone);
          await expect(band(page)).toHaveCount(0);
        } finally {
          laptop.detach();
        }
      });

      test("a reconnect leaves the laptop's size; typing in the tab claims it again", async ({ page }) => {
        const s = newSession();
        await openTerminal(page, s, true, SMALL);
        await expect.poll(() => windowSize(s)).not.toBe("100x30");
        const phone = windowSize(s);
        const laptop = await stack.attach(s, { cols: 250, rows: 70 });
        try {
          await takeWindow(s, laptop, "250x69", "echo laptop\r");
          await expect(band(page)).toBeVisible();

          const sent: string[] = [];
          page.on("websocket", (ws) => {
            ws.on("framesent", (frame) => { if (typeof frame.payload === "string") sent.push(frame.payload); });
          });
          expect(stack.dropSockets()).toBeGreaterThan(0);
          await expect(page.locator("[aria-current='true']").first()).toHaveAttribute("aria-label", /, connected$/, { timeout: 15_000 });
          await page.waitForTimeout(1000);
          const watches = sent.filter((m) => m.includes('"type":"watch"'));
          expect(watches.length).toBeGreaterThan(0);
          expect(watches.every((m) => m.includes('"claim":false'))).toBe(true);
          expect(sent.some((m) => m.includes('"type":"resize"'))).toBe(false);
          expect(windowSize(s)).toBe("250x69");
          await expect(band(page)).toBeVisible();

          await page.keyboard.type("echo phone");
          await expect.poll(() => windowSize(s)).toBe(phone);
        } finally {
          laptop.detach();
        }
      });
    }

    test("dragging the window edge resizes tmux once", async ({ page }) => {
      const s = newSession();
      let resizes = 0;
      page.on("websocket", (ws) => {
        ws.on("framesent", (frame) => {
          if (typeof frame.payload === "string" && frame.payload.includes('"type":"resize"')) resizes++;
        });
      });
      await openTerminal(page, s);
      await page.waitForTimeout(600);
      const before = stack.tmux("display-message", "-p", "-t", s, "#{window_width}x#{window_height}").trim();
      resizes = 0;
      // A drag is many resizes, each well inside the 150 ms the sizer waits for. A loaded machine can
      // stretch one step past it, and each such pause may rightly send once more.
      const stamps: number[] = [];
      for (let width = 1400; width >= 1000; width -= 25) {
        await page.setViewportSize({ width, height: DESKTOP.height });
        stamps.push(Date.now());
      }
      await page.waitForTimeout(700);
      const pauses = stamps.slice(1).filter((t, i) => t - (stamps[i] ?? t) >= 150).length;
      const after = stack.tmux("display-message", "-p", "-t", s, "#{window_width}x#{window_height}").trim();
      expect(after).not.toBe(before);
      expect(resizes).toBeGreaterThanOrEqual(1);
      expect(resizes).toBeLessThanOrEqual(1 + pauses);
    });
  });
}
