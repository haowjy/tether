# P5 final gate: run everything against real tmux and triage

HEAD is 801780a or later on main. Run the whole verification surface once, on this Mac, and triage every failure to a cause (product bug, stale test, flaky test, environment). Keep CPU moderate (the user asked): run suites one after another, Playwright with `--workers=2`, no Docker.
1. `scripts/preflight.sh full --commit HEAD` and `cargo +1.85 check --locked --all-targets`.
2. Rust real-tmux tests on tmux 3.4 and 3.7b (`tests/tmux_real.rs`; find how they select the binary — /tmp/tether-meridian-501/tmux/{3.4,3.7b}/bin/tmux) and on homebrew 3.8.
3. Every real-daemon web e2e suite (`web/e2e/{terminal,home,dock,gesture,files,pwa}`; `pnpm --dir web run e2e:real`, `TETHER_E2E_TMUX=3.4|3.7b`), Chromium and WebKit where the suite supports it, plus the non-real harness suites (`pnpm --dir web run e2e`). pnpm only. Earlier lanes saw one load flake ("vertical swipe scrolls the buffer and tmux's history" on 3.7b, and terminal/home failing only when run beside the harness suite): rerun any failure alone up to 3 times and say whether it's a flake; a flake with a findable cause (a race in the test or the product) is a finding, not noise.
4. `ios/scripts/check.sh`.
Don't fix product code. You may fix a test only when it's clearly stale against a deliberate, documented change — say which and why; otherwise report. Record results in `$MERIDIAN_ACTIVE_WORK_DIR/evidence/p5-gate/README.md` (pass/fail counts per suite × version × browser, failures with excerpts). Clean up any tmux servers and processes you start (isolated `-L` only; never Jimmy's sessions). Don't commit.
Spawn env TMPDIR=/tmp/tether-meridian-501.
