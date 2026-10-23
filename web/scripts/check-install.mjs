// Fails when node_modules is not what a lockfile asks for: the preflight of a clean export
// links the checkout's node_modules instead of running `npm ci` over it.
// Usage: node scripts/check-install.mjs <package-lock.json> <node_modules/.package-lock.json>
import { readFileSync } from "node:fs";

const [lockPath, installedPath] = process.argv.slice(2);
if (!lockPath || !installedPath) {
  console.error("usage: check-install.mjs <package-lock.json> <node_modules/.package-lock.json>");
  process.exit(2);
}
const wanted = JSON.parse(readFileSync(lockPath, "utf8")).packages ?? {};
let installed;
try {
  installed = JSON.parse(readFileSync(installedPath, "utf8")).packages ?? {};
} catch {
  console.error("web/node_modules is not installed: run `npm --prefix web ci` in the checkout first.");
  process.exit(1);
}
const stale = Object.entries(wanted).flatMap(([path, pkg]) => {
  if (path === "" || pkg.link === true) return [];
  const have = installed[path];
  // Optional platform packages (fsevents, native builds) are installed only where they fit.
  if (!have) return pkg.optional === true ? [] : [`${path} ${pkg.version} is missing`];
  return have.version === pkg.version ? [] : [`${path} is ${have.version}, the lockfile wants ${pkg.version}`];
});
if (stale.length > 0) {
  console.error(`web/node_modules differs from this commit's lockfile; run \`npm --prefix web ci\` in the checkout first:\n${stale.slice(0, 10).join("\n")}`);
  process.exit(1);
}
