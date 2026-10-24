# P5 final verification gate

Run date: 2026-10-24 (America/New_York). Checkout: `main`, HEAD `801780a485b50f7543f4251bf073ee4cfbe5fabc`. Host: this Mac; `TMPDIR=/tmp/tether-meridian-501`. No Docker. Web runs were serialized; Playwright used two workers for full suites (single-test reproduction necessarily reported one worker). No product code or tests changed and nothing was committed.

## Results

| Surface | Result | Evidence |
|---|---:|---|
| `scripts/preflight.sh full --commit HEAD` | PASS, exit 0; 79 lib + 18 auth + 4 fs + 4 hub-real + 30 hub-state + 18 tmux-real-gated-off + 16 tmux-session = 169 Rust tests; 33 web test files / 372 tests; release build; 98.63 s wall | [`preflight.log`](preflight.log) |
| `cargo +1.85 check --locked --all-targets` | PASS, exit 0; 7.88 s wall | [`msrv.log`](msrv.log) |
| Rust `tests/tmux_real.rs` against tmux 3.4 | PASS, 18/18; 44.20 s wall | [`rust-tmux.log`](rust-tmux.log) |
| Rust `tests/tmux_real.rs` against tmux 3.7b | PASS, 18/18; 36.95 s wall | [`rust-tmux.log`](rust-tmux.log) |
| Rust `tests/tmux_real.rs` against Homebrew tmux 3.8 | PASS, 18/18; 37.59 s wall | [`rust-tmux.log`](rust-tmux.log) |
| Real daemon web e2e, tmux 3.4 × terminal / home / dock / gesture | PASS; counts by browser below | [`real-3.4-terminal.log`](real-3.4-terminal.log), [`real-3.4-home.log`](real-3.4-home.log), [`real-3.4-dock.log`](real-3.4-dock.log), [`real-3.4-gesture.log`](real-3.4-gesture.log) |
| Real daemon web e2e, tmux 3.7b × terminal / home / dock / gesture | PASS; counts by browser below | [`real-3.7b-terminal.log`](real-3.7b-terminal.log), [`real-3.7b-home.log`](real-3.7b-home.log), [`real-3.7b-dock.log`](real-3.7b-dock.log), [`real-3.7b-gesture.log`](real-3.7b-gesture.log) |
| 3.7b vertical-history gesture previously reported flaky | PASS on full gesture suite and isolated Chromium rerun, 1/1; isolated run 10.04 s wall | [`isolated-3.7b-gesture-history.log`](isolated-3.7b-gesture-history.log) |
| Non-real harness `pnpm --dir web run e2e` | PASS, 648/648, 324 Chromium + 324 WebKit; 4m52.53s wall | [`harness-e2e.log`](harness-e2e.log) |
| `ios/scripts/check.sh` | PASS, exit 0; Swift tests 7/7 and iOS Simulator build succeeded; 10.69 s wall | [`ios-check.log`](ios-check.log) |

### Real-daemon browser matrix

| tmux | Suite | Chromium | WebKit |
|---|---|---:|---:|
| 3.4 | terminal | 13 pass / 0 fail | 13 pass / 0 fail |
| 3.4 | home | 6 pass / 0 fail | 6 pass / 0 fail |
| 3.4 | dock | 12 pass / 0 fail | 12 pass / 0 fail |
| 3.4 | gesture | 15 pass / 0 fail | 15 skipped (touch injection requires Chromium CDP) |
| 3.7b | terminal | 13 pass / 0 fail | 13 pass / 0 fail |
| 3.7b | home | 6 pass / 0 fail | 6 pass / 0 fail |
| 3.7b | dock | 12 pass / 0 fail | 12 pass / 0 fail |
| 3.7b | gesture | 15 pass / 0 fail | 15 skipped (touch injection requires Chromium CDP) |

Per suite totals for each version: terminal 26 passed, home 12, dock 24, gesture 15 passed + 15 browser-skipped. No real-daemon e2e test failed. Playwright duration from summaries: terminal about 28–29 s, home 9 s, dock 17–18 s, gesture about 1m7s each version.

### Harness browser matrix

| Browser | `files` | `pwa` | `home/keyboard` | `shared` | Total |
|---|---:|---:|---:|---:|---:|
| Chromium | 132 | 4 | 3 | 185 | 324 |
| WebKit | 132 | 4 | 3 | 185 | 324 |

`files` and `pwa` currently contain only harness `*.spec.ts` tests, not real-daemon `*.real.ts` specs; the `e2e:real` Playwright config selects only `**/*.real.ts`. Thus files/PWA are exercised here in the required non-real harness, but have no tmux-version dimension. Likewise real daemon coverage currently includes `terminal`, `home`, `dock`, and `gesture` only.

## Failure triage

- **Command invocation, not product/test failure:** the first harness command was `pnpm --dir web run e2e -- --workers=2`; the script emitted `playwright test -- --workers=2`, and Playwright returned `Error: No tests found` (exit 1). Corrected to `pnpm --dir web run e2e --workers=2`; the complete suite then passed 648/648. The initial log excerpt is at the beginning of [`harness-e2e.log`](harness-e2e.log); the passing run follows in the same file. No suite-level retry was needed.
- **Previously reported 3.7b swipe load flake:** not reproduced: both full gesture runs passed the Chromium swipe assertion (7.5 s), then isolated `-g "a vertical swipe scrolls..." --project=chromium` passed 1/1. This suggests the earlier failure was transient/load-sensitive, but there is no failing trace/output from this gate to identify a definitive race cause. The test does use fixed 700 ms pauses between swipes (`web/e2e/gesture/gesture.real.ts:245-273`), which is a plausible timing sensitivity, not a proven cause. No code/test adjustment made.
- No test failures attributable to product behavior, stale tests, flakes, or unavailable environment were observed in this gate.

## Commands / selection notes

- `scripts/preflight.sh full --commit HEAD`
- `cargo +1.85 check --locked --all-targets`
- `TETHER_TMUX_TESTS=1 TETHER_TMUX=<binary> cargo test --locked --test tmux_real -- --test-threads=1`, serially for `/tmp/tether-meridian-501/tmux/{3.4,3.7b}/bin/tmux` and `/opt/homebrew/bin/tmux` (3.8).
- For each `version` in `3.4`, `3.7b` and each real suite `terminal`, `home`, `dock`, `gesture`: `TETHER_E2E_TMUX=$version TETHER_TMUX=<version binary> TETHER_E2E_PORT=<unique port> pnpm --dir web run e2e:real --workers=2 e2e/$suite`. Separate ports: 5204–5207, 5214–5217.
- Isolated history case: same tmux 3.7b environment with `TETHER_E2E_PORT=5229`, `pnpm --dir web run e2e:real --workers=2 e2e/gesture/gesture.real.ts --project=chromium -g "a vertical swipe scrolls the buffer and tmux's history with momentum"`.
- `pnpm --dir web run e2e --workers=2`
- `ios/scripts/check.sh`

## Cleanup and working tree

The isolated real-daemon stack directories created for ports 5204–5207, 5214–5217, and 5229 were empty after Playwright teardown; removed those empty directories. No process/server started by this gate remains. Existing unrelated `tmux -L tether-w2-chromium-{3.4,3.7b}` processes were present at the end and were not touched; the gate's stacks use different labels and its own daemon/Vite children exited. No user tmux server/session was contacted. Scratch logs and this README are retained here. Repository status after checks showed no tracked source changes; existing untracked `.meridian/work/tether-mvp/prompts/*` files were left untouched.
