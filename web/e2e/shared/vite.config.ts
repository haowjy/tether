// The app's own Vite config with a private dependency cache. Several isolated stacks run
// their dev servers at once, and servers sharing node_modules/.vite re-optimise over each
// other and reload the page mid-test.
import type { ConfigEnv } from "vite";
import { defineConfig } from "vitest/config";
import app from "../../vite.config";

export default defineConfig((env: ConfigEnv) => {
  const base = app(env);
  return { ...base, cacheDir: process.env["TETHER_E2E_VITE_CACHE"] ?? "node_modules/.vite-e2e" };
});
