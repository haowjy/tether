import { test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, label, openFixture, SCENARIOS, shot } from "./harness";

// Every route and every admission screen, in every layout, theme and density: renders with
// no console errors, passes axe (contrast included), and is photographed for the evidence.
const SCREENS: { name: string; fixture: string; hash: string; ready: string }[] = [
  { name: "home", fixture: "restored", hash: "#/", ready: "h1:has-text('tether')" },
  { name: "files", fixture: "home", hash: "#/files", ready: 'main >> text="Files"' },
  { name: "terminal", fixture: "restored", hash: "#/terminal", ready: "[aria-current='true']" },
  { name: "terminal-live", fixture: "terminalLive", hash: "#/terminal", ready: ".xterm:not([data-blank] *)" },
  { name: "terminal-limited", fixture: "terminalLimited", hash: "#/terminal", ready: "text=allows 1 tmux session" },
  { name: "terminal-empty", fixture: "home", hash: "#/terminal", ready: "text=Open a window with + or from Home." },
  { name: "enrol", fixture: "enrol", hash: "#/", ready: "text=Enrol this device" },
  { name: "wrong-origin", fixture: "wrongOrigin", hash: "#/", ready: "text=Open tether at" },
  { name: "origin-refused", fixture: "originRefused", hash: "#/", ready: "text=can't use" },
  { name: "node-refused", fixture: "nodeRefused", hash: "#/", ready: "text=can't admit this device" },
  { name: "incompatible", fixture: "incompatible", hash: "#/", ready: "text=speaks a different version" },
  { name: "offline", fixture: "unreachable", hash: "#/", ready: "text=Can\'t reach the server" },
  { name: "gallery", fixture: "gallery", hash: "#/", ready: "h1:has-text('Primitives')" },
];

for (const scenario of SCENARIOS) {
  test.describe(label(scenario), () => {
    for (const screen of SCREENS) {
      test(screen.name, async ({ page }, testInfo) => {
        const opened = await openFixture(page, screen.fixture, scenario, screen.hash);
        await page.locator(screen.ready).first().waitFor();
        await expectAccessible(page);
        await expectNoHorizontalScroll(page);
        opened.expectNoConsoleErrors();
        await shot(page, screen.name, scenario, testInfo.project.name);
      });
    }
  });
}
