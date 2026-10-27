import { defineConfig, devices } from "@playwright/test";

// The end-to-end scripts (e2e/*/*.real.ts), run by `pnpm e2e:real`: each describe block starts
// its own real daemon on a private tmux and serves the app itself (e2e/shared/stack.ts). They
// need tmux 3.4 and 3.7b under ~/.cache/tether-tmux and a debug `cargo build`.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.real.ts",
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: "list",
  // Playwright empties its output directory at the start of a run: one per port, so a run on
  // another port never deletes this one's traces.
  outputDir: `test-results/${process.env["TETHER_E2E_PORT"] ?? "5199"}`,
  use: { trace: "retain-on-failure", contextOptions: { reducedMotion: "reduce" } },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
