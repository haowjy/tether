# auth

Request admission and durable device state for the daemon ([auth.md](../../docs/design/auth.md)).
The socket front selects the lane: native token on either front, enrolled Tailscale
node only on `serve.sock`. `mod.rs` owns admission and live-socket rechecks;
`identity.rs` owns Serve headers, the shared 10 s/30 s tailnet-state cell, keep-alive
LocalAPI and bounded, uncached whois; `node.rs` owns pure forwarded-address, node and
browser-origin rules; `token.rs` owns tokens, codes and hashes; `store.rs` owns the
shared `auth.toml` read-modify-write and native/node row shapes.

Rules the code relies on, which are easy to break:

- Every write of `auth.toml` goes through `Store::update`, which holds the state
  directory's flock (`files::lock`, `src/files.rs`) for the whole read-modify-write,
  lands through `files::Temp::replace` (temp file, fsync, rename, directory fsync), and
  writes nothing when nothing changed. A file that doesn't parse is never overwritten;
  unknown row fields refuse that row alone, and the refused TOML row is preserved
  unchanged by later writes. Name allocation checks both typed and refused rows;
  `remove_device` can remove one by its `name`.
- Checks re-read `auth.toml`, so `tether device remove` reaches a running daemon with
  no IPC and closes a live socket at its next 10 s check. Don't add a device cache.
- Only native token hashes are stored. Browser nodes store the stable node ID and
  owner login; the node lane has no cookie or portable credential. Never log tokens,
  codes or file contents.
- Whois is never cached between requests. Same-address requests share one in-flight
  result; two LocalAPI clients run at once and at most 16 distinct addresses wait.
  Keep the address-family, node eligibility and login-match decisions in `node.rs`.
- The tailnet-state cell is intentionally shared: status and Serve config are read
  together. A healthy but stale value starts or joins a fill and waits; only a failed
  read permits a held value to be used until it is 30 s old. Retries run in the
  background with a 2–30 s backoff, independent of request demand. Don't turn startup
  LocalAPI availability into a daemon startup gate.
- Store operations block on disk and run on the auth lane (`src/blocking.rs`), as
  request checks do; a hung mount must not take the runtime thread or other lanes.
