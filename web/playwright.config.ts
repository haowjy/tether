import { defineConfig, devices } from "@playwright/test";

// Each parallel lane sets its own TETHER_E2E_PORT, so one lane's run never reuses, or tears
// down, the harness server another lane's run is using.
const PORT = Number(process.env["TETHER_E2E_PORT"] ?? 5199);

// The specs run against the harness: the real app on the test platform (harness/), served by
// Vite's dev server. Each lane's specs live in e2e/<lane>/.
//
// `pnpm e2e:real` (TETHER_E2E_REAL=1) runs the `*.real.ts` specs instead: a real daemon on a
// private tmux per describe block, each started by e2e/shared/stack.ts, which also serves the
// app. They need tmux 3.4 and 3.7b under ~/.cache/tether-tmux and a debug `cargo build`.
const REAL = process.env["TETHER_E2E_REAL"] === "1";
export default defineConfig({
  testDir: "e2e",
  testMatch: REAL ? "**/*.real.ts" : "**/*.spec.ts",
  timeout: REAL ? 60_000 : 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: "list",
  // Playwright empties its output directory at the start of a run: one per port, so a run on
  // another port never deletes this one's traces.
  outputDir: `test-results/${String(PORT)}`,
  // Reduced motion keeps axe from reading a colour mid-transition.
  use: { baseURL: `http://localhost:${String(PORT)}`, trace: "retain-on-failure", contextOptions: { reducedMotion: "reduce" } },
  ...(!REAL && {
    webServer: {
      command: `pnpm exec vite --mode harness --port ${String(PORT)} --strictPort --configLoader runner`,
      url: `http://localhost:${String(PORT)}/harness/index.html`,
      reuseExistingServer: !process.env["CI"],
      stdout: "ignore" as const,
    },
  }),
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
