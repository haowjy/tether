// Builds the service worker (`/sw.js`), generates its precache list from the finished build,
// and injects the manifest link, icons and `theme-color` metas into index.html
// (client-architecture.md §9.1, §9.2). The manifest itself is public/manifest.webmanifest, a
// template the daemon completes with the host's name (src/http/shell.rs).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { build, type Plugin } from "vite";

/** The files the daemon routes (`routes()` in src/http/shell.rs); a precached path outside them would fail every install. */
const SERVED = /^(index\.html|manifest\.webmanifest|apple-touch-icon\.png|favicon\.ico|icons\/.+|assets\/.+)$/u;
/** Build products no browser asks for. */
const NOT_SHELL = /^(sw\.js|\.vite\/.*)$/u;

/** The dark and light `--color-bg` as hex; theme-color can't read the token. */
const THEME_DARK = "#0e1119";
const THEME_LIGHT = "#f0f2f6";

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split("\\").join("/"))
    .sort();
}

/** The URL path the worker caches a file under: the page is `/`, everything else its own path. */
const urlPath = (file: string): string => (file === "index.html" ? "/" : `/${file}`);

export function serviceWorker(): Plugin {
  let outDir = "";
  let root = "";
  return {
    name: "tether-service-worker",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      root = config.root;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        if (ctx.path !== "/index.html") return [];
        return [
          { tag: "meta", attrs: { name: "theme-color", content: THEME_DARK, media: "(prefers-color-scheme: dark)" }, injectTo: "head" },
          { tag: "meta", attrs: { name: "theme-color", content: THEME_LIGHT, media: "(prefers-color-scheme: light)" }, injectTo: "head" },
          { tag: "link", attrs: { rel: "manifest", href: "/manifest.webmanifest" }, injectTo: "head" },
          { tag: "link", attrs: { rel: "icon", href: "/favicon.ico", sizes: "48x48" }, injectTo: "head" },
          { tag: "link", attrs: { rel: "icon", href: "/icons/icon.svg", type: "image/svg+xml", sizes: "any" }, injectTo: "head" },
          { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" }, injectTo: "head" },
        ];
      },
    },
    closeBundle: {
      order: "post",
      async handler() {
        if (!outDir || this.environment.config.command !== "build") return;
        const files = listFiles(outDir).filter((f) => !NOT_SHELL.test(f));
        const unserved = files.filter((f) => !SERVED.test(f));
        if (unserved.length > 0) throw new Error(`The build holds files the daemon does not serve, so the worker could not precache them:\n${unserved.join("\n")}`);
        const hash = createHash("sha256");
        for (const f of files) hash.update(f).update("\0").update(readFileSync(join(outDir, f)));
        const result = await build({
          configFile: false,
          root,
          logLevel: "warn",
          define: { __BUILD__: JSON.stringify(hash.digest("hex").slice(0, 12)), __PRECACHE__: JSON.stringify(files.map(urlPath)) },
          build: {
            write: false,
            target: "es2022",
            lib: { entry: join(root, "sw/sw.ts"), formats: ["iife"], name: "tetherSw", fileName: () => "sw.js" },
          },
        });
        const output = (Array.isArray(result) ? result[0] : result);
        if (!output || !("output" in output)) throw new Error("The service worker build produced nothing");
        const chunk = output.output.find((o) => o.type === "chunk");
        if (!chunk) throw new Error("The service worker build produced no chunk");
        writeFileSync(join(outDir, "sw.js"), chunk.code);
      },
    },
  };
}
