# Trim and restructure tether's tests, per the audit

Read `.meridian/work/tether-mvp/test-audit.md` first. Its §1 table, §2 deletion candidates and §3 restructures are the source for this task. The owner wants tests that guard important things and are well structured, with nothing kept for its own sake. Work in the primary checkout on `main`. Read `AGENTS.md`. **Don't commit**; the tech lead reviews and commits. Add no new test coverage.

Do these:
1. **Deletions, audit §2 items 1–6:**
   - the `.events` goldens in `tests/tmux_session.rs`, their render and flush helpers, the 22 `tests/fixtures/tmux/3.4/*.events` files, and the `UPDATE_TMUX_EVENT_GOLDENS` path;
   - `tmux_real.rs` `a_new_window_notifies_an_attached_control_client`;
   - the xterm-behaviour case in `web/term/pipeline.test.ts`: move its point into a comment in `pipeline.ts`, and drop "(review p17 #1)" from the describe name;
   - the 4401 half of `web/tabs/driver.test.ts:106`;
   - `src/tmux/mod.rs` `ids_round_trip_with_their_sigils`;
   - `src/auth/store.rs` `the_host_id_is_written_once`.

   Before each deletion, confirm the audit's claim that another test covers that risk. If you find it doesn't, keep the test and say why.
2. **Merges, audit §3.7 and §3.8:**
   - the four lifecycle tests in `tests/tmux_real.rs` (kill-server, kill-session, detach, SIGKILL) become one table test;
   - the five `src/fs/config_write.rs` tests become two table tests.

   Keep every assertion's intent.
3. **Split `tests/hub_state.rs`, audit §3.6:** move the fake hub into `tests/support/fake_hub.rs`, and replace the magic numbers the audit names with the production constants (export them only if that's clean).
4. **Update docs that describe the tests:** `docs/design/daemon-core.md` §8, any `AGENTS.md` or `.context/` notes, and the fixture README if there is one. Bring them in line in the same change. If §8 promises things that don't exist (3.7b fixtures, the run with no locale set), report it rather than inventing them.

Leave these alone:
- the auth guard and the HTTP route layering (an auth redesign is in progress);
- `src/tmux/mod.rs`'s `pub mod fake`;
- the bash completion test's speed.

## Verify
- `scripts/preflight.sh full`.
- `TETHER_TMUX_TESTS=1 cargo test --test tmux_real --test hub_real -- --test-threads=1`, on isolated `-L` sockets only, with a fresh `TMUX_TMPDIR`. Never touch the user's tmux server. Local tmux is 3.8, which has two known failures: the tab in a window name, and the default window name. Report any others.
- Report the test count before and after, the lines removed, and each deletion with the test that still covers its risk.
