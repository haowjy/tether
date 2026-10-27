import { test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, label, openFixture, SCENARIOS, shot } from "./harness";

// Every route and every admission screen, in every layout, theme and density: renders with
// no console errors, passes axe (contrast included), and is photographed for the evidence.
const SCREENS: { name: string; fixture: string; open?: true; ready: string; act?: (page: Page) => Promise<void> }[] = [
  { name: "home", fixture: "restored", ready: "h1:has-text('tether')" },
  { name: "files", fixture: "files", ready: 'main >> text="Files"' },
  { name: "terminal", fixture: "restored", open: true, ready: "[aria-current='true'], button[aria-label$='open sessions']" },
  { name: "terminal-live", fixture: "terminalLive", open: true, ready: ".xterm:not([data-blank] *)" },
  { name: "terminal-limited", fixture: "terminalLimited", open: true, ready: "text=allows 1 tmux session" },
  { name: "enrol", fixture: "enrol", ready: "text=Next" },
  { name: "wrong-origin", fixture: "wrongOrigin", ready: "text=Open tether at" },
  { name: "origin-refused", fixture: "originRefused", ready: "text=can't use" },
  { name: "node-refused", fixture: "nodeRefused", ready: "text=can't admit this device" },
  { name: "incompatible", fixture: "incompatible", ready: "text=speaks a different version" },
  { name: "offline", fixture: "unreachable", ready: "text=Can\'t reach the server" },
  { name: "gallery", fixture: "gallery", ready: "h1:has-text('Primitives')" },
  { name: "home-no-server", fixture: "noServer", ready: "text=No tmux server is running" },
  { name: "home-many", fixture: "homeMany", ready: "text=project-01" },
  { name: "home-empty-server", fixture: "emptyServer", ready: "text=No sessions on" },
  { name: "home-offline-tabs", fixture: "offlineTabs", ready: "text=Can't reach" },
  { name: "home-states", fixture: "homeStates", ready: "h1:has-text('Sessions list states')" },
  { name: "home-update-ready", fixture: "updatable", ready: "text=Update ready", act: (page) => page.evaluate(() => { window.__harness?.platform.setUpdate("ready"); }) },
  { name: "home-offline-launch", fixture: "offlineLaunch", ready: "text=Can't reach" },
];

for (const scenario of SCENARIOS) {
  test.describe(label(scenario), () => {
    for (const screen of SCREENS) {
      test(screen.name, async ({ page }, testInfo) => {
        const opened = await openFixture(page, screen.fixture, scenario, screen.open && { open: true });
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
