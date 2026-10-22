# fs

The file API's core ([fs.md](../../docs/design/fs.md)): roots, `open`, listings, raw
reads, uploads and `config.toml` writes. Plain functions over files re-read per
request; no cache, no cursor, no descriptor kept between requests. It knows nothing of
axum: `http/fs.rs` parses requests, takes slots and builds responses. `mod.rs` holds
`Roots` and `FsError`; `slots.rs` the limits; the rest one route family each.

Rules the code relies on, which are easy to break:

- A client's path reaches the disk only through `open`, which returns a descriptor
  checked against the scope after opening (`/proc/self/fd` on Linux, `F_GETPATH` on
  macOS). Read and write through that descriptor (`pread`, `statat`, `openat`,
  `renameat`), never by joining a path and opening it again. Path completion
  (`src/complete/`) opens through it too, with `Scope::everything()`, and reads names
  with `list::Scan`; `check_shape` is also `/complete`'s `cwd` check.
- Every blocking call goes through `Slots::blocking`, which moves the fs slot into the
  blocking closure; never `spawn_blocking` file work directly, and never
  `tokio::fs::File` (its buffer grows to 2 MiB). Take an fs slot last and release it
  before waiting for any other slot.
- `Roots::load` reads `config.toml` each time; a file that exists and doesn't parse
  fails every route with `config_unavailable` and is never written.
  `config_write::apply` holds auth's state lock (`Store::lock`) for the whole
  read-modify-write and changes only `roots` or `uploads_dir`. It writes a symlinked
  file at its target and refuses (`config_read_only`) a link to nothing, the file's or
  a directory's on the way: `canonicalize` failing doesn't mean the file is absent.
- `DONTNEED` must cover whole folios: the raw producer drops from the response's first
  byte to the current position, and the upload drops the whole file after each
  `fdatasync`. A chunk-sized drop drops nothing (readahead builds large folios).
- Every wait has a deadline (slot waits, the raw stall, the upload's idle body) except
  the upload's `fdatasync`. A part file is deleted on every failure, including a
  request dropped mid-body (`Part`'s `Drop`).
- Logs carry paths, sizes and codes, never file contents, upload bytes, the client's
  upload name, or `config.toml`'s text: a parse error is logged by line number, never
  by the parser's message, which quotes the text.

Tests: `open.rs` (escapes, links, FIFOs, the swapped component), `list.rs`, `raw.rs`
(Range, ETag), `mime.rs` (the allowlist), `upload.rs`, `config_write.rs` (comments and
unknown keys kept); `tests/http_fs.rs` and `tests/http_auth.rs` over a real socket.
