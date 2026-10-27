import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { serviceWorker } from "./sw/vite-plugin";
import { devProxy } from "./vite.dev-proxy";

/** A production build fails if its module graph holds a test adapter or the harness (client-architecture.md §5.11). */
function forbidTestModules(): Plugin {
  return {
    name: "tether-forbid-test-modules",
    apply: "build",
    buildEnd() {
      const leaked = [...this.getModuleIds()].filter((id) => /\/(platform\/test|harness)\//.test(id) && !id.includes("node_modules"));
      if (leaked.length > 0) this.error(`The build includes test-only modules:\n${leaked.join("\n")}`);
    },
  };
}

/** The harness has no daemon: every `/fs/raw` image is one SVG, so an `<img>` in a Files fixture loads. */
function harnessImages(): Plugin {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#3b6ea8"/><circle cx="320" cy="200" r="90" fill="white"/></svg>';
  return {
    name: "tether-harness-images",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (/^\/fs\/raw\/[^?]*\.(png|jpe?g)(\?|$)/.test(req.url ?? "")) {
          res.setHeader("Content-Type", "image/svg+xml");
          res.end(svg);
        } else {
          next();
        }
      });
    },
  };
}

/** The Shiki grammars the file viewer ships, each its own lazy chunk (client-architecture.md §8.4). */
const GRAMMARS = ["shellscript", "json", "yaml", "toml", "markdown", "typescript", "tsx", "javascript", "python", "rust", "go", "swift", "c", "diff"];
/** `bash` is Shiki's alias of the `shellscript` grammar. */
const ALIASES: Record<string, string> = { bash: "shellscript" };

/** KaTeX (260 KB raw) is what Mermaid loads for a `$$math$$` label; the stub makes that label fail with the "couldn't render" note instead. */
const katexStub = fileURLToPath(new URL("files/render/omitted/katex.ts", import.meta.url));

export default defineConfig(({ mode }) => ({
  resolve: { alias: [{ find: /^katex$/u, replacement: katexStub }] },
  // The daemon serves the build at its origin's root.
  base: "/",
  plugins: [preact(), serviceWorker(), forbidTestModules(), ...(mode === "harness" ? [harnessImages()] : []), ...(mode === "harness" || mode === "test" ? [] : [devProxy()])],
  build: {
    target: "es2022",
    // scripts/checks.mjs build reads the manifest to enforce the shell budgets.
    manifest: true,
    rolldownOptions: {
      output: {
        // Each allowlisted grammar and its one-line `shiki/langs/<name>` wrapper share one
        // chunk, so Vite emits no 44-byte re-export stubs for them.
        manualChunks(id: string) {
          const found = /node_modules\/(?:shiki\/dist\/langs|@shikijs\/langs\/dist)\/([\w-]+)\.mjs/.exec(id)?.[1];
          const grammar = found && (ALIASES[found] ?? found);
          return grammar && GRAMMARS.includes(grammar) ? `grammar-${grammar}` : undefined;
        },
      },
    },
  },
  test: { include: ["**/*.test.ts"], exclude: ["node_modules", "dist", "e2e/**"] },
}));
