// The files only a Mermaid diagram loads: what `files/render/mermaid.ts` reaches that the
// app's entry does not. They ship in the daemon's shell but the service worker leaves them
// out of the precache (a diagram on a spotty link costs its download once, on demand), and
// they have their own budget rather than the shell's (client-architecture.md §8.4).

const LOADER = "files/render/mermaid.ts";

/** Every file of the chunks reachable from `start`, following static and dynamic imports but never into `skip`. */
function reach(manifest, start, skip) {
  const seen = new Set();
  const visit = (key) => {
    if (key === skip || seen.has(key) || !manifest[key]) return;
    seen.add(key);
    for (const next of [...(manifest[key].imports ?? []), ...(manifest[key].dynamicImports ?? [])]) visit(next);
  };
  visit(start);
  return seen;
}

/** The dist-relative paths of the diagram-only files, empty when the build has no diagram code. */
export function diagramFiles(manifest) {
  if (!manifest[LOADER]) return new Set();
  const entry = Object.keys(manifest).find((k) => manifest[k].isEntry === true && k.endsWith(".html")) ?? "";
  const shell = reach(manifest, entry, LOADER);
  const files = (keys) => [...keys].flatMap((k) => [manifest[k].file, ...(manifest[k].css ?? [])]);
  const kept = new Set(files(shell));
  return new Set(files(reach(manifest, LOADER)).filter((f) => !kept.has(f)));
}
