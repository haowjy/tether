# Session-follow test cleanup

## Baseline and decision

Compared the dirty `main` tree against `3821927`. Jimmy's instruction was temporary verification only; no new regression cases should remain. I kept tests whose old behavior has a direct semantic counterpart and removed newly introduced coverage. The p243 recorded Rust gates and p245 web/real-daemon gates cover the cases before removal; p246 additionally records `hub_state` 33/33 after the daemon fix.

## Removed new cases

- Rust (`8`): `hub_state` — `take_is_due_for_fit_and_once_after_layout_moves_off_a_standing_vote`, `select_window_handles_the_current_event_before_or_after_its_reply`, `selecting_the_current_window_clears_selecting_and_a_failed_select_drops_claim`; `hub_real` — `a_large_watch_takes_the_window_and_a_pty_key_takes_it_back`, `a_window_switch_payload_is_measured_from_the_real_hub`; `tmux_real` — `a_large_take_resizes_the_window_and_the_pty_takes_it_back`, `current_window_subscription_follows_prefix_n_and_swap`; `tmux_session` — `current_window_fixture_follows_prefix_n_and_swap`.
- Web (`14`): `tabs/driver.test.ts` — the 3 band/claim additions (`says the window is sized for another terminal…`, `waits the last ping's round trip…`, `typing claims too…`), 1 history-pane case, 3 input cases (window-at-type, before-watching, refusal), 1 upload-window case, and all 3 `windows` cases; `workspace/state.test.ts` — `a watching reply sets the window name…` and `a listing never overrides…`; `sessions/groups.test.ts` — `never matches a window name`.
- Removed the dedicated `current-window` tmux recorder scenario, replay case, and both versions' `current-window.{in,out,script}` fixtures. Removed test-only command decoding/modeling and measurement helpers that had no remaining caller.

## Kept as migrated coverage

- The Rust `a_session_watch_follows_prefix_n_and_swap`, `a_swap_reported_by_the_current_window_subscription_is_followed`, and `an_owner_moved_by_session_destruction_closes_the_gone_session` cases replace old move-window/last-window coverage; retained with session semantics.
- `tmux_real::locate_is_session_scoped` and `tmux_session::locate_reads_the_session_current_window_and_server_instance` adapt old locate tests. The existing tmux recordings were re-recorded for changed commands and remain.
- Existing web cases for session names/listing and adapted e2e flows remain. In particular, the workspace no-op case formerly covering `renamed` plus listing is retained as the same state-no-op contract adapted to `watching` plus listing; `findSession` retains the old run-scoped `findWindow` lookup coverage.
- Bridge/auth contract fixtures remain updated, as requested.

## Checkpoints

- Inventory and p243/p245/p246 prior-gate evidence reviewed before edits.
- Case/helper removal complete. `cargo fmt --all -- --check` and `cargo test` pass (97 library, 21 http_auth, 4 http_fs, 4 hub_real, 30 hub_state, 18 tmux_real, 16 tmux_session; 190 total plus zero-test targets). Default `cargo test` leaves the real-tmux gates disabled; prior p243/p245 records cover the new real cases.
- `cargo clippy --all-targets -- -D warnings` and `cargo +1.85 check --locked --all-targets` pass.
- `pnpm --dir web run check` passes: typecheck, lint, source checks, 34 files / 392 tests, build, and build checks. Its first run caught an empty `describe("windows")` after the three cases were removed; the empty suite was deleted and the rerun passed.
- The retained Rust suite counts are back to the base counts: hub state 30, hub real 4, tmux real 18, tmux session 16. The removed current-window recorder comment claiming the initial subscription value was not an event is gone; the retained migrated hub test now says the initial `@0` confirms current state and the later report follows the swap.
- No `src/` tests or production source were changed. Scoped `git diff --check` and checks that all six `current-window` fixture files are absent pass.
- No full E2E rerun was done for deleting unit cases. No commits or pushes.
