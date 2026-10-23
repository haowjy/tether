import { defineConfig, devices } from "@playwright/test";

const PORT = 5199;

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
    command: `npx vite --mode harness --port ${String(PORT)} --strictPort --configLoader runner`,
    url: `http://localhost:${String(PORT)}/harness/index.html`,
    reuseExistingServer: !process.env["CI"],
    stdout: "ignore",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
