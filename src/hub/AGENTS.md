# hub

`State` (state.rs with owners.rs, requests.rs, reconcile.rs, credit.rs, time.rs and
names.rs, each an `impl State` part, plus the per-session `View` in view.rs) is the hub as one pure value: no I/O, no clock,
no shared state. Time comes in with each input, so a test can drive it with scripted
inputs and a fake clock. `run.rs` is the only file that awaits or spawns: it executes
`Effect`s and never waits on a pump or a connection (`try_send`).
`Outbox` is pure and lives in each connection task. The hub never names a socket or an
HTTP type; `http/` drives a connection through `HubHandle`, `FromConn` and `ToConn`.

Rules the code relies on, which are easy to break:

- Every byte to a connection is charged against its credit (`ToConn::charge`), and
  every charge comes back exactly once (written or discarded by the outbox). A
  reservation taken for a capture or listing goes back on every path: answered,
  abandoned by a stream break, the watch leaving, the client or connection ending.
  `Conn.reserved` is a counter because deriving it costs the output path too much;
  debug builds check it against the work in flight after every input.
- A session view binds only from a Locate its future owner answered (`on` in
  `ViewPhase::Locating`): replies and notifications are ordered per control client,
  not across them. Once bound, it stays bound to its shown pane while a window-change
  Locate runs; only the target changes until the answer coherently updates the shown
  window and pane.
- An orphan's Locate belongs to its exit check. Do not run a parallel view Locate while
  the view is `Orphaned`: the exit check must decide whether to respawn the owner first.
- `View` (view.rs) is the one owner of a view's shown window, reported window,
  selection and claim. The claim stores no window: its window is `View::target()`,
  and every change to what `target()` returns goes through `retarget`, which drops a
  claim whose target moved. Add a `View` method for a new transition; changing the
  selection or a window from a handler in another file re-creates claims left on
  windows the tab has left. Per-window cwd belongs to the owner's `tmux::Session`, not the view.
- A tag stays in its client's `pending` until tmux answers it, even when the hub
  stopped caring: that is how capture slots are counted. A snapshot answer counts only
  if its window's stream still waits for that tag (`take_if`). A snapshot a Release
  invalidated answers `Released`, which frees its slot.
- Nothing is sent to a control client before `Ready`, and maintenance never gets
  `busy`: reconcile waits for room instead.
- `State::new` receives the startup-selected control-client cap. If all slots are
  occupied and none is lingering, the watch ends with `reason: "limit"`; the message
  names the host and session names from Locate. This path must not run a one-shot just
  to render the refusal.
- `State` owns every lifecycle; `run.rs` only mirrors it. Whatever removes a
  connection or a started control client from `State` emits `DropConn` or
  `CloseClient`, however it ended, or the executor's channel for it leaks.
- Time is handled only when an input comes: `handle` treats any input at or past
  `next_deadline()` as a Tick, since the runtime may pick pump input over its timer.
  A deadline is reported only until then, so one that can't be acted on can't spin.
- `run` returns only after every pump has ended (stdin closed, tmux gone): the
  runtime's end would otherwise kill `tmux -C`.
- Logs carry ids, kinds and lengths only, never pane output, reply bodies or input.

`tests/hub_state.rs` drives `State` against a fake tmux that answers the lines the hub
writes (through `tmux::fake`, so it never spells tmux commands); `tests/hub_real.rs`
runs the hub with real pumps on a private tmux server (`TETHER_TMUX_TESTS=1`, under
`nice -n 10`).
