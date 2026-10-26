# http

The daemon's HTTP surface: bounded hyper HTTP/1 connections over its private fronts.
`server.rs` owns the shared accept loop and shutdown for Unix or TCP listeners; it runs
the listener's `Front` gate before the router, then inserts only its copyable `NodeLane`
view on passing requests. `front.rs` owns the lane view and gate. `mod.rs` builds the
router and orders the Tailscale/login check before native-token or enrolled-node
admission. The node lane's pure policy is in `src/auth/node.rs`.

`shell.rs` streams only the build-time embedded asset manifest; unknown paths never
fall back to `index.html`. `enroll.rs` holds `/auth/info` and native enrolment,
`node_auth.rs` holds node session/enrol/remove routes, `fs.rs` and `complete.rs` are
thin route handlers over their subsystems, and `ws.rs` drives the hub. Nothing here
names a tmux type.

`POST /auth/node/enroll` keeps non-empty-code node enrolment separate from the empty-
code path: only an already enrolled node may mint a native token, and that native row
is bound to the node so `/auth/node/remove` revokes it too.

Rules the code relies on, which are easy to break:

- Every route, including shell and fallback paths, stays behind the Tailscale check.
  `Front::UnixServe` gates on `Host: localhost`; `Front::Loopback` checks its raw
  request-target path secret in constant time and published authority before routing;
  it refuses absolute-form URIs and duplicate `Host`/`X-Forwarded-Host`. The
  path-secret miss is an empty 404 before headers or route work. The shell and
  `/auth/info` skip device admission so a cold launch can load. Keep `Front` derived
  from the listening socket, never from request headers.
- A node-lane request is judged before handler work: canonical origin and request
  metadata, one tailnet `X-Forwarded-For`, whois, node rules, then the device row.
  Never trust these headers on `local.sock`; it is the dev/native front.
- A bad native token never falls back to node admission. A browser is tokenless, and
  its node lane is available only on the Unix Serve front or the Mac Loopback front.
  `/auth/enroll` refuses browser Origin/fetch metadata because it returns a native token.
- Use `Refusal`/`HttpError` in `error.rs` for the shared route errors and
  status/header mapping. Browser admission's `bad_origin`, `node_refused`,
  `not_enrolled` and `identity_unavailable` codes are part of the shared generated
  protocol type; don't hand-build error JSON or duplicate HTTP-code maps in handlers.
- In `ws.rs`, every `ToConn` goes into the `Outbox`, and `take_credit()` goes back
  as `FromConn::Credit` whenever it is non-zero. The connection's own JSON (welcome,
  pong, a paste's refusal) is never charged; it waits in `own`, and while `own` is
  full the socket isn't read.
- The write future holds no state: the frame and the unflushed charges live in `Conn`,
  so `select!` can drop the future at any await without losing the frame or charge.
- The periodic device re-check runs outside the socket I/O loop; the loop receives its
  bounded result channel so a slow LocalAPI call cannot stall terminal reads/writes.
- The upgraded-socket cap comes from `App::caps`; inbound size, paste slots, hello,
  idle and auth-recheck limits remain constants in `ws.rs` and `daemon-core.md`.
  Shell responses have independent 4-slot/16-waiter caps and a 30 s write stall.
- `server.rs` takes one of 64 shared permits before either socket accept, sets 64 KiB
  `SO_SNDBUF`/`SO_RCVBUF`, and stores the permit in the I/O wrapper so an upgrade
  keeps it until the socket closes. Hyper's read/write buffers are 16 KiB.
- Shutdown is bounded: stalled responses are dropped at the 2 s connection deadline;
  a WebSocket left running keeps its `Arc<Ctx>`, so `main` ends the hub with
  `HubHandle::stop` rather than waiting for every handle to drop.
- `newWindow`/`newSession` `dir` is checked with `fs::check_dir` (shape and an existing
  directory, not the roots, no config) on the dir lane and passed through. Paste files
  are written on the auth lane. Nothing here calls the blocking pool except through
  `App::lanes` (`src/blocking.rs`).
- Route-specific slot and waiter limits use `PermitPool`; shell owns the named 4-slot,
  16-waiter limits. Do not add another semaphore-plus-waiter implementation.
