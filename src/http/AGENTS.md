# http

The daemon's HTTP surface: axum on `127.0.0.1` only, published by `tailscale serve`.
`mod.rs` builds the router and both auth layers and serves until shutdown; `enroll.rs`
holds `/auth/info` and `/auth/enroll`; `ws.rs` runs one task per WebSocket, which
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
- In `ws.rs`, every `ToConn` goes into the `Outbox`, and `take_credit()` goes back
  as `FromConn::Credit` whenever it is non-zero. The connection's own JSON (welcome,
  pong, a paste's refusal) is never charged; it waits in `own`, and while `own` is
  full the socket isn't read.
- The write future holds no state: the frame and the unflushed charges live in
  `Conn`, so `select!` can drop the future at any await. A write that kept its frame
  inside the future would lose the frame and its charge when dropped.
- The connection's own limits (sockets, inbound size, paste size and slots, the hello
  deadline, idle and re-check) are constants at the top of `ws.rs`; their values come
  from [daemon-core.md §6](../../docs/design/daemon-core.md).
