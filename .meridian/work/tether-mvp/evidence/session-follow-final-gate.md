# Session-follow local completion

Implementation commit: `73c5102` (local main, not pushed). Final source is approved by
Opus daemon p251 and client p253 reviews; lead then read the small callback/dead-fake
cleanups. The clean-export gate caught an unreachable fake-hub wildcard left by a
variant deletion; that arm was removed before the successful gate.

## Verification

- `scripts/preflight.sh full --commit 73c5102`: pass on clean export (fmt, clippy with
  warnings denied, Rust tests, release build, web type/lint/source/unit/build checks).
- Rust MSRV `cargo +1.85 check --locked --all-targets`: pass.
- Real Rust integration: 4 hub +18 tmux cases on each of 3.4 and3.7b: pass.
- Browser harness: 838 pass. Real daemon/browser:150 pass,30 skipped (WebKit gesture
  cases need Chromium CDP). These full runs precede the final notice-callback
  consolidation, which preserves text and the sole production sink; final web checks
  pass after it. No claim that the full browser suite reran after that deletion.
- Swift TetherKit:7 pass; Simulator build passed in p245, native source unchanged since.
- Live workflows: basic follow/sizing/menu on both tmux versions, p250 delayed
  clipboard/reconnect/menu-focus checks, p260 real Files browse/completion and path
  insertion across external window switching. See individual reports for scope.
- New executable regression cases and temporary fixtures removed per Jimmy's request.

## Review disposition

Claim races, incoherent shown metadata/cwd, unbounded select tracking, delayed clipboard
redirection, reconnect policy tied to presentation delay, clipped menu, duplicate focus
ownership and stale contracts/docs were fixed. Accepted low note: an error arriving
more than30s after a timed-out request can show a second notice; no expired-request
tracking added solely to suppress it. Minor export/status-shape nits need no change.

## Not signed off for daily use

- Upstream tmux crashes: ordinary attach/detach on3.4 (fixed3.7), plus a distinct
  select-and-destroy command-list crash on3.4 and3.7b. [Issue2](https://github.com/haowjy/tether/issues/2)
  requires a verified baseline/backport decision. Installed binaries unchanged.
- Physical iPhone/native paste prompt and keyboard acceptance remain with Jimmy.
- Linux resource probe used a container stand-in, not the actual dev-box service:
  idle RSS6.29MiB exceeds the approximate5MB target; constrained workloads passed.
- Independent rapid selection/resize and delayed image-upload overlap were not
  exercised by p254 (build-only incomplete run). Do not infer those passes from
  other checks.

No push, PR, release or tag. All child agents drained. Owned runtime stacks stopped;
lead removed completed p259 load generators and temporary repro directories. Raw gate
logs remain in /tmp (not committed). Work item remains open for device/deployment gates.
