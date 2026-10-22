# tmux core

Pure: no process, filesystem, clock or shared state, except the two I/O files,
`pump.rs` (one task per `tmux -C` process) and `oneshot.rs`. `Endpoint::command` in
`mod.rs` builds, never runs, the one `tmux -u -N` invocation both use. `Session` is the
control client as a state machine and owns reply matching, wanted panes, pauses in
flight and the in-flight cap; `command.rs` is the only place tmux command text is built,
control-client lines and one-shot arguments alike. Unknown protocol lines are
non-fatal. Never log raw pane output or reply bodies.

Tests replay recorded tmux streams and require `Session` to write exactly the recorded
lines (`.in`), so any change to command text needs the fixtures re-recorded:
`cargo run --example record-tmux-fixtures -- --out tests/fixtures/tmux/3.4`, then
`UPDATE_TMUX_EVENT_GOLDENS=1 cargo test --test tmux_session`, and read the diff of the
`.events` goldens before keeping it. The `snapshot-*` fixtures also feed the `vt100`
restore tests in `snapshot.rs`, so re-recording them re-checks `compose` too.

`tests/tmux_real.rs` runs `Session` over the real pump, and the one-shots, against
private tmux servers: the snapshot boundary under floods, torn snapshots, Gaps, and
every way a control client ends. It is skipped unless `TETHER_TMUX_TESTS=1`
(`TETHER_TMUX` picks the binary; the Gap test needs `script`); run it, under
`nice -n 10`, after any change here.
