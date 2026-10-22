import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [preact()],
  // The iOS app loads the build from a custom scheme, so asset URLs are relative.
  base: "./",
  build: { target: "es2022" },
  test: { include: ["**/*.test.ts"], exclude: ["node_modules", "dist"] },
});
