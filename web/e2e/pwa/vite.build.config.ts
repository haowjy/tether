// The production config plus what the PWA gates need, for `vite build -c` in builds.ts:
// a salt that makes every JS chunk (and so its hashed file name) differ between builds, so
// "h1", "h2" and "h3" share no asset.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig, type Plugin, type UserConfig } from "vite";
import base from "../../vite.config";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function salt(): Plugin {
  return {
    name: "tether-e2e-salt",
    // A statement, not a comment: the minifier drops comments, and the hash must follow the content.
    renderChunk: (code) => `${code}\n;globalThis.tetherBuildSalt=${JSON.stringify(process.env["TETHER_E2E_SALT"] ?? "")};`,
  };
}

export default function config(): UserConfig {
  const resolved = base({ command: "build", mode: "test", isSsrBuild: false, isPreview: false });
  return mergeConfig(resolved, { root: WEB, plugins: [salt()], build: { outDir: process.env["TETHER_E2E_OUT"] ?? "dist-e2e", emptyOutDir: true } });
}
