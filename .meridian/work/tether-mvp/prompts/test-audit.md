# Audit tether's automated tests: what earns its place?

Jimmy (the owner) suspects tether has more unit tests than it needs, and wants the tests that remain to guard important things and be well structured. Audit the whole suite and recommend what to keep, what to delete, and what to restructure. This is a read-only review: edit nothing.

## Context
- tether is a Rust daemon that bridges tmux control mode to a web client over a WebSocket. Read `AGENTS.md` and `docs/design/plan.md` ("Code structure and standards", including its testing standard). `docs/design/daemon-core.md` §8 is the testing plan.
- Design constraints the tests could guard: tmux is the source of truth and the daemon never starts it; bounded queues, credit and the outbox; every route is behind auth (one unprotected route is remote code execution); the fs roots allowlist, path resolution and symlink races; the wire protocol and handshake; snapshot correctness; the resource budget.
- Rust: unit tests in `src/**` (`#[cfg(test)]`); integration tests in `tests/` (`http_auth.rs`, `http_fs.rs`, `hub_real.rs`, `hub_state.rs`, `tmux_real.rs`, `tmux_session.rs`, `support/`, `fixtures/`). Web: `web/**/*.test.*`. Check `package.json` and `scripts/preflight.sh` for how each runs.
- The daemon runs only on Linux, but development also happens on macOS. Two fs tests fail on macOS because APFS refuses names that aren't valid UTF-8 and folds case. The working tree has an uncommitted candidate fix in `src/fs/list.rs` and `src/fs/open.rs` (see `git diff`). Judge whether those cases deserve tests at all, and if so whether the Linux-gated split is the right shape.

## What to judge
For each test file or test group: the failure it guards and how important it is; whether it tests behaviour or pins implementation; whether it sits at the right tier (pure unit, real-tmux integration, or better left to a manual probe); and how much it duplicates others. Look for whole categories that a structural change could delete, and for important risks that nothing guards (name them; don't write tests). Judge for yourself what else matters: runtime cost, flakiness, fixtures, file sprawl.

## Output
A report ranked by impact:
1. A summary table: file or group, test count, verdict (keep / delete / merge / restructure), and a one-line reason.
2. Deletion candidates, each with the risk it supposedly guards and why that risk is covered elsewhere or isn't worth an automated test.
3. Restructures, each with a concrete move.
4. Unguarded risks that matter.
5. Roughly how much the suite shrinks, and how much faster preflight gets.

Cite file:line.
