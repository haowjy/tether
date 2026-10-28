# complete

`POST /complete`'s core ([complete.md](../../docs/design/complete.md)): what the
suggestion strip offers for the text before the cursor. It knows nothing of axum and
never touches tmux or the hub. When the startup budget tier enables completion,
`http/server.rs` constructs its `Completer` and `http/complete.rs` parses the body,
checks `cwd`'s shape, takes one of 4 in-flight permits and calls it. When disabled,
the completer is not constructed and the route returns an empty completion.

- `context.rs`: the shell lexer, `context(before, after) -> Query`, and `literal`, the
  escaping the lexer reads back (pure).
- `history.rs`: the bash, zsh and fish parsers, scoring, and the stat-and-reload.
- `commands.rs`: the `PATH` index and its mtime check.
- `carapace.rs`: stems, the JSON and the LRU (pure).
- `runner.rs`: the runner task that owns the child, filling `carapace.rs`'s cache.
- `paths.rs`: splitting and the cached listing through `fs::open`.
- `packed.rs`: strings end to end in one buffer, which every index uses (not in the
  spec's module table).
- `mod.rs`: `Settings` (built from `[complete]` and an `Environment`, the daemon's
  own or a test's), `Completer`, its two lanes, the idle drop, merge and the caps.

Rules the code relies on, which are easy to break:

- **Never log typed text:** not `before`, `after` or `cwd`, not history lines or
  counts per line, not chips, not carapace's arguments or output. The debug line per
  request carries the word source's kind and counts only. carapace's stderr tail is
  logged only for `--list`, which carries no typed words. A parser's error message
  quotes its input, so a failure logs a fixed kind and a position (`Failure::Json`),
  never serde's `Display`.
- **A chip only extends what is typed, and the shell reads it literally:** every
  source matches by prefix, and every chip is built by `chip()`, which drops a control
  character and escapes every source's text through `context::literal` except
  history's, which is shell syntax Jimmy wrote. Never build a `Chip` elsewhere. The
  lexer reads the escapes back; a quoted leading `~` comes back as `./~`, so paths
  and carapace don't take it for `$HOME`.
- **History's memory is bounded by distinct lines, not bytes:** `SCORED` caps the
  dedup map (its comment proves the cap can't change the 10,000 kept), and the word
  index holds the kept lines' first words as indexes into `lines`. A per-entry or
  per-distinct-line structure over the whole 1 MiB read breaks the allowance: 1 MiB of
  short distinct lines is 150,000 of them.
- **Blocking work runs on one of two lanes** (`src/blocking.rs`), the permit moved into
  the closure: the index lane for history, the `PATH` scan and resolving the carapace
  binary; the dir lane for `check_dir` and listings (`newWindow`'s `dir` check shares
  it). Never hold `state`'s lock across I/O: clone the `Arc`, release, work, then swap
  the new one in.
- **One carapace run at a time, owned by the runner task.** Requests only `ask`; a
  dropped request kills nothing, a newer key kills the run in flight (`Group`'s drop
  sends `SIGKILL` to the process group), and every finished run is cached. Under
  systemd (`INVOCATION_ID`), every run goes through `systemd-run --scope` with the
  `SCOPE` arguments; `--description` keeps the typed words out of the user journal.
- **The idle drop frees everything** in `State` and `carapace::Shared` together, five
  minutes after the last request. New state goes in one of those two, or it outlives
  the drop. The once-per-process log flags are the exception, by design.
- **Large allocations are single buffers** (`Packed`, the read buffer, the run's
  output) so they are mmapped and go back to the kernel when freed; the unit pins
  glibc's mmap threshold for that (`contrib/tether.service`).

Tests: the lexer table (`context.rs`); each history format, ranking and the tail read
(`history.rs`); the `PATH` index's refresh (`commands.rs`); splitting, escaping and
listing any directory (`paths.rs`); the parser on golden carapace 1.8.0 output in
`tests/fixtures/carapace/` (`carapace.rs`); the runner's timeout, newer-key kill,
abandoned request and group kill against a fake script (`runner.rs`);
insert-only-extends across every source, the missing binary, and bash reading hostile
names back from command, path and carapace chips (`mod.rs`, needs `bash`; built with
`Settings::new` and a test `Environment`, never the developer's); `tests/http_auth.rs`
for the auth layers.
