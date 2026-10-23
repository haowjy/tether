// Fails when node_modules is not what a commit asks for: the preflight of a clean export
// links the checkout's node_modules instead of running `npm ci` over it. Three ways it can differ:
// a package the lockfile wants is missing or at another version; a package is installed that the
// lockfile no longer has (the export would build against it, `npm ci` would not); package.json
// and the lockfile's root entry disagree (`npm ci` rejects that commit).
// Usage: node scripts/check-install.mjs <package-lock.json> <node_modules/.package-lock.json> [package.json]
import { readFileSync } from "node:fs";

const [lockPath, installedPath, manifestPath = "package.json"] = process.argv.slice(2);
if (!lockPath || !installedPath) {
  console.error("usage: check-install.mjs <package-lock.json> <node_modules/.package-lock.json> [package.json]");
  process.exit(2);
}
const wanted = JSON.parse(readFileSync(lockPath, "utf8")).packages ?? {};
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
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
for (const [path, have] of Object.entries(installed)) {
  if (!(path in wanted) && have.link !== true) stale.push(`${path} is installed but the lockfile has no such package`);
}

// package.json against the lockfile's root entry, field by field.
const root = wanted[""] ?? {};
const drift = [];
for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
  const want = manifest[field] ?? {};
  const have = root[field] ?? {};
  for (const name of new Set([...Object.keys(want), ...Object.keys(have)])) {
    if (want[name] !== have[name]) drift.push(`${field}.${name}: package.json has ${want[name] ?? "nothing"}, the lockfile root has ${have[name] ?? "nothing"}`);
  }
}
// `overrides` is not recorded in the lockfile root: npm ci checks the resolved tree instead, so compare each pin.
for (const [name, version] of Object.entries(manifest.overrides ?? {})) {
  if (typeof version !== "string") continue;
  const resolved = Object.entries(wanted).filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`));
  for (const [path, pkg] of resolved) if (pkg.version !== version) drift.push(`overrides.${name} is ${version}, ${path} in the lockfile is ${pkg.version}`);
}

const problems = [...stale, ...drift];
if (problems.length > 0) {
  console.error(`web/node_modules or package.json differs from this commit's lockfile; fix the commit, or run \`npm --prefix web ci\` in the checkout first:\n${problems.slice(0, 10).join("\n")}`);
  process.exit(1);
}
