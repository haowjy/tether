# Delete the harness UI tests; keep real-daemon e2e as scripts

Repo `/Users/jimmyyao/repos/tether`, `main`, primary checkout (no branches/PRs; read
`AGENTS.md`). One local commit; **do not push**. Another agent is read-only reviewing
`web/app/`, `web/files/`, `web/workspace/` meanwhile: do not edit production source there.

Jimmy, 2026-10-27: "we shouldn't have any ui tesets, u should just make the code strong
enough that it shouldn't happen or we shouldn't be able to question it in the first
place (code structure over if statements)", then "yes, delete the playwright suite",
"i don't think i've ever seen ui tests catch anything really", then "e2e scripts maybe (to test the full behavior, and record performance)".

Delete:
- every Playwright spec that runs against the harness's fake daemon (the `*.spec.ts`
  files under `web/e2e/`, including `pwa/` and the axe checks), the helpers only they
  use, `@axe-core/playwright`, the `e2e` script and the harness projects in
  `web/playwright.config.ts`;
- `TETHER_PREFLIGHT_E2E` handling in `scripts/preflight.sh` and Playwright steps in
  `.github/workflows/*.yml` that run the harness specs;
- docs that tell anyone to run or write harness UI tests: `web/README.md`,
  `web/AGENTS.md` (the rule "a harness fixture that Playwright opens in both layouts"
  becomes: every state has a harness fixture, for looking at it), root `AGENTS.md`,
  `docs/`, `.meridian/work/tether-mvp/design/client-architecture.md`.

Keep:
- the real-daemon end-to-end scripts (`*.real.ts`: terminal, home, dock, gesture) and
  their isolated stack (`web/e2e/shared/stack.ts` and the front proxy), with
  `@playwright/test` and an `e2e:real` script (rename if clearer). They run against a
  real daemon and private tmux 3.4/3.8, opt-in, never in preflight. Move them under a
  clearly named directory if that reads better (e.g. `web/e2e/` holding only these), and
  say in `web/README.md` that they exercise full behaviour end to end and are where
  performance recording will live (not built in this commit). Make the stack startable
  on its own too (a small script that starts it and prints the URL) so probers can drive
  it by hand without touching Jimmy's sessions.
- the harness (`web/harness/`, fixtures, `?fixture=` boot, `--mode harness`): probers and
  the lead use it to look at each screen and state.
- unit tests (vitest), Rust tests, Swift tests.

Log in `docs/design/decisions.md` (2026-10-27): harness UI tests removed, real-daemon e2e kept as opt-in scripts for full behaviour and (later) performance, Jimmy's words above;
verification is structural review plus probes on the running system (harness, real
stack, device checklist); rejected: keeping the harness suite. Update `plan.md`'s "Code
structure and standards" or testing section if it prescribes UI tests.

Verify: `pnpm --dir web install --frozen-lockfile` after the change, `pnpm --dir web run
check`, `scripts/preflight.sh full`, the moved stack script starts and serves a page
(curl it), and the remaining `*.real.ts` still run (`TMPDIR=/tmp`, tmux 3.4: run at least the terminal group) and no live doc or config refers to the deleted specs. Report the SHA, what was deleted/moved, and anything you kept and why.
