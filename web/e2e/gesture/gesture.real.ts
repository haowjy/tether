// Touch gestures against a real daemon on a private tmux (3.4 and 3.7b), at phone size with
// real touch input (CDP `Input.dispatchTouchEvent`, so the browser's own pointer pipeline,
// `touch-action` included, runs). Each assertion crosses the whole path and reads what the
// pane received with `tmux capture-pane` (client-architecture.md §7.6, §11, P3b). Chromium only:
// WebKit has no touch injection beyond a tap. The device-only checks (haptic, momentum feel,
// selection handles, the system back gesture) are in g3-iphone-checklist.md.
import { existsSync, readFileSync } from "node:fs";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { openSessionRow } from "../shared/home";
import { startStack, type Stack, type TmuxVersion } from "../shared/stack";

const VERSIONS = (process.env["TETHER_E2E_TMUX"] ?? "3.4,3.7b").split(",") as TmuxVersion[];

test.use({ viewport: { width: 393, height: 852 }, hasTouch: true });
test.skip(({ browserName }) => browserName !== "chromium", "touch injection needs CDP");

/** One finger on the page, in client pixels. */
class Finger {
  constructor(private readonly cdp: CDPSession, private readonly page: Page) {}
  async down(x: number, y: number): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  }
  async move(x: number, y: number): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  }
  async up(): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  /** Moves from (x0, y0) to (x1, y1) in `steps` events `gap` ms apart. */
  async drag(x0: number, y0: number, x1: number, y1: number, steps = 10, gap = 12): Promise<void> {
    for (let i = 1; i <= steps; i++) {
      await this.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
      await this.page.waitForTimeout(gap);
    }
  }
}

for (const version of VERSIONS) {
  test.describe(`tmux ${version}`, () => {
    test.describe.configure({ mode: "serial" });
    let stack: Stack;
    let sessions = 0;

    test.beforeAll(async () => {
      test.setTimeout(120_000);
      stack = await startStack({ tmux: version, name: `gesture-${test.info().project.name}-${version}`, memoryMiB: 72 });
    });
    test.afterAll(async () => { await stack.stop(); });

    function newSession(command = "env BASH_SILENCE_DEPRECATION_WARNING=1 PS1='$ ' bash --norc --noprofile"): string {
      const name = `g${String(++sessions)}`;
      stack.tmux("new-session", "-d", "-s", name, "-x", "100", "-y", "30", command);
      return name;
    }
    const pane = (session: string): string => stack.tmux("capture-pane", "-p", "-J", "-t", session);
    const paneIncludes = async (session: string, text: string | RegExp, timeout = 10_000): Promise<void> => {
      await expect.poll(() => pane(session), { timeout }).toMatch(typeof text === "string" ? new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : text);
    };
    const count = (session: string, needle: string): number => pane(session).split(needle).length - 1;

    async function open(page: Page, session: string): Promise<Finger> {
      await page.goto(`${stack.url}/#/`);
      await openSessionRow(page, session);
      await page.waitForFunction(() => { const host = document.querySelector(".xterm")?.parentElement; return host !== null && host !== undefined && !host.hasAttribute("data-blank"); });
      await page.waitForTimeout(400); // the snapshot's size settles
      return new Finger(await page.context().newCDPSession(page), page);
    }

    /** Where cell (col, row) is in client pixels, from the screen's box and the pane's size. */
    async function cellCentre(page: Page, session: string, col: number, row: number): Promise<{ x: number; y: number }> {
      const [cols, rows] = stack.tmux("display-message", "-p", "-t", session, "#{pane_width} #{pane_height}").trim().split(" ").map(Number);
      const box = await page.locator(".xterm-screen").boundingBox();
      if (!box || !cols || !rows) throw new Error("no screen");
      return { x: box.x + ((col + 0.5) * box.width) / cols, y: box.y + ((row + 0.5) * box.height) / rows };
    }

    /** The screen's centre column, `row` rows down. */
    const mid = async (page: Page, session: string, row = 5): Promise<{ x: number; y: number }> => {
      const [cols] = stack.tmux("display-message", "-p", "-t", session, "#{pane_width}").trim().split(" ").map(Number);
      return await cellCentre(page, session, Math.floor((cols ?? 40) / 2), row);
    };

    test("long-press highlights the word at once, dragging extends it by cell, release shows the menu, Copy copies, and no mouse event or key reaches the pane", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const s = newSession();
      const finger = await open(page, s);
      stack.tmux("send-keys", "-t", s, "echo alpha beta gamma", "Enter");
      await paneIncludes(s, /^alpha beta gamma$/m);
      const row = stack.tmux("capture-pane", "-p", "-t", s).split("\n").findIndex((l) => l === "alpha beta gamma");
      const start = await cellCentre(page, s, 2, row); // inside "alpha"
      const before = pane(s);
      await finger.down(start.x, start.y);
      await page.waitForTimeout(550);
      // Still held: the word is highlighted, the menu waits for the release.
      expect(await page.evaluate(() => getSelection()?.toString())).toBe("alpha");
      await expect(page.getByRole("menuitem", { name: "Copy" })).toHaveCount(0);
      const end = await cellCentre(page, s, 13, row); // the "m" of "gamma"
      await finger.drag(start.x, start.y, end.x, end.y, 6, 20);
      expect(await page.evaluate(() => getSelection()?.toString())).toBe("alpha beta gam");
      await finger.up();
      await expect(page.getByRole("menuitem", { name: "Copy" })).toBeVisible();
      await page.getByRole("menuitem", { name: "Copy" }).tap();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("alpha beta gam");
      expect(pane(s)).toBe(before);
    });

    test("long-press released over a word selects it, Copy puts it on the clipboard, and nothing reaches the pane", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const s = newSession();
      const finger = await open(page, s);
      stack.tmux("send-keys", "-t", s, "echo alpha beta gamma", "Enter");
      await paneIncludes(s, /^alpha beta gamma$/m);
      const row = stack.tmux("capture-pane", "-p", "-t", s).split("\n").findIndex((l) => l === "alpha beta gamma");
      const at = await cellCentre(page, s, 7, row); // inside "beta"
      const before = pane(s);
      await finger.down(at.x, at.y);
      await page.waitForTimeout(550);
      await finger.up();
      await expect(page.getByRole("menuitem", { name: "Copy" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Paste" })).toBeVisible();
      expect(await page.evaluate(() => getSelection()?.toString())).toBe("beta");
      await page.getByRole("menuitem", { name: "Copy" }).tap();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("beta");
      await expect(page.getByRole("menuitem", { name: "Copy" })).toHaveCount(0);
      expect(pane(s)).toBe(before);
    });

    test("Copy keeps the logical line across a soft wrap; a touch on the snapshot scrolls it and leaves the selection alone", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const s = newSession();
      stack.tmux("send-keys", "-t", s, "seq 1 60", "Enter");
      await paneIncludes(s, /^60$/m);
      const finger = await open(page, s);
      const words = Array.from({ length: 24 }, (_, i) => `word${String(i).padStart(2, "0")}`).join(" ");
      stack.tmux("send-keys", "-t", s, `echo '${words}'`, "Enter");
      await paneIncludes(s, /word23\n?/);
      const flat = stack.tmux("capture-pane", "-p", "-t", s).split("\n");
      const first = flat.findIndex((l) => l.startsWith("word00"));
      expect(first).toBeGreaterThanOrEqual(0);
      const at = await cellCentre(page, s, 2, first + 1); // a word on the continuation row
      await finger.down(at.x, at.y);
      await page.waitForTimeout(550);
      await finger.up();
      await expect(page.getByRole("menuitem", { name: "Copy" })).toBeVisible();
      const word = (await page.evaluate(() => getSelection()?.toString())) ?? "";
      expect(word.length).toBeGreaterThan(0);
      // The snapshot's own touches are the system's: a swipe scrolls its rows and neither ends selection nor reaches the pane.
      const layer = page.locator("[data-row]").first().locator("..");
      const scrollTop = (): Promise<number> => layer.evaluate((el) => el.scrollTop);
      const before = await scrollTop();
      expect(before).toBeGreaterThan(0);
      const grip = { x: 360, y: 450 }; // the right edge, clear of the edit menu
      await finger.down(grip.x, grip.y);
      await finger.drag(grip.x, grip.y, grip.x, grip.y + 150, 8, 12);
      await finger.up();
      await expect.poll(scrollTop).toBeLessThan(before);
      expect(await page.evaluate(() => getSelection()?.toString())).toBe(word);
      await expect(page.getByRole("menuitem", { name: "Copy" })).toBeVisible();
      // A handle drag is the selection's focus moving: extend it to the end of the line.
      await page.evaluate(() => {
        const rowEls = [...document.querySelectorAll<HTMLElement>("[data-row]")];
        const last = rowEls.findLast((r) => r.textContent.includes("word23"))?.firstChild;
        if (!last) throw new Error("row not found");
        getSelection()?.extend(last, (last.textContent ?? "").length);
      });
      await page.getByRole("menuitem", { name: "Copy" }).tap();
      expect(words.split(word)).toHaveLength(2);
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(words.slice(words.indexOf(word)));
    });

    test("a tap on the snapshot clears the selection and ends selection mode", async ({ page }) => {
      const s = newSession();
      const finger = await open(page, s);
      stack.tmux("send-keys", "-t", s, "echo alpha beta gamma", "Enter");
      await paneIncludes(s, /^alpha beta gamma$/m);
      const row = stack.tmux("capture-pane", "-p", "-t", s).split("\n").findIndex((l) => l === "alpha beta gamma");
      const at = await cellCentre(page, s, 7, row);
      await finger.down(at.x, at.y);
      await page.waitForTimeout(550);
      await finger.up();
      await expect(page.getByRole("menuitem", { name: "Copy" })).toBeVisible();
      const away = await cellCentre(page, s, 40, row + 3);
      await finger.down(away.x, away.y);
      await finger.up();
      await expect(page.locator("[data-row]")).toHaveCount(0);
      await expect(page.getByRole("menuitem", { name: "Copy" })).toHaveCount(0);
    });

    test("long-press released over a blank cell opens Paste alone, and Paste sends one paste without Enter", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const s = newSession("cat -vt");
      const finger = await open(page, s);
      await page.evaluate(() => navigator.clipboard.writeText("pasted-text"));
      const at = await mid(page, s, 12);
      await finger.down(at.x, at.y);
      await page.waitForTimeout(550);
      await finger.up();
      await expect(page.getByRole("menuitem", { name: "Paste" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Copy" })).toHaveCount(0);
      await page.getByRole("menuitem", { name: "Paste" }).tap();
      await paneIncludes(s, "pasted-text");
      expect(pane(s)).not.toMatch(/pasted-text\n.*pasted-text/);
      await expect(page.getByRole("menuitem", { name: "Paste" })).toHaveCount(0);
    });

    test("a tap in an application with mouse mode sends a click at the cell", async ({ page }) => {
      const mouse = newSession("sh -c \"printf '\\033[?1000h\\033[?1006h'; exec cat -vt\"");
      const finger = await open(page, mouse);
      const at = await cellCentre(page, mouse, 9, 7);
      await finger.down(at.x, at.y);
      await finger.up();
      await paneIncludes(mouse, "^[[<0;10;8M^[[<0;10;8m");
    });

    test("a tap on the cursor's row or one beside it raises the keyboard; a tap elsewhere or with it up never lowers it", async ({ page }) => {
      const shell = newSession();
      const finger = await open(page, shell);
      await paneIncludes(shell, /\$ /);
      const before = pane(shell);
      const keyboard = page.getByRole("textbox", { name: "Terminal keyboard" });
      const far = await mid(page, shell, 8);
      await finger.down(far.x, far.y);
      await finger.up();
      await page.waitForTimeout(500);
      expect(pane(shell)).toBe(before);
      await expect(keyboard).not.toBeFocused();
      const below = await mid(page, shell, 1); // the row under the prompt
      await finger.down(below.x, below.y);
      await finger.up();
      await expect(keyboard).toBeFocused();
      // With the keyboard up, a tap far away keeps it up.
      await finger.down(far.x, far.y);
      await finger.up();
      await expect(keyboard).toBeFocused();
    });

    test("a tap in vim with mouse on moves the cursor", async ({ page }) => {
      const file = `${stack.dir}/vim-text`;
      const out = `${stack.dir}/vim-pos`;
      const s = newSession(`sh -c "printf 'one\\ntwo\\nthree is longer\\nfour\\n' > ${file}; exec vim -u NONE -N -c 'set mouse=a' ${file}"`);
      const finger = await open(page, s);
      await paneIncludes(s, /three is longer/);
      const at = await cellCentre(page, s, 6, 2);
      await finger.down(at.x, at.y);
      await finger.up();
      await page.waitForTimeout(300);
      stack.tmux("send-keys", "-t", s, ":call writefile([line('.') . ':' . col('.')], '" + out + "')", "Enter");
      await expect.poll(() => (existsSync(out) ? readFileSync(out, "utf8").trim() : ""), { timeout: 10_000 }).toBe("3:7");
    });

    test("a vertical swipe scrolls the buffer and tmux's history with momentum, and Jump to latest returns", async ({ page }) => {
      const s = newSession();
      stack.tmux("send-keys", "-t", s, "seq 1 400 | sed 's/^/row /'", "Enter");
      await paneIncludes(s, /row 400/);
      const finger = await open(page, s); // opened after: all of it is tmux's history, none of xterm's
      const at = await mid(page, s, 4);
      await expect(page.getByRole("button", { name: "Jump to latest" })).toHaveCount(0);
      for (let i = 0; i < 6; i++) {
        await finger.down(at.x, at.y);
        await finger.drag(at.x, at.y, at.x, at.y + 300, 8, 6);
        await finger.up();
        await page.waitForTimeout(700);
      }
      await expect(page.getByRole("button", { name: "Jump to latest" })).toBeVisible();
      const history = await page.locator("[data-history]").innerText();
      expect(history).toMatch(/row 3\d\d/);
      // Momentum: a flick keeps going after the finger lifts.
      const top = async (): Promise<number> => (await page.locator("[data-history]").boundingBox())?.y ?? 0;
      await finger.down(at.x, at.y + 200);
      await finger.drag(at.x, at.y + 200, at.x, at.y + 380, 6, 8);
      await finger.up();
      const lifted = await top();
      await page.waitForTimeout(120);
      const later = await top();
      expect(later).toBeGreaterThan(lifted);
      await page.getByRole("button", { name: "Jump to latest" }).tap();
      await expect(page.getByRole("button", { name: "Jump to latest" })).toHaveCount(0);
    });

    test("horizontal swipes send nothing", async ({ page }) => {
      const cat = newSession("cat -vt");
      const catFinger = await open(page, cat);
      const where = await mid(page, cat);
      await catFinger.down(where.x - 100, where.y);
      await catFinger.drag(where.x - 100, where.y, where.x + 120, where.y + 6, 8, 12);
      await page.waitForTimeout(700);
      await catFinger.up();
      await page.waitForTimeout(400);
      expect(pane(cat).trim()).toBe("");
    });

    test("in a full-screen application a swipe sends ↑/↓", async ({ page }) => {
      const alt = newSession("sh -c \"printf '\\033[?1049h'; exec cat -vt\"");
      const finger = await open(page, alt);
      const at = await mid(page, alt);
      await finger.down(at.x, at.y);
      await finger.drag(at.x, at.y, at.x, at.y + 160, 8, 10);
      await finger.up();
      await paneIncludes(alt, "^[[A");
      expect(pane(alt)).not.toContain("^[[<");
    });

    test("with mouse mode a swipe sends wheel events", async ({ page }) => {
      const wheel = newSession("sh -c \"printf '\\033[?1049h\\033[?1000h\\033[?1006h'; exec cat -vt\"");
      const wheelFinger = await open(page, wheel);
      const at = await mid(page, wheel);
      await wheelFinger.down(at.x, at.y);
      await wheelFinger.drag(at.x, at.y, at.x, at.y + 160, 8, 10);
      await wheelFinger.up();
      await paneIncludes(wheel, /\^\[\[<64;\d+;\d+M/);
      expect(pane(wheel)).not.toContain("^[[A");
    });

    test("a coast stops when the tab changes: the next tab's pane gets no arrows", async ({ page }) => {
      const s = newSession("sh -c \"printf '\\033[?1049h'; exec cat -vt\"");
      const next = newSession("cat -vt");
      const finger = await open(page, s);
      const at = await mid(page, s);
      // A hard flick: the full-screen application's coast sends arrows for seconds.
      await finger.down(at.x, at.y);
      await finger.drag(at.x, at.y, at.x, at.y + 200, 5, 6);
      await finger.up();
      await paneIncludes(s, "^[[A");
      await page.getByRole("button", { name: /, 1 tab, open sessions and files$/ }).tap();
      const sheet = page.getByRole("dialog", { name: "Open" });
      await sheet.getByRole("button", { name: new RegExp(`^${next} \\d+ window`) }).tap();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      const sent = count(s, "^[[A");
      await page.waitForTimeout(2500);
      expect(pane(next)).not.toContain("^[[");
      // The coast ended with the switch: the first session's count has stopped growing too.
      const settled = count(s, "^[[A");
      await page.waitForTimeout(500);
      expect(count(s, "^[[A")).toBe(settled);
      expect(settled).toBeGreaterThanOrEqual(sent);
    });

    test("a long-press more than 2,000 rows above the newest line still selects there", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const s = newSession();
      const finger = await open(page, s);
      // 3,500 rows arrive live, so they are xterm's own scrollback (5,000 rows), not tmux's history.
      stack.tmux("send-keys", "-t", s, "seq 1 3500 | sed 's/^/row /'", "Enter");
      await paneIncludes(s, /row 3500/);
      await page.waitForTimeout(500);
      const box = await page.locator(".xterm-screen").boundingBox();
      if (!box) throw new Error("no screen");
      // 2,200 rows up: past the 2,000 a snapshot keeps above the newest line.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      // xterm takes about three rows from a wheel event, whatever its size.
      for (let i = 0; i < 800; i++) await page.mouse.wheel(0, -100);
      await page.waitForTimeout(500);
      const at = await cellCentre(page, s, 6, 4); // inside the number of "row N"
      await finger.down(at.x, at.y);
      await page.waitForTimeout(550);
      await finger.up();
      await expect(page.getByRole("menuitem", { name: "Copy" })).toBeVisible();
      const picked = Number(await page.evaluate(() => getSelection()?.toString() ?? ""));
      expect(picked).toBeGreaterThan(500);
      expect(picked).toBeLessThan(1500);
      await page.getByRole("menuitem", { name: "Copy" }).tap();
      await expect(page.getByRole("menuitem", { name: "Copy" })).toHaveCount(0);
    });

    test.describe("a mouse wheel on a desktop", () => {
      test.use({ viewport: { width: 1100, height: 800 }, hasTouch: false });

      test("scrolls xterm's buffer, then on past its top into tmux's history; Jump to latest follows", async ({ page }) => {
        const s = newSession();
        stack.tmux("send-keys", "-t", s, "seq 1 400 | sed 's/^/row /'", "Enter");
        await paneIncludes(s, /row 400/);
        await open(page, s); // all of it is tmux's history, none of xterm's
        const jump = page.getByRole("button", { name: "Jump to latest" });
        await expect(jump).toHaveCount(0);
        const box = await page.locator(".xterm-screen").boundingBox();
        if (!box) throw new Error("no screen");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        for (let i = 0; i < 12; i++) {
          await page.mouse.wheel(0, -400);
          await page.waitForTimeout(150);
        }
        await expect(jump).toBeVisible();
        await expect.poll(() => page.locator("[data-history]").innerText()).toMatch(/row 3\d\d/);
        // xterm's own buffer scrolls too: new output gives it rows, and a wheel inside them shows the control.
        await jump.click();
        await expect(jump).toHaveCount(0);
        stack.tmux("send-keys", "-t", s, "seq 1 100", "Enter");
        await paneIncludes(s, /^100$/m);
        await page.waitForTimeout(300);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -200);
        await expect(jump).toBeVisible();
        await expect(page.locator("[data-history]")).toBeHidden();
        for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 600);
        await expect(jump).toHaveCount(0);
      });
    });
  });
}
