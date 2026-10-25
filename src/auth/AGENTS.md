# auth

Request admission and durable device state for the daemon ([auth.md](../../docs/design/auth.md)).
The listener front selects the lane: native tokens work on local and Serve fronts;
enrolled nodes work only on Linux `serve.sock` and the Mac Loopback front.
`mod.rs` owns admission and live-socket rechecks;
`identity.rs` owns the shared 10 s/30 s tailnet-state cell, Serve-config parsing,
target and canonical-origin calculation; `mac_front.rs` owns Mac front identity and
secret generation and wires its target, publication state and request gate together;
`localapi.rs` owns LocalAPI transport and keep-alive clients, bounded uncached whois,
status/prefs/whois response parsing and typed Serve-write errors; `publish.rs` owns
the raw-JSON Serve plans and three-attempt compare-and-swap loop shared by Mac
publication, setup and teardown. Mac bind-failure withdrawal retries until its 2 s
deadline. All plans are judged by the same canonical-origin rule used for admission.
`node.rs` owns pure forwarded-address, node and browser-origin rules;
`token.rs` owns tokens, codes and hashes; `store.rs` owns the shared
`auth.toml` read-modify-write and native/node row shapes.

Rules the code relies on, which are easy to break:

- Every write of `auth.toml` goes through `Store::update`, which holds the state
  directory's flock (`files::lock`, `src/files.rs`) for the whole read-modify-write,
  lands through `files::Temp::replace` (temp file, fsync, rename, directory fsync), and
  writes nothing when nothing changed. A file that doesn't parse is never overwritten;
  unknown row fields refuse that row alone, and the refused TOML row is preserved
  unchanged by later writes. Name allocation checks both typed and refused rows, and
  `device list` shows names from refused rows; `remove_device` can remove one by name.
- Checks re-read `auth.toml`, so `tether device remove` reaches a running daemon with
  no IPC and closes a live socket at its next 10 s check. Don't add a device cache.
- Only native token hashes are stored. Browser nodes store the stable node ID and
  owner login; the node lane has no cookie or portable credential. Never log tokens,
  path secrets, codes or file contents. On Mac the path secret lives in the Serve
  proxy target; `ServeTarget` and handler `Debug` implementations redact it, while
  the logged canonical browser origin contains only the public authority.
- Whois is never cached between requests. Same-address requests share one in-flight
  result; two LocalAPI clients run at once and at most 16 distinct addresses wait.
  Keep the address-family, node eligibility and login-match decisions in `node.rs`.
- The tailnet-state cell is intentionally shared: status and Serve config are read
  together. A healthy but stale value starts or joins a fill and waits; only a failed
  read permits a held value to be used until it is 30 s old. Retries run in the
  background with a 2–30 s backoff, independent of request demand. Don't turn startup
  LocalAPI availability into a daemon startup gate.
- Mac publication exposes one `watch<PublicationState>` to the front and `/auth/info`;
  while it is waiting, tailnet-state observations must not report a missing origin.
  Non-transient publication failures remain visible in `browserRefused` as the task
  retries, while LocalAPI I/O and timeouts back off quietly. `/auth/info` reports
  `browserPending` while that watch is waiting; it is always false on Linux.
- Store operations block on disk and run on the auth lane (`src/blocking.rs`), as
  request checks do; a hung mount must not take the runtime thread or other lanes.
