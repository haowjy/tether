import { test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, label, openFixture, SCENARIOS, shot } from "./harness";

// Every route and every admission screen, in every layout, theme and density: renders with
// no console errors, passes axe (contrast included), and is photographed for the evidence.
const SCREENS: { name: string; fixture: string; hash: string; ready: string; act?: (page: Page) => Promise<void> }[] = [
  { name: "home", fixture: "restored", hash: "#/", ready: "h1:has-text('tether')" },
  { name: "files", fixture: "home", hash: "#/files", ready: 'main >> text="Files"' },
  { name: "terminal", fixture: "restored", hash: "#/terminal", ready: "[aria-current='true'], button[aria-label$='open sessions']" },
  { name: "terminal-live", fixture: "terminalLive", hash: "#/terminal", ready: ".xterm:not([data-blank] *)" },
  { name: "terminal-limited", fixture: "terminalLimited", hash: "#/terminal", ready: "text=allows 1 tmux session" },
  { name: "terminal-empty", fixture: "home", hash: "#/terminal", ready: "text=/Open a session (with \\+ or from Home|from Sessions)\\./" },
  { name: "enrol", fixture: "enrol", hash: "#/", ready: "text=Next" },
  { name: "wrong-origin", fixture: "wrongOrigin", hash: "#/", ready: "text=Open tether at" },
  { name: "origin-refused", fixture: "originRefused", hash: "#/", ready: "text=can't use" },
  { name: "node-refused", fixture: "nodeRefused", hash: "#/", ready: "text=can't admit this device" },
  { name: "incompatible", fixture: "incompatible", hash: "#/", ready: "text=speaks a different version" },
  { name: "offline", fixture: "unreachable", hash: "#/", ready: "text=Can\'t reach the server" },
  { name: "gallery", fixture: "gallery", hash: "#/", ready: "h1:has-text('Primitives')" },
  { name: "home-no-server", fixture: "noServer", hash: "#/", ready: "text=No tmux server is running" },
  { name: "home-many", fixture: "homeMany", hash: "#/", ready: "text=project-01" },
  { name: "home-empty-server", fixture: "emptyServer", hash: "#/", ready: "text=No sessions on" },
  { name: "home-offline-tabs", fixture: "offlineTabs", hash: "#/", ready: "text=Can't reach" },
  { name: "home-states", fixture: "homeStates", hash: "#/", ready: "h1:has-text('Sessions list states')" },
  { name: "home-update-ready", fixture: "updatable", hash: "#/", ready: "text=Update ready", act: (page) => page.evaluate(() => { window.__harness?.platform.setUpdate("ready"); }) },
  { name: "home-offline-launch", fixture: "offlineLaunch", hash: "#/", ready: "text=Can't reach" },
];

for (const scenario of SCENARIOS) {
  test.describe(label(scenario), () => {
    for (const screen of SCREENS) {
      test(screen.name, async ({ page }, testInfo) => {
        const opened = await openFixture(page, screen.fixture, scenario, screen.hash);
        await screen.act?.(page);
        await page.locator(screen.ready).first().waitFor();
        await expectAccessible(page);
        await expectNoHorizontalScroll(page);
        opened.expectNoConsoleErrors();
        await shot(page, screen.name, scenario, testInfo.project.name);
      });
    }
  });
}
