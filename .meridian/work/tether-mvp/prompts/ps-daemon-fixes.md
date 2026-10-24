# PS-daemon: fix round 1 (review p126)

Read `meridian spawn show p126`. Fix, `src/`/`tests/`/fixtures/CHANGELOG only (another coder edits `web/` concurrently; don't touch it):
- M1: the CHANGELOG bullet claims re-watch behaviour the web lacks. Reword to what ships now (daemon side), and note in the PS-web lane text in `.meridian/work/tether-mvp/build-plan.md` that PS-web must send `watch { claim:false }` on automatic re-watches, must not follow a re-watch with an automatic `resize`, and owns the user-visible changelog wording.
- L1: skip an unparsable client entry instead of dropping the whole value; always handle the path after the first `|`.
- L2: no `unreachable!` arm — call `subscription_changed` from the arm.
- L3: add the `|`-in-path case to the session unit test (named by §8), and run the targeted session tests over both 3.4 and 3.7b fixture dirs.
- L4: move `an_act_reported_by_a_non_owner_does_not_yield_the_claim` into `tests/hub_state.rs` driven through the fake tmux; add a helper for the repeated `Event::Acted` match in `tmux_real.rs`.
Verify: cargo fmt/clippy -D warnings/test/build --release, `cargo +1.85 check --locked --all-targets`, real-tmux sizing on 3.4 and 3.7b. Don't commit. Report per finding.
Spawn env TMPDIR=/tmp/tether-meridian-501.
