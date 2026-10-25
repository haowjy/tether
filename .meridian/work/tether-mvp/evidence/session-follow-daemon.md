# Session follow + take: daemon implementation evidence

The daemon half of lane 1a/1b is implemented in the working tree (not committed).
`docs/design/daemon-core.md` now describes the Locate row additions needed by the
implementation: `session_name` precedes `window_name`, which remains final because
tmux can put tabs in a window name. The session name supports the existing session-slot
refusal text.

## Verification

- Rust library tests: 97 passed; complete `cargo test`: 198 passed. The build script's
  separate web build was bypassed with a temporary no-op `pnpm` wrapper because the
  protocol-2 client belongs to the next lane; web typechecking is expected to fail until
  that lane lands.
- Hub state tests: 33 passed, including all take triggers/no-repeat behavior, both
  selection reply/notification orders, swaps, and `selecting` clearing.
- Recorded tmux session tests: 17 passed each for 3.4 and 3.7b.
- Real tmux tests: `tmux_real` 20/20 and `hub_real` 6/6 on each of 3.4 and 3.7b.
  These cover 274x53 watch vs 80x24 pty (watch takes, pty key takes back), laptop
  prefix-n, and swap follow. All tests use isolated `-L` servers.
- `cargo clippy --all-targets -- -D warnings`, the same with
  `--target x86_64-unknown-linux-gnu`, `cargo +1.85 check --locked --all-targets`,
  `cargo fmt --all -- --check`, and selective `git diff --check`: passed.
- Real hub switch payload: 61 B client-to-daemon plus 356 B daemon-to-client = 417 B
  JSON/binary application payload, excluding WebSocket/TLS framing; same measurement
  on tmux 3.4 and 3.7b.

## Resource sample and remaining measurement gap

Built the release daemon and ran it on macOS with an isolated tmux `-L` socket and a
42 MiB configured budget. Seven idle RSS samples over 30 seconds were 5,856–5,872 KiB
(median 5,872 KiB / 5.73 MiB, about 13.6% of 42 MiB). This is an idle macOS process
sample, not a watcher workload or Linux cgroup measurement; it does not establish the
full budget result in `evidence/budget/README.md`. Repeat the Linux/cgroup workload
matrix against this implementation before treating the resource-budget probe as
complete.

Design review is recorded at p233 in `design-session-follow-and-folder-find.md`;
independent code review remains for the lead before integration.

## Client-lane wire delta

Protocol version and minimum are 2. `watch` now identifies a `session`; `watching`
returns a `ShownWindow` (`id`, `index`, `name`, window `size`); `input` and `paste`
carry the shown `window`; `selectWindow` was added; `newWindow.watch` is optional;
`historyChunk` carries `pane`. The old `windowClosed` and `windowRenamed` messages are
gone. Session restore/list identity remains `SessionRef`. Generated TypeScript was
regenerated; no other web source was changed.
