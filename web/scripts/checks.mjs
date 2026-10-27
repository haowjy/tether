// Build and source checks that `pnpm run check` runs (client-architecture.md §8.3, §8.4, §8.6):
// the shell budgets, the copy rule and the colour-token rule. Pure functions below are tested
// by scripts/checks.test.ts; `node scripts/checks.mjs source|build` runs them on the tree.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { diagramFiles } from "./diagrams.mjs";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const KB = 1024;

/** Budgets, gzipped, from §8.4. A budget is raised only with its measurement in the commit. */
export const BUDGETS = {
  initialJs: 200 * KB,
  initialCss: 15 * KB,
  terminalFont: 120 * KB,
  symbolsFont: 150 * KB,
  shell: 1.5 * 1024 * KB,
  shellFiles: 64,
  /** Everything only a Mermaid diagram loads (scripts/diagrams.mjs): fetched on demand, never precached. */
  diagrams: 1.4 * 1024 * KB,
  /** The daemon's own caps (build.rs), raw bytes: per embedded file, in total, and in file count. */
  file: 1.5 * 1024 * KB,
  embedRaw: 8 * 1024 * KB,
  embedFiles: 192,
};

/** Characters the visual copy rule bans anywhere in web/ outside tests (browser-behaviors.md). */
const BANNED_COPY = /[·•●]/u;

export function findCopyViolations(text) {
  return text
    .split("\n")
    .flatMap((line, i) => (BANNED_COPY.test(line) ? [`line ${String(i + 1)}: ${line.trim().slice(0, 80)}`] : []));
}

const COLOUR_PRIMITIVE = /var\(\s*--(gray|green|amber|red|blue)-\d+/u;

/** Only ui/tokens/semantic.css reads the colour scales. */
export function findColourPrimitiveUses(path, text) {
  if (path.endsWith("ui/tokens/semantic.css")) return [];
  return text
    .split("\n")
    .flatMap((line, i) => (COLOUR_PRIMITIVE.test(line) ? [`${path} line ${String(i + 1)}: ${line.trim().slice(0, 80)}`] : []));
}

const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:oklch|oklab|lch|lab|hsl|hsla|rgb|rgba|color)\(/iu;

/** Colour values are tokens: component CSS holds no colour literal, only ui/tokens/ does. */
export function findColourLiterals(path, text) {
  if (!path.endsWith(".css") || path.includes("ui/tokens/")) return [];
  return text
    .split("\n")
    .flatMap((line, i) => (COLOUR_LITERAL.test(line) ? [`${path} line ${String(i + 1)}: ${line.trim().slice(0, 80)}`] : []));
}

/**
 * `files` is `{ path, bytes, gz }` for every emitted file; `manifest` is Vite's manifest.
 * Returns the budget breaches, empty when all hold.
 */
export function budgetBreaches(files, manifest) {
  const out = [];
  const gz = new Map(files.map((f) => [f.path, f.gz]));
  const size = (p) => gz.get(p) ?? 0;

  // Initial = the entry and every static import, with their CSS.
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const dep of manifest[key]?.imports ?? []) visit(dep);
  };
  const entry = Object.keys(manifest).find((k) => manifest[k].isEntry === true && k.endsWith(".html")) ?? Object.keys(manifest).find((k) => manifest[k].isEntry === true);
  if (entry) visit(entry);
  const initial = [...seen].map((k) => manifest[k]);
  const js = initial.reduce((n, c) => n + size(c.file), 0);
  const css = initial.reduce((n, c) => n + (c.css ?? []).reduce((m, f) => m + size(f), 0), 0);
  if (js > BUDGETS.initialJs) out.push(`initial JS is ${kb(js)} gzipped, over ${kb(BUDGETS.initialJs)}`);
  if (css > BUDGETS.initialCss) out.push(`initial CSS is ${kb(css)} gzipped, over ${kb(BUDGETS.initialCss)}`);

  for (const f of files) {
    if (/tether-mono-(regular|bold).*\.woff2$/u.test(f.path) && f.gz > BUDGETS.terminalFont) out.push(`${f.path} is ${kb(f.gz)}, over ${kb(BUDGETS.terminalFont)}`);
    if (/tether-symbols.*\.woff2$/u.test(f.path) && f.gz > BUDGETS.symbolsFont) out.push(`${f.path} is ${kb(f.gz)}, over ${kb(BUDGETS.symbolsFont)}`);
    if (f.bytes > BUDGETS.file) out.push(`${f.path} is ${kb(f.bytes)} raw, over the daemon's per-file cap`);
  }
  const lazy = diagramFiles(manifest);
  const shell = files.filter((f) => !lazy.has(f.path));
  const total = shell.reduce((n, f) => n + f.gz, 0);
  if (total > BUDGETS.shell) out.push(`the shell is ${kb(total)} gzipped, over ${kb(BUDGETS.shell)}`);
  if (shell.length > BUDGETS.shellFiles) out.push(`the shell has ${String(shell.length)} files, over ${String(BUDGETS.shellFiles)} (stubs count)`);
  const diagrams = files.filter((f) => lazy.has(f.path)).reduce((n, f) => n + f.gz, 0);
  if (diagrams > BUDGETS.diagrams) out.push(`the diagram files are ${kb(diagrams)} gzipped, over ${kb(BUDGETS.diagrams)}`);
  const raw = files.reduce((n, f) => n + f.bytes, 0);
  if (raw > BUDGETS.embedRaw) out.push(`the build is ${kb(raw)} raw, over the daemon's ${kb(BUDGETS.embedRaw)} cap`);
  if (files.length > BUDGETS.embedFiles) out.push(`the build has ${String(files.length)} files, over the daemon's ${String(BUDGETS.embedFiles)}`);
  return out;
}

function kb(bytes) {
  return `${(bytes / KB).toFixed(1)} KB`;
}

function walk(dir, skip) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (skip(path, e)) return [];
    return e.isDirectory() ? walk(path, skip) : [path];
  });
}

function checkSource() {
  const skipDirs = new Set(["node_modules", "dist", "test-results", "playwright-report", ".vite"]);
  const files = walk(WEB, (p, e) => e.isDirectory() && skipDirs.has(e.name));
  const problems = [];
  for (const file of files) {
    const rel = relative(WEB, file);
    if (!/\.(ts|tsx|css|html|js|mjs)$/u.test(rel)) continue;
    const text = readFileSync(file, "utf8");
    const isTest = /\.(test|spec)\.tsx?$/u.test(rel) || rel.startsWith("scripts/checks");
    if (isTest) continue; // tests seed violations on purpose
    for (const v of findCopyViolations(text)) problems.push(`${rel}: ${v} (no middle dots or dot markers in copy)`);
    if (/\.(css|tsx?)$/u.test(rel)) problems.push(...findColourPrimitiveUses(rel, text), ...findColourLiterals(rel, text));
  }
  return problems;
}

function checkBuild() {
  const dist = join(WEB, "dist");
  const files = walk(dist, () => false).map((file) => {
    const bytes = readFileSync(file);
    return { path: relative(dist, file), bytes: statSync(file).size, gz: gzipSync(bytes, { level: 9 }).length };
  });
  const manifest = JSON.parse(readFileSync(join(dist, ".vite/manifest.json"), "utf8"));
  const lazy = diagramFiles(manifest);
  const gz = (list) => kb(list.reduce((n, f) => n + f.gz, 0));
  console.log(`shell: ${String(files.length - lazy.size)} files, ${gz(files.filter((f) => !lazy.has(f.path)))} gzipped; diagrams: ${String(lazy.size)} files, ${gz(files.filter((f) => lazy.has(f.path)))} gzipped`);
  return budgetBreaches(files, manifest);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const problems = mode === "source" ? checkSource() : mode === "build" ? checkBuild() : [`usage: checks.mjs source|build`];
  for (const p of problems) console.error(`check ${mode ?? ""}: ${p}`);
  process.exit(problems.length ? 1 : 0);
}
