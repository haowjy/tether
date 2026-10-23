import { defineConfig, devices } from "@playwright/test";

// Each parallel lane sets its own TETHER_E2E_PORT, so one lane's run never reuses, or tears
// down, the harness server another lane's run is using.
const PORT = Number(process.env["TETHER_E2E_PORT"] ?? 5199);

// The specs run against the harness: the real app on the test platform (harness/), served by
// Vite's dev server. Each lane's specs live in e2e/<lane>/.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: "list",
  // Reduced motion keeps axe from reading a colour mid-transition.
  use: { baseURL: `http://localhost:${String(PORT)}`, trace: "retain-on-failure", contextOptions: { reducedMotion: "reduce" } },
  webServer: {
    command: `pnpm exec vite --mode harness --port ${String(PORT)} --strictPort --configLoader runner`,
    url: `http://localhost:${String(PORT)}/harness/index.html`,
    reuseExistingServer: !process.env["CI"],
    stdout: "ignore",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
