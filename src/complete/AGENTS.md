# complete

`POST /complete`'s core ([complete.md](../../docs/design/complete.md)): what the
suggestion strip offers for the text before the cursor. It knows nothing of axum and
never touches tmux or the hub; `http/complete.rs` parses the body, checks `cwd`'s shape,
takes one of 4 in-flight permits and calls `Completer::complete`, which never fails.

- `context.rs`: the shell lexer and `context(before, after) -> Query` (pure).
- `history.rs`: the bash, zsh and fish parsers, scoring, and the stat-and-reload.
- `commands.rs`: the `PATH` index and its mtime check.
- `carapace.rs`: stems, the JSON, the LRU, and the runner task that owns the child.
- `paths.rs`: splitting, escaping, and the cached listing through `fs::open`.
- `packed.rs`: strings end to end in one buffer, which every index uses (not in the
  spec's module table).
- `mod.rs`: `Completer`, its two slots, the idle drop, merge and the caps.

Rules the code relies on, which are easy to break:

- **Never log typed text:** not `before`, `after` or `cwd`, not history lines or
  counts per line, not chips, not carapace's arguments or output. The debug line per
  request carries the word source's kind and counts only. carapace's stderr tail is
  logged only for `--list`, which carries no typed words.
- **A chip only extends what is typed:** every source matches by prefix and `chip()`
  drops an insert that is empty or holds a control character. Path and carapace
  inserts go through `paths::escape`, which the lexer reads back.
- **Blocking work runs through `blocking()`** under one of the two slots, with the
  permit moved into the closure: the index slot for history, the `PATH` scan and
  resolving the carapace binary; the directory slot for `check_dir` and listings. Never
  `spawn_blocking` directly, and never hold `state`'s lock across I/O: clone the `Arc`,
  release, work, then swap the new one in.
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
listing outside the roots (`paths.rs`); the parser on golden carapace 1.8.0 output in
`tests/fixtures/carapace/` and the runner's timeout, newer-key kill, abandoned request
and group kill against a fake script (`carapace.rs`); insert-only-extends across every
source and the missing binary (`mod.rs`); `tests/http_auth.rs` for the auth layers.
