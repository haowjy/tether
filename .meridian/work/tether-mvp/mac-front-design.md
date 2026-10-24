# Mac front: build order (p171, revised after reviews p172–p173 and Jimmy's answers of 2026-10-24)

The rules are in `docs/design/auth.md` ("Reaching LocalAPI", "The Mac front",
"Canonical origin", Mac gates M0–M8) and the reasons in `docs/design/decisions.md`
("A Mac can host tether, behind a path secret" and "## The Mac front"). This note is
for the implementation lead: which files change, in what order, and what each step
must leave true. Probe evidence: `mac-front-probes.md`, `mac-host-peer-provenance.md`.

Jimmy's answers fixed four things: the Mac has only his account, tether runs from a
LaunchAgent (no sudo), Tailscale's log upload is off (a setup step tether doesn't
check), and launchd's socket comes through a local `src/launchd.rs`, not `raunch`.
They removed unpublishing, `tether unpublish`, and the LocalAPI endpoint pinning.

Two refactors come first and change no behaviour on either platform; Linux stays
byte-for-byte the same through every step, and the existing integration tests
(`tests/support/daemon.rs` builds a Unix Serve front and a fake LocalAPI) must pass
unchanged apart from constructor signatures.

## R1. LocalAPI transport (refactor, no behaviour change)

- New `src/auth/localapi.rs`: move `LocalApi`, `Client`, `connect`, `request`, the
  whois pool and `parse_json` out of `identity.rs`.
- `enum Transport { Unix(Option<PathBuf>) }` for now: `None` searches today's
  `SOCKETS`, `Some` is `LocalApi::at` for tests. `connect` returns an
  `Endpoint { sender, authorization: Option<HeaderValue> }`; `Client` keeps the
  header with its sender and adds it to every request on that connection. The
  endpoint is looked up in `connect`, as `socket_path()` is today.
- Request body becomes `Full<Bytes>` (empty for GETs) so a later POST shares the
  client.
- Error text for a missing socket stays identical on Linux.

## R2. Fronts and serve targets (refactor, no behaviour change)

- New `src/http/front.rs`: `enum Front { UnixServe, Local }` with `fn lanes()`
  (node lane allowed or not) and `fn gate(&self, Request) -> Result<Request, Response>`
  (today's `localhost` rule for `UnixServe`; nothing for `Local`). The gate runs in
  `server.rs`'s per-connection `service_fn`, before `routes.oneshot`: axum 0.8 routes
  before `Router::layer` middleware, so a gate in `tailscale_check` would see the
  already-routed `/<secret>/…` path. The `localhost` refusal must keep today's
  `403 forbidden` body and `common_headers` (the gate's `Response` is built by the
  same helper), so Linux answers stay identical; `tailscale_check` loses its inline
  `Host` test. `auth::Front`
  either becomes this type's lane view or is replaced by it; one name per concept.
- `identity.rs`: `enum ServeTarget { Unix { identity: SocketIdentity, path: PathBuf } }`.
  `ServeConfig::canonical_origin(&ServeTarget)`; `Auth::with_local_api(.., Option<ServeTarget>)`
  replaces `serve_socket`/`serve_path`. `tether enroll` builds the same target.
- `http/server.rs`: `serve(fronts: Vec<(Listener, Front)>, ..)`, where `Listener` is
  `Unix(UnixListener) | Tcp(TcpListener)` and the accepted stream is an enum
  implementing `AsyncRead + AsyncWrite` (the permit wrapper is already generic in
  spirit; `small_buffers` and `TCP_NODELAY` for TCP). Accept from all with one
  `select!` over a small fixed set.

## M1. macOS transport

- `Transport::MacProof`, chosen by `LocalApi::system()` under `cfg(target_os = "macos")`.
  `connect`: readlink `/Library/Tailscale/ipnport`, read `sameuserproof-<port>`,
  trim; else spawn `lsof -n -a -u<uid> -c IPNExtension -F` (tokio process, inside the
  2 s timeout) and parse `.tailscale.ipn.macos/sameuserproof-<port>-<token>`. TCP to
  `127.0.0.1:<port>`, `Authorization: Basic base64(":" + token)`.
- `EACCES` on the token file maps to a `LocalApiError` whose text says the daemon's
  user must be an admin. Never log the token.
- Effect on macOS: LocalAPI now answers; the Unix `serve.sock` still exists on macOS
  until M2, and its refusal message is wrong there for one commit. Land M1 and M2
  together if that matters.

## M2. The Mac front

- `config.rs`/`main.rs`: `tether serve --publish`. On Linux, exit 78 with "on Linux,
  publish with `sudo tailscale serve …`". On macOS without it: bind `local.sock` only.
- New `src/launchd.rs`, declared `#[cfg(target_os = "macos")]` in `lib.rs`; port the
  24-line module p175 ran under launchd (source in `mac-front-probes.md`):
  - `pub fn activate_socket(name: &str) -> io::Result<Vec<OwnedFd>>` over
    `unsafe extern "C" { fn launch_activate_socket(...) }` (edition 2024 needs the
    `unsafe extern`); a null array is `Ok(vec![])`; errno passes through as
    `io::Error::from_raw_os_error`; `libc::free` the array.
  - `#![allow(unsafe_code)]` in the module, a `// SAFETY:` comment on every block
    (stable clippy with `undocumented_unsafe_blocks` rejected the probe's bare
    `free`). `lib.rs`: `#![forbid(unsafe_code)]` → `#![deny(unsafe_code)]`, since a
    module can't override `forbid`; `main.rs` keeps `forbid`.
  - `Cargo.toml`: `[target.'cfg(target_os = "macos")'.dependencies] libc = "0.2"`
    (already 0.2.191 in the lockfile).
- `runtime.rs`: on macOS, bind no `serve.sock`; with `--publish`, after the lock, call
  `activate_socket("Listener")`. Exactly one fd → `std::net::TcpListener::from(fd)`,
  `set_nonblocking(true)` (launchd hands it over blocking), then
  `tokio::net::TcpListener::from_std`, and read the port from `local_addr`. Any error,
  or a count other than one → exit 78 with "no launchd socket `Listener`": launchd
  answers `ESRCH` both outside launchd and for a name the plist lacks, so the message
  must not claim which.
- The bound check: `local_addr` must be `127.0.0.1` with a non-zero port. launchd
  hands over an unbound fd (`0.0.0.0:0`) when another process held the port at load
  (p177). Fail → withdraw (M3), then exit 78 "launchd couldn't bind the Mac front's
  port; another process holds it". Until M3 lands, just exit 78.
- Path secret: `tether-` + base64url(32 bytes from `getrandom`), generated in
  `main.rs`, handed to the front and the serve target; never logged (check every
  `tracing` field that carries a path or a URI).
- `front.rs`: `Front::Loopback { secret, authority: watch/ArcSwap<Option<String>> }`.
  Gate: constant-time compare (`subtle`) of the raw path's first `len + 2` bytes with
  `/<secret>/`, a shorter path failing; rewrite the URI to the remainder plus the query; empty 404 on mismatch,
  returned before `common_headers` or any LocalAPI call. Then the authority rule.
- `ServeTarget::Loopback { port, secret }`; canonical-origin references are every
  target on that port, whatever the host; the sole handler must be exactly
  `http://127.0.0.1:<port>/<secret>`. Refusal text comes from the target
  (`ServeConfig::refusal` and `old_default_target` become Unix-target only). Give
  `Handler`/`ServeConfig` a `Debug` that redacts `proxy`. Unit-test with the same
  fixture style as the Unix target.

## M3. Publication

- `localapi.rs`: `serve_config_raw() -> (serde_json::Value, etag)` and
  `set_serve_config(value, etag) -> Result<(), Conflict | LocalApiError>`.
- New `src/auth/publish.rs`, sans-IO: `plan_publish(config: Value, name: &str,
  target: &str) -> Result<Value, PublishRefusal>`. Work on `serde_json::Value` so
  unknown fields survive. The tether-shaped matcher lives here. No inverse: tether
  never unpublishes.
- `plan_withdraw(config, name) -> Option<Value>`: remove every handler in
  `Web["<name>:443"]` whose proxy is `http://127.0.0.1:<any port>/tether-<43>`, with the
  same entry and `TCP` cleanup. Run once at the bound-check failure: read with `Etag`,
  write with `If-Match`, re-plan on 412, all within 2 s, then exit 78 whatever happened.
- One task owns the publication state (waiting, published, refused), started by
  `Auth::start`: wait for the cell, plan, write with `If-Match`, re-plan on 412 up to
  3 times, else back off with the cell's schedule; on success set the front's
  published authority and refresh the cell. Refusal: log once and put the message in
  `browserRefused`. Shutdown just drops the task; nothing new on any exit path.
- `tether enroll` on macOS: `GET /auth/info` from the running daemon over
  `local.sock`, sending the owner login from LocalAPI status; print `browserOrigin`
  or `browserRefused`, or "tether isn't running".

## M4. Ship

- `contrib/com.jimmyyao.tether.plist`: a LaunchAgent with `@HOME@` and `@PATH@`
  placeholders (running.md fills them with `sed` into `~/Library/LaunchAgents/`):
  `Label com.jimmyyao.tether`, `ProgramArguments [@HOME@/.cargo/bin/tether, serve,
  --publish]`, `EnvironmentVariables {PATH: @PATH@}` (launchd sets `HOME` and `TMPDIR`
  for agents; M0 confirms `HOME`), `Sockets {Listener: {SockNodeName 127.0.0.1,
  SockServiceName 7851, SockFamily IPv4, SockType stream}}`, `RunAtLoad` and
  `KeepAlive` true, `StandardErrorPath @HOME@/Library/Logs/tether.log`.
- `docs/running.md`: remove the "Not built yet" note; `docs/design/plan.md`: remove
  "not built yet". `CHANGELOG.md` `[Unreleased]`: "tether can host on a Mac with the
  Tailscale app (`tether serve --publish`, from a LaunchAgent)".
- Run gates M0–M7 on this Mac (M7, the log opt-out, before the first publish), plus
  G2, G3, G7, G9, G11 against the Mac front.

## Review focus for each step

- R1/R2: Linux behaviour identical; no new allocation per request on the hot path.
- M2: the gate runs in `server.rs` before the router, on every request including the
  shell routes, `/auth/info` and WebSocket upgrades; no log line or error body can
  contain the secret; constant-time compare doesn't short-circuit on content.
- M2: `launchd.rs` is the only `unsafe` in the crate, every fd it returns is owned,
  the listener is non-blocking before tokio sees it, and an unbound socket never
  reaches the accept loop.
- M3: the plan preserves unknown JSON and removes only tether-shaped handlers for its
  port; no write ever happens without `If-Match`; no write after the first success.
