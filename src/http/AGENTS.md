# http

The daemon's HTTP surface: axum on `127.0.0.1` only, published by `tailscale serve`.
`mod.rs` builds the router and both auth layers; `server.rs` owns the bounded TCP
accept loop and hyper HTTP/1 connections through shutdown. `error.rs` holds `Refusal`,
every HTTP error's status, body and headers; `enroll.rs` holds
`/auth/info` and `/auth/enroll`; `fs.rs` the thin `/fs/*` handlers over
[`src/fs/`](../fs/AGENTS.md); `complete.rs` the `/complete` handler over
[`src/complete/`](../complete/AGENTS.md); `ws.rs` runs one task per WebSocket, which
drives the hub through `HubHandle`. Nothing here names a tmux type.

Rules the code relies on, which are easy to break:

- A new route goes in the `devices` router in `mod.rs`, which gets the device check;
  only the two `/auth` routes sit outside it. The Tailscale check wraps everything,
  the fallback included. `tests/http_auth.rs` checks both layers over a real socket.
- A bad token on a WebSocket upgrade gets the upgrade and then close 4401, because a
  browser can't see a refused upgrade's status. A failed Tailscale check is a plain
  403, upgrade or not. An `auth.toml` that can't be read or parsed fails closed but
  retryable: 503 `auth_unavailable` or close 4503, at the upgrade and at the re-check
  alike. 4401 makes the app drop its token, so it means only "this token is gone".
  `error.rs`'s `auth()` is the one place that maps an `AuthError` to both.
- Every error body is `Refusal`: a `proto::HttpError` code (generated for TypeScript,
  so the web switches on the same names), its status, `Retry-After: 1` on every `busy`.
  A new code goes in `HttpError` and in `Refusal`'s status table; never write a code as
  a string.
- In `ws.rs`, every `ToConn` goes into the `Outbox`, and `take_credit()` goes back
  as `FromConn::Credit` whenever it is non-zero. The connection's own JSON (welcome,
  pong, a paste's refusal) is never charged; it waits in `own`, and while `own` is
  full the socket isn't read.
- The write future holds no state: the frame and the unflushed charges live in
  `Conn`, so `select!` can drop the future at any await. A write that kept its frame
  inside the future would lose the frame and its charge when dropped.
- The connection's socket cap comes from `App::caps`; inbound size, paste size and
  slots, the hello deadline, idle and re-check remain constants at the top of `ws.rs`.
  Their values come from [daemon-core.md §6](../../docs/design/daemon-core.md).
- `server.rs` takes one of 64 permits before each accept, sets 64 KiB
  `SO_SNDBUF`/`SO_RCVBUF`, and stores the permit in the I/O wrapper so an upgrade keeps
  it until the WebSocket closes. Hyper's read/write buffers are 16 KiB.
- Shutdown is bounded: graceful shutdown waits for every response, a stalled raw one
  too, so `serve` gives up after `SHUTDOWN_WAIT`. A connection left running keeps its
  `Arc<Ctx>`, and with it a `HubHandle`; `main` ends the hub with `HubHandle::stop`
  rather than waiting for every handle to drop.
- `newWindow`/`newSession` `dir` is checked in `ws.rs` with `fs::check_dir` (shape and
  a directory, not the roots, no config) on the dir lane, and passed to the hub as
  given. Paste files are written on the auth lane. Nothing here calls the blocking
  pool except through `App::lanes` (`src/blocking.rs`).
