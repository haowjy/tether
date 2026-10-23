# Get tether's test gate green and reliable

An audit of the test suite (`.meridian/work/tether-mvp/test-audit.md`, read it first) found that CI has been red for 17 pushes, an HTTP test flakes, and the real-tmux suites run nowhere. Fix the gate. Work in the primary checkout on `main`. Read `AGENTS.md`. **Don't commit**; the tech lead reviews and commits. Don't add new tests: the owner decides on new coverage. Restructure only the tests named below.

Do these in order, and confirm each one before moving on:

1. **vitest needs no Tailscale** (audit §3.1). Today `web/vite.config.ts` calls `devLogin()` under vitest, which counts as "serve". Make the test run hermetic in the cleanest way you find. The dev server's behaviour must not change.
2. **Clippy is clean on current stable** (audit §3.1). `fetch_update` is deprecated at `src/blocking.rs:154`. Replace it without changing semantics: this is the blocking-lane permit logic, so preserve the bounded-wait and lane-cap behaviour exactly, and explain why your replacement is equivalent. Then add a `rust-toolchain.toml` pinning the stable version installed here (check that it's ≥ 1.85, the crate's `rust-version`), so a new stable can't break the gate again. Check what CI installs, and make CI honour the pin.
3. **Fix the HTTP harness flake** (audit §3.2). `tests/support/daemon.rs:132-158` writes the head and the body separately with `Connection: close`. Reproduce the flake first: run `cargo test --test http_auth` repeatedly and record the failure rate. Then fix it as the audit suggests, or better, and show the failure rate afterwards over at least 20 runs. Also judge whether real clients could hit this (a refused POST with an unread body closing with a reset). Report your judgement; don't change production code for it.
4. **Unguarded fs test on macOS** (audit §3.5). The working tree has an uncommitted edit to `src/fs/list.rs` and `src/fs/open.rs` (see `git diff`). Keep the `open.rs` Linux gate. In `list.rs`, test the case tie-break as a pure sort test over an in-memory `Scan` that runs on every platform, and keep only the `caf\xe9` → `utf8: Some(false)` filesystem check behind `cfg(target_os = "linux")`. Keep the main listing test platform-neutral.
5. **Real-tmux suites have somewhere to run** (audit §3.4).
   - Canonicalize the temp dir in `tests/tmux_real.rs:1121` and `tests/hub_real.rs:224` so they pass on macOS (`/private/tmp`).
   - Add a CI job on ubuntu-latest: install tmux, report the installed version in the job log, and run `TETHER_TMUX_TESTS=1 cargo test --test tmux_real --test hub_real -- --test-threads=1`.
   - Leave `tmux_real.rs:986` (tmux 3.8 rejects a tab in a window name) as it is, and report it. Supported versions are 3.4 and 3.7b; it's a decision for the owner.
   - Run the real suites locally with `TETHER_TMUX_TESTS=1` on an isolated socket only. Never touch the user's running tmux server or sessions. Check how the tests choose their socket before you run them.

Then run `scripts/preflight.sh full` and the real-tmux suites, and report.

## Report
For each item: the files changed, how you verified it (commands, counts, before and after), and what's still unverified. Linux-only tests can't run on this Mac, and Docker isn't running; say what only CI will prove.
