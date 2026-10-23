# Report

# tether test suite audit

Reviewed at `e47dd74` plus your uncommitted `src/fs/{list,open}.rs` diff. I edited nothing in the checkout. All probes ran in a scratch copy at `/tmp/tether-audit/`.

**The suite is not too big.** It has 229 tests: 72 Rust unit tests, 68 integration tests and 89 web tests. Most guard something that matters, and most test behaviour rather than implementation. The fakes are good: the hub's fake tmux answers from a model, and assertions name ops rather than command text. Deleting what deserves it removes about 10 tests and roughly 5% of test code, and saves almost no preflight time.

The real problems are elsewhere:
- **CI has been red for 17 pushes.** It first broke because vitest needs a Tailscale login, then on a clippy deprecation. Every Linux-only test runs nowhere right now.
- **One HTTP test flakes on macOS** in about 5 of 6 runs.
- **The real-tmux suites are outside the gate**, and 3 of their 20 tests fail on the Mac.
- **The WebSocket handler has no tests of its own.**

## 1. Summary table

| File / group | Tests | Verdict | Reason |
|---|---|---|---|
| `tests/http_auth.rs` | 4 | **restructure** | Guards the remote-code-execution boundary, so it is essential. Flaky on macOS (harness bug), and the hand-kept route list doesn't cover future routes. |
| `tests/http_fs.rs` | 4 | keep | Ranges, sandbox/nosniff headers, the upload slot, a symlinked config, a broken config failing closed. Right tier. |
| `tests/hub_state.rs` | 24 | keep, restructure file | The core credit/outbox/lifecycle guard. Pure and fast (0.67s). 1329 lines, 515 of them the fake. |
| `tests/tmux_session.rs` | 16 | keep, **delete `.events` goldens** | Chunk-invariance and `.in` replay are high value. The goldens repeat the targeted tests as change-detectors. |
| `tests/tmux_real.rs` | 16 | keep, merge 4 into 1, delete 1 | The only guard of "never starts a server". Opt-in, outside preflight, 3 failures on macOS. |
| `tests/hub_real.rs` | 4 | keep | Real hub + pumps + outbox end to end. Overlaps `hub_state` on purpose (different tier). |
| `src/fs/open.rs` | 8 | keep | Root escape, symlink swap race, FIFO, shape checks. Top security value. |
| `src/fs/list.rs` | 1→2 (diff) | restructure | The case-tie half should be an in-memory sort test that runs everywhere (§3.5). |
| `src/fs/{raw,mime,upload}.rs`, `files.rs` | 9 | keep | Range parsing is pure and exhaustive; the MIME table blocks browser-run types; part-file cleanup. |
| `src/fs/config_write.rs` | 5 | merge → 2 | Five tests on the same hand-written TOML. Also covered end to end by `http_fs.rs:182`. |
| `src/auth/store.rs` | 6 | keep (1 optional delete) | Single-use code, 5-strike lockout, fail-closed parse without leaking contents, concurrent writers. `the_host_id_is_written_once` is trivial. |
| `src/auth/identity.rs` | 1 | keep, add the loopback branch | Funnel detection is pure. The loopback refusal is untested. |
| `src/tmux/{parse,command,session,snapshot,layout}.rs` | 15 | keep | Byte-safe decoding, the key allowlist, quoting, the vt100 check of restore bytes against fixtures. |
| `src/tmux/mod.rs` | 2 | delete 1 | `ids_round_trip_with_their_sigils` is exercised by every replay and hub test. |
| `src/proto/*` | 3 | keep | Golden frames shared with the web side, unknown vs bad message types, generated-TypeScript staleness. |
| `src/hub/outbox.rs`, `blocking.rs` | 2 | keep | Coalescing and the returned charge; lane caps and deadlines. |
| `src/complete/*` | 18 | keep | `bash_reads_every_completed_name_back_as_itself` guards shell injection from chips. It is the slowest test (1.55s). |
| `web/proto/*` | 7 | keep | Shared golden frames; retry and no-retry close codes. |
| `web/net/host.test.ts` | 13 | keep | Per-host reconnect, 4401, lifecycle. |
| `web/tabs/connection.test.ts` | 13 | keep | Pure reducer tests: the cheap, right tier. |
| `web/tabs/driver.test.ts` | 13 | merge 1 | The 4401 half of one test repeats `host.test.ts:164`. |
| `web/term/pipeline.test.ts` | 3 | delete 1 | The first case tests xterm.js itself, not our code. |
| `web/{files,complete,app,term/size}` | 33 | keep | Behaviour-level, cheap, no visible overlap. |

## 2. Deletion candidates

1. **The `.events` goldens in `tests/tmux_session.rs:118-127`, plus `render`/`flush` at `:614-695` and the 22 `tests/fixtures/tmux/3.4/*.events` files.**
   - What they guard: any change to the events `Session` emits.
   - Why that's covered: the same test already checks that the session writes exactly the recorded `.in` lines and that events don't depend on chunking. The targeted tests state the intent the goldens only capture (`locate_reads_…` :516, `notifications_become_events` :452, `failures_name_their_cause` :298). For example, `locate.events` repeats `:516` line for line.
   - Why delete: goldens with an `UPDATE_TMUX_EVENT_GOLDENS=1` escape hatch get regenerated without anyone reading the diff.

2. **`tmux_real.rs:907` `a_new_window_notifies_an_attached_control_client`.** `hub_real.rs:294` covers it fully: same real tmux and real pump, three creation paths instead of one, checked all the way to the wire.

3. **`web/term/pipeline.test.ts:13`, the "naive reset/resize/write … XABC" case.** It asserts how xterm.js behaves, not how `WritePipeline` behaves. Its point (why the pipeline exists) belongs in a comment in `pipeline.ts`. Also drop "(review p17 #1)" from the describe name: that's change history, not behaviour.

4. **The 4401 half of `web/tabs/driver.test.ts:106`.** The same path is tested at three other layers:
   - `link.test.ts:80`: no retry after 4401.
   - `host.test.ts:164`: halt, native notified, a tap retries.
   - `connection.test.ts:55`: the reducer's halt.

   Keep the drop-then-reconnect half.

5. **`src/tmux/mod.rs:520` `ids_round_trip_with_their_sigils`.** Every fixture replay and hub test parses ids.

6. **Optional: `src/auth/store.rs:459` `the_host_id_is_written_once`.** Low value. The `/auth/info` path in `http_auth.rs` reads the host id anyway.

## 3. Restructures, in order of impact

1. **Make vitest hermetic, and get CI green.**
   - `web/vite.config.ts:31-38` calls `devLogin()` (which shells out to `tailscale status`) whenever `command === "serve"`. vitest counts as "serve", so the test run needs a logged-in Tailscale. Locally `npx vitest run` dies with "Can't find the Tailscale login". CI run 39744660292 fails the same way.
   - Fix: add `&& !process.env["VITEST"]` to that condition, or look the login up lazily inside `configure`.
   - Every run since then fails earlier, at clippy: `fetch_update` is deprecated on current stable (`src/blocking.rs:154`). Fix that call and pin the toolchain with `rust-toolchain.toml` so stable can't break the gate again.

2. **Fix the HTTP harness flake in `tests/support/daemon.rs:132-158`.**
   - Probe: `http_auth` failed in 5 of 6 runs with `Connection reset by peer`. Instrumenting the scratch copy showed it is always a POST with a body: `/fs/roots/add`, `/fs/uploads-dir`, `/fs/upload`, `/complete`.
   - Cause: `send` writes the head and the body in two writes with `Connection: close`. The auth layer answers before reading the body, so the server closes with unread bytes and the OS answers with a reset.
   - Move: one `write_all` of head and body, and have the reader keep whatever it received before a reset. I haven't run the fixed version yet; confirm it before keeping it.

3. **Make the auth guard default-deny, so the test covers routes that don't exist yet.**
   - Today `device_check` is a `route_layer` on the `devices` sub-router (`src/http/mod.rs:150-163`). A route added beside `/auth/*` skips the check, and the hand list `DEVICE_ROUTES` (`tests/http_auth.rs:20`) wouldn't notice.
   - Move: apply `device_check` as an outer layer that exempts exactly `/auth/info` and `/auth/enroll`. Then assert that an unknown path (`/fs/anything-new`, `/x`) answers 401 rather than 404. That one assertion guards every future route, and the hand list stops being load-bearing.

4. **Put the real-tmux suites somewhere they run.**
   - `TETHER_TMUX_TESTS=1` isn't set by `preflight.sh` or CI, so "tmux is the source of truth / never start the server" is guarded only by an opt-in suite: `tmux_real.rs:923`, about 25s serial; `hub_real` adds about 10s.
   - ubuntu-latest's tmux is 3.4, your supported floor. Add a CI job: `apt install tmux`, then `TETHER_TMUX_TESTS=1 cargo test --test tmux_real --test hub_real -- --test-threads=1`.
   - Three tests fail on the Mac today:
     - `tmux_real.rs:1121` and `hub_real.rs:224`: they compare against an uncanonicalized `/tmp`, but macOS reports `/private/tmp`. Canonicalize `env::temp_dir()`. This is a platform bug and would fail on any tmux version.
     - `tmux_real.rs:986`: tmux 3.8 rejects a tab in a window name ("invalid window name"). That's a version change worth a decision, since 3.8 is what Homebrew installs.

5. **Re-shape the fs diff (your macOS question).**
   - The two cases do deserve guards, for different reasons:
     - Breaking case ties by bytes keeps the sort a total order. Paging re-scans the directory on every request, so an unstable order could skip or repeat entries between pages.
     - The non-UTF-8 refusal stops a lossy name from being reported as a real path.
   - **`open.rs:322` behind `cfg(target_os = "linux")` is the right shape.** The condition can't occur on APFS, so the gate is exact.
   - **`list.rs`: don't gate the case tie.** The tie-break is pure logic (`Scan::sort`, `list.rs:132-145`). Build a `Scan` in memory with names `A.txt`/`a.txt` and test the sort on every platform. Keep only the `caf\xe9` → `utf8: Some(false)` check behind the Linux gate.
   - Caveat: until move 1 lands, Linux-gated tests run nowhere.

6. **Split `tests/hub_state.rs`.** Move the fake `Hub` (lines 1-514) into `tests/support/fake_hub.rs`, leaving about 800 lines of tests. Replace magic numbers with exported constants: `30 - 24` and `25` at :1101-1107, `16s` at :594.

7. **Merge the four lifecycle tests in `tmux_real.rs:709-794`** (kill-server, kill-session, detach, SIGKILL) into one table: action → whether `%exit` arrives → what `LocateSession` answers. Same coverage, about 60 fewer lines.

8. **Merge `config_write.rs` tests 346-440 into two table tests:** edits to `HAND_WRITTEN`, and array-shape edge cases.

9. **Small items:**
   - `src/tmux/mod.rs:14` ships `pub mod fake` in the library. It could sit behind a `test-support` feature.
   - `complete/mod.rs:632` spawns about 96 bash processes (1.55s, the lib suite's critical path). One bash script per name would cut that to about 0.3s.

## 4. Unguarded risks that matter

1. **`src/http/ws.rs` (524 lines) has no direct test.** Only `http_auth.rs` checks the hello→welcome path. Nothing tests:
   - that an incompatible protocol closes the socket (`ws.rs:166-175`);
   - that **a removed device's live socket is closed** by `recheck` (`ws.rs:367`). That is an auth hole if it regresses;
   - that messages before hello are refused, or the connection-slot cap;
   - that paste files are written private (`write_private`, `ws.rs:509`).

   The cheapest tier is the `http_auth.rs` harness, which already opens sockets.
2. **The non-loopback refusal in `identity::check` (`src/auth/identity.rs:48`)** is never exercised, because tests always connect over loopback. It is pure and needs one assertion.
3. **New routes outside the device layer** (see §3.3).
4. **Design drift in `daemon-core.md` §8.** It promises committed 3.7b fixtures (only `tests/fixtures/tmux/3.4/` exists) and a run with no locale set (nothing sets `LANG`/`LC_ALL`). Either record them or change the spec.
5. **The real-tmux suite isn't being run on the Mac**, despite §8 saying "before each daemon-core commit, on the dev box and the Mac". The failures in §3.4 show it.

## 5. How much shrinks, how much faster

- **Size:** about 10 tests (229 → about 219) and about 400-500 lines of test code, plus 22 golden files. That's roughly 5% of 8.4k lines.
- **Speed: deleting tests saves almost nothing.** What I measured on this Mac:

  | Step | Time |
  |---|---|
  | lib unit tests | 1.68s wall (1.55s is the bash test) |
  | non-gated integration tests | under 1s |
  | vitest | 0.3s (0.8s with startup) |
  | `cargo test` including an incremental build | about 5s |
  | release build after a one-line change | about 14s |

  The deletions save under 0.5s. Batching the bash test saves about 1.2s. Merging the integration binaries into one would save at most 1-2s of linking. None of that is worth chasing. Preflight time is the compiler and the bundle, not the tests.

**Verdict: approve with notes.** Delete or merge the handful above. The work that pays is moves 1, 2 and 4 (make the suite run, and run reliably), then move 3 and the WebSocket gaps.

## Hypotheses (not checked)
- **Whether the single-write fix in §3.2 stops the flake.** I didn't try it.
- **Whether real clients see resets on refused POSTs.** Browsers use keep-alive, where hyper usually reads the body before closing, so this is probably harness-only. Not probed.
- **Whether the flake also happens on Linux.** Not run there.
- **The real-tmux suites on tmux 3.4 or 3.7b.** I only had 3.8, so the version-specific failure may not appear on your supported versions.
- **Whether a Linux machine runs `preflight.sh full` today.** If pushes come only from the Mac, the Linux-gated tests have no runner even locally.
