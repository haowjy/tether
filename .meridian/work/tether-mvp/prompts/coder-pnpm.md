# Switch the web toolchain from npm to pnpm

Jimmy's call: tether uses pnpm, not npm. pnpm 10.23.0 is installed (/Users/jimmyyao/Library/pnpm/pnpm),
Node v22.23.4. Replace npm everywhere it is used to install, run or check the web client, and
delete what pnpm makes unnecessary.

Known users of npm (find the rest yourself, e.g. `git grep -n -w npm`, `git grep -n package-lock`):
web/package.json (scripts, `overrides` pinning playwright-core for @axe-core/playwright, pinned
@playwright/test 1.54.2), web/package-lock.json, build.rs (runs `npm run build` to embed the shell),
scripts/preflight.sh, web/scripts/check-install.mjs, .githooks/, .github/workflows/ci.yml,
.github/workflows/release-on-main.yml, docs/running.md, docs/releasing.md, READMEs.

Decisions already made:
- `packageManager: "pnpm@10.23.0"` in web/package.json; `pnpm-lock.yaml` replaces package-lock.json
  (generated with `pnpm import` from the npm lockfile so versions don't drift, then `pnpm install`);
  npm `overrides` become `pnpm.overrides`.
- preflight --commit: the export currently symlinks the checkout's web/node_modules and runs
  check-install.mjs to prove it matches the commit's lockfile. With pnpm's content-addressed store,
  run `pnpm install --frozen-lockfile` (prefer --offline, falling back to online) inside the export
  instead, and delete check-install.mjs and its call. Measure the export install time and report it.
  The non-export path installs with --frozen-lockfile when the lockfile is newer than the install.
  Keep everything else in preflight.sh as it is now (in particular the export extracts with
  `tar -x -m`; don't regress that).
- CI uses pnpm/action-setup with the packageManager version and pnpm's store cache.
- pnpm's strict node_modules may expose phantom dependencies (imports of packages not in
  package.json). Declare them properly; never set shamefully-hoist or node-linker=hoisted.
- Playwright: `pnpm exec playwright`; browsers already in ~/Library/Caches/ms-playwright for 1.54.2.
- If pnpm 10 blocks dependency build scripts (onlyBuiltDependencies), allow only those actually needed
  (e.g. esbuild) and say which.

Work entirely in a clean export so you disturb nothing: `git archive HEAD | tar -x -m -C
/tmp/tether-pnpm`. A preflight run and a docs lane are using the primary checkout and its
web/node_modules right now: do not run installs, builds or edits there. In the export, prove it:
`pnpm install`, `pnpm --dir web run check`, the e2e suite (pnpm --dir web run e2e, Chromium+WebKit),
`cargo build` (build.rs must build the shell with pnpm), and `scripts/preflight.sh full` plus a
`--commit` run if you can make one work from the export (git init the export and commit there).
Use TMPDIR=/tmp/tether-meridian-501 if socket paths get too long.

Don't edit docs/design/** or AGENTS.md (another lane owns them now): list every npm mention there
that needs changing, with file:line, in your report. Deliver your change as one patch against HEAD at
.meridian/work/tether-mvp/evidence/pnpm-switch.patch (binary-safe: `git diff --binary`), including the new pnpm-lock.yaml and
the deletions. Report: files changed, phantom deps found, export-install timing, verification results,
and the design-doc lines to change. Delete /tmp/tether-pnpm when done.
