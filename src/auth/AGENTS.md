# auth

Who may use the daemon ([auth.md](../../docs/design/auth.md)): plain functions over
the files in `$XDG_STATE_HOME/tether/`, with no task and no cache. `identity.rs` is the
Tailscale side: the header check, and a small LocalAPI client for the owner's login,
the MagicDNS name and the serve config (the Funnel check). `token.rs` is pure: tokens,
codes, host ids, hashes and the constant-time scan. `store.rs` does every file read
and write. `mod.rs` holds `Auth::check`, which `http/` calls from its middleware, and
`Auth::recheck`, each socket's re-check: both find the token with `token::find`.

Rules the code relies on, which are easy to break:

- Every write of `auth.toml` goes through `Store::update`, which holds the state
  directory's flock (`files::lock`, `src/files.rs`) for the whole read-modify-write,
  lands through `files::Temp::replace` (temp file, fsync, rename, directory fsync), and
  writes nothing when nothing changed. A file that doesn't parse is never overwritten.
  fs's `config.toml` writes hold the same lock.
- Checks read the file each time, so `tether device remove` reaches a running daemon
  with no IPC. Don't add a cache.
- Only hashes are stored. A token or code exists in memory for one response or one
  CLI print.
- Never log a token, a code or file contents. `StoreError::Parse` carries only the
  line number, because toml's message quotes the file.
- `Store::enroll` and the other writers block on the flock, and every read blocks on
  the disk: in the daemon they run on the auth lane (`src/blocking.rs`), as
  `Auth::check` does, so a hung mount elsewhere can't take auth's threads.
