# tmux core

Pure: no process, filesystem, clock or shared state, except the I/O files the spec
names (`pump.rs`, `oneshot.rs`). `Session` is the control client as a state machine and
owns reply matching, wanted and paused panes, and the in-flight cap; `command.rs` is the
only place tmux command text is built. Unknown protocol lines are non-fatal. Never log
raw pane output or reply bodies.

Tests replay recorded tmux streams and require `Session` to write exactly the recorded
lines (`.in`), so any change to command text needs the fixtures re-recorded:
`cargo run --example record-tmux-fixtures -- --out tests/fixtures/tmux/3.4`, then
`UPDATE_TMUX_EVENT_GOLDENS=1 cargo test --test tmux_session`, and read the diff of the
`.events` goldens before keeping it.
