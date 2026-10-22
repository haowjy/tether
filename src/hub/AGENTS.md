# hub

`State` (state.rs, owners.rs, requests.rs, reconcile.rs) is the hub as one pure
value: no I/O, no clock, no shared state. Time comes in with each input, so a test can
drive it with scripted inputs and a fake clock. `run.rs` is the only file that awaits or
spawns: it executes `Effect`s and never waits on a pump or a connection (`try_send`).
`Outbox` is pure and lives in each connection task. The hub never names a socket or an
HTTP type; `http/` drives a connection through `HubHandle`, `FromConn` and `ToConn`.

Rules the code relies on, which are easy to break:

- Every byte to a connection is charged against its credit (`ToConn::charge`), and
  every charge comes back exactly once (written or discarded by the outbox). A
  reservation taken for a capture or listing goes back on every path: answered,
  abandoned by a stream break, the watch leaving, the client or connection ending.
- A window binds only from a Locate its future owner answered (`Locate::on`): replies
  and notifications are ordered per control client, not across them.
- A tag stays in its client's `pending` until tmux answers it, even when the hub
  stopped caring (`Work::Snapshot { window: None }`): that is how capture slots are
  counted. A Release frees the slots of the snapshots it invalidated when it is answered.
- Nothing is sent to a control client before `Ready`, and maintenance never gets
  `busy`: reconcile waits for room instead.
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
writes; `tests/hub_real.rs` runs the hub with real pumps on a private tmux server
(`TETHER_TMUX_TESTS=1`, under `nice -n 10`).
