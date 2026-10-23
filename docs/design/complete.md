# Completion: the suggestion strip's backend

`src/complete/` answers `POST /complete`: given what is typed at the shell prompt and
the tab's directory, it returns up to 20 chips, each the literal text that finishes the
word or line. Four sources feed it: shell history, commands on `PATH`, carapace for
subcommands, flags and values, and directory listings for paths. Below an effective
memory budget of 53 MiB, completion is not constructed, `welcome.daemon.completion` is
false, and an unexpected `/complete` request returns `200 {"chips":[]}`. Otherwise,
everything is built on first use, revalidated with a cheap `stat` per request, and
dropped after five idle minutes. carapace runs in its own transient systemd scope,
outside tether's memory limit. `/complete` never touches tmux or the hub.

The product side (what the strip shows, how the client reads the command line) is in
[plan.md](plan.md#suggestion-strip); the scheme handler that carries the request is in
[ios-shell.md](ios-shell.md#where-the-web-ui-comes-from); auth is
[auth.md](auth.md#endpoints); path resolution is [fs.md](fs.md#path-resolution-fsopen).
Decisions and the alternatives rejected are in [decisions.md](decisions.md#completion).

## Constants

| Constant | Value | When hit |
|---|---|---|
| completion enabled | effective budget 53 MiB and up; off below | `welcome.daemon.completion: false`; `/complete` returns an empty list without constructing completion |
| request body | 4 KiB | `413 too_large` |
| requests in flight | 4 | `503 busy` at once |
| chips per response | 20; history at most 3 of them | the rest are dropped |
| chip description | 100 bytes | cut |
| completion lanes | index: 1 thread; dir: 1 thread shared with `newWindow` and `newSession` directory checks | each source waits at most 300 ms, then is skipped |
| history file read | its last 1 MiB | older entries are ignored |
| history lines scored | 12,000 distinct lines, newest first | an older entry only adds to a line already scored; it never starts a new one |
| history entries kept | 10,000 distinct lines, highest score | the rest dropped |
| history recency half-life | 200 entries | |
| PATH index | 20,000 names or 256 KiB | the rest of `PATH` isn't indexed |
| carapace run, and `carapace --list` | 300 ms wall time, from spawn to end of output | killed; no carapace chips |
| carapace runs at once | 1; an uncached request for another key kills the run in flight | the older request gets no carapace chips |
| carapace output | 1 MiB; stderr: its last 4 KiB kept | killed; treated as a failure |
| carapace cache | 64 entries or 1 MiB, LRU; 30 s per entry, timeouts and failures included | |
| carapace scope | `MemoryMax=128M`, `TasksMax=64`, `CPUWeight=20`, `IOWeight=10`, `RuntimeMaxSec=2` | the scope is killed, inside itself only |
| path listing | 5,000 names or 1 MiB, as [fs.md](fs.md#constants)'s scan | the rest isn't offered |
| path listing cache | the last directory, while its mtime holds | |
| idle drop | 5 min after the last request | every index and cache is freed |

## Request and response

```text
POST /complete    Content-Type: application/json
Request    = { before: string,          // input start → cursor, as on screen
               after:  string,          // cursor → end of the input
               cwd:    string | null }  // absolute; null: not known yet
Completion = { chips: [Chip] }
Chip       = { insert: string,          // typed at the cursor, verbatim
               label:  string,          // what the chip shows
               source: "history" | "command" | "carapace" | "path",
               description?: string }
```

- **A chip only ever extends what is typed.** Every source matches by prefix, so
  `insert` is the rest of the word or line, plus a trailing space where the word is
  complete. No chip deletes. The client sends `insert` as literal input, like typed
  text.
- **`insert` is an escaped literal, except for history.** A command, path or carapace
  candidate is backslash-escaped by one encoder, `context::literal`
  ([Escaping](#escaping)), so the shell reads the line back as exactly that name and a
  file named `a;b c` completes as one word. A history chip is the line as written: it
  is shell syntax Jimmy typed, so it is inserted as it is and not escaped. Every chip is
  built by `chip()`, which applies this, so no source can skip it.
- **`insert` never contains a control character** (C0, DEL, C1): a candidate that
  would is dropped, so a chip can never press Enter or send an escape sequence. That
  drops multi-line history entries.
- **`label`** is the whole history line, the command name, carapace's `display`, or
  the file name with a `/` for a directory.
- **`before` and `after` are strings, not a line and an index**, so no character unit
  has to be agreed between JavaScript and Rust.
- **`cwd`** must be absolute, at most 4,096 bytes and free of NUL (`400 bad_request`
  otherwise, as [fs.md](fs.md#errors)). Which value the client sends is in
  [What the client does](#what-the-client-does). The 4 KiB body cap is checked first and
  the body also holds `before` and `after`, so a `cwd` near its cap gets `413
  too_large`, not `400`.
- **Errors** use fs's JSON shape: `400 bad_request`, `413 too_large`, `503 busy` with
  `Retry-After: 1`, `500 internal`. A body that isn't the route's JSON is answered with
  axum's own status for the cause and the code `bad_request`, as
  [auth.md](auth.md#endpoints) and fs's routes do: `415` for a missing JSON content
  type, `422` for JSON of the wrong shape, `400` for text that isn't JSON. A source
  that fails, times out or is missing is not an error: its chips are simply absent.
  The route sits in the `devices` router behind both auth layers.

Types go in `src/proto/complete.rs`, generated for TypeScript
([daemon-core.md §5.5](daemon-core.md#55-type-generation)).

## Answering a request

A pure function, `complete::context(before, after) -> Query`, decides which sources
run:

1. **History** runs when `after` is blank and `before` has a non-space character.
2. **Lex** `before` with a small shell lexer:
   - Words split on unquoted whitespace. `|`, `|&`, `||`, `&&`, `;`, `&`, `(` and `$(`
     start a new command; so does the word after `if`, `then`, `elif`, `else`, `do`,
     `while`, `until`, `!`, `time` or `{`. Leading `NAME=value` assignments are skipped.
   - `<`, `>`, `>>`, `&>`, `N>`, `N<`, `N>&M` are redirections, not words or command
     separators (`2>&1` doesn't start a command).
   - The last word is the **current word** (empty when `before` ends in whitespace).
     Its **value** is computed with `\x`, `'…'` and `"…"` removed, so `My\ Dir/s` and
     `'My Dir'/s` both mean `My Dir/s`. A value that starts with `~` only because the
     `~` was escaped or quoted (`\~x`, `'~'/s`) gets `./` before it: it names a file
     called `~x`, and a bare `~x` would be read as a home directory. An unquoted `~` is
     left alone (`~/s` is `$HOME/s`).
3. **Skip word sources** when the cursor sits inside a word (`after` starts with a
   non-space), when a quote is unterminated, or when the current word holds `$`, a
   backtick or a glob character (`*`, `?`, `[`).
4. **Pick the word source:**
   - the word after a redirection → **paths**;
   - the first word of a command → **paths** if it contains `/` or starts with `~` or
     `.`, else **commands on PATH**;
   - a later word, when carapace covers the command → **carapace**, then **paths** if
     no carapace value is left after filtering by the current word;
   - a later word of any other command → **paths**.

Chips are merged in that order (history first), deduplicated by `insert` with a
trailing space ignored (the first kept), and cut at the chip cap. A later chip is
dropped whole, not merged into the first: when a history line and a carapace value
have the same `insert`, the strip shows the history chip, which has no description and
no trailing space (`cargo build --rel` shows only the history line).

## History

**Which file.** One file: `[complete] history` in `config.toml`, else whichever of
`~/.zsh_history`, `~/.bash_history` and `${XDG_DATA_HOME:-~/.local/share}/fish/fish_history`
was modified most recently, chosen again on each request from three `stat`s. The
daemon can't see the shell's `$HISTFILE`, so a non-default path needs the config key.
The format follows the file name: `fish_history` is fish, a name containing `zsh` or
`.histfile` is zsh, anything else is bash.

**Parsing**, pure, from the last 1 MiB of the file (when that starts mid-file, its
first, partial line is skipped):

| Format | Entry | Handled |
|---|---|---|
| bash | one line | `#<digits>` timestamp lines skipped |
| zsh | `: <start>:<elapsed>;<cmd>` (extended) or a plain line | a line ending in `\` continues the entry; bytes unmetafied (`0x83` then `b ^ 0x20`) |
| fish | `- cmd: <text>` | `\\` and `\n` unescaped; `when:` and `paths:` lines skipped |

Entries that aren't UTF-8 or contain a control character are dropped. Each distinct
line gets a score, the sum over its occurrences of `0.5^(age / 200)`, where age counts
entries after it: recent and frequent lines rank first, with no timestamps needed
(bash writes none by default). Deduplication uses a map keyed by slices of the read
buffer.

**The map holds at most 12,000 distinct lines.** Entries are read newest first; once
12,000 distinct lines are scored, an older entry still adds to a line already in the
map but never starts a new one. Without the cap the map and the per-line structures built from it had one entry per
distinct line of the 1 MiB read, up to about 150,000 of short lines: a file of 149,796
distinct lines raised the scope's peak memory by 17.6–18.8 MB for one request, against
1.5–2.0 MB with the cap. With it the map is about 0.4 MB whatever the file holds. The cap
changes nothing kept, because a line left out can't outscore the first 10,000 scored:
at its newest it is at least 2,000 entries older than each of them, a line's weights
sum to at most 289 times its newest weight (the geometric series of the 200-entry
half-life), and 289 × 2^(-2000/200) is below 1.

The 10,000 best lines are copied into one contiguous string with an offset table. The
word index has one entry per distinct first word of those lines: the index of a line
that starts with it, and the summed score of the kept lines that do. It holds no copied
text, and it ranks command chips: a line outside the kept 10,000 adds nothing to its
command's score.

**Freshness.** Each request `stat`s the file; when `(dev, ino, size, mtime)` differs
from the index's, the file is re-parsed on the index lane and the new index swapped
in whole. A shell that writes history only on exit leaves its own commands out until
then; [the snippet](#the-shell-snippet) appends after each command.

**Matching.** Lines that start with `before` (leading whitespace ignored on both) and
are longer, best score first; `insert` is the rest of the line.

**History is never logged**: not lines, not counts per line, not the request's
`before` or `after`. Only the file's path and a parse failure's byte offset are.

## Commands on PATH

The index holds every name in the `PATH` directories that is a regular file, or a link
to one, with an execute bit, deduplicated. `PATH` is `[complete] path` in
`config.toml`, else the daemon's own environment, the systemd user manager's. That one
lacks whatever Jimmy's rc files add (nvm, bun, Go), so installing sets the key
([Installing](#installing)). The index is built on the first request that needs it,
on the index lane. Each later request that needs it `stat`s every `PATH` directory
and rebuilds the whole index when any mtime differs from the build's; there is no
watcher. The dev box's user-manager `PATH` holds 2,272 names.

Matches rank by the history score of the command (the summed score of the kept history
lines that start with it), then by length, then by name; `insert` is the rest of the
name, [escaped](#escaping), plus a space. A name with a `;`, a space or a `$` in it is
escaped like a file name, so the shell reads it as one word.

## carapace

carapace-bin 1.8.0, pinned ([libraries.md](research/libraries.md)). The binary is
`[complete] carapace` in `config.toml`, else `carapace` on the `PATH` above; resolved
on first use, and a missing binary is remembered until the idle drop. carapace runs
with that `PATH`, so the helpers it starts resolve the same way.

**Invocation.** For the command `cmd arg1 … argN cur`:

```text
carapace <cmd> export "" <arg1> … <argN> <stem>        cwd = the request's cwd
```

The **stem** is `cur` through its last `/`, `=`, `:`, `,`, `@` or `+`; else `-` when
`cur` starts with `-`; else empty. carapace returns every candidate for that stem, and
`complete` filters by `cur` itself, so one run serves every keystroke until the stem
changes. Measured: `checkout ""` gives refs only and `checkout -` the 40 flags;
`checkout origin/` gives `origin/main`; `ls src/` lists `src/`; `chmod u+` gives
`u+r`, `u+x` and the rest. The cache key is `(cwd, cmd, arg1…argN, stem)`. Before a
run (not on a cache hit), the request's `cwd` must pass `fs::check_dir`
([fs.md](fs.md#path-resolution-fsopen)) on the dir lane; otherwise carapace is skipped.

**Known commands only.** On first use, `carapace --list`, run like any other run,
gives the commands carapace covers (984 in 1.8.0). Only those are run. A list run that
fails, or output that doesn't parse, is cached as a failure for 30 s and retried; until
it succeeds, no command goes to carapace.

**The JSON** is parsed loosely into typed structs: `values[]` with `value`, `display`
and optional `description`, plus the top-level `nospace`; unknown fields ignored,
missing optional fields tolerated. Output that doesn't parse is a failure. Values that
don't start with `cur` are dropped; the rest keep carapace's order. `insert` is the
rest of the value, [escaped](#escaping), plus a space unless `nospace` is
`*` or holds the value's last character (carapace sends `/` for paths). Golden fixtures
from the pinned binary (git, cargo, docker, chmod) test the parser.

**The runner** is one task that owns the child process; requests send it a key and
await a shared result.

- One run at a time. A request whose key matches the run in flight waits for it; a
  request for another key kills it, so the latest keystroke wins and a stale run never
  delays a fresh one. A request whose answer is already cached never reaches the
  runner (the cache is read first), so it kills nothing: typing back to a stem seen in
  the last 30 s leaves the run for another key going.
- Only three things kill a run: an uncached request for another key, the timeout, and
  the output cap. A request that goes away (the phone aborted it) kills nothing, and a run that
  finishes is cached even when no request still waits.
- Each run is spawned in its own process group, and a kill is `SIGKILL` to the group,
  which also reaches the helpers carapace starts (`git`, `docker`).
- Results, empty ones from failures and timeouts included, are cached for 30 s; a run
  killed for a newer key is not cached. So `git checkout` sees new branches within
  30 s, and a command that always times out costs one run per 30 s, not one per
  keystroke.

### Where carapace runs: its own scope

Under systemd (the unit sets `INVOCATION_ID`), each run is wrapped:

```text
systemd-run --user --scope --quiet --collect --description="tether completion" \
  -p MemoryMax=128M -p TasksMax=64 -p CPUWeight=20 -p IOWeight=10 \
  -p RuntimeMaxSec=2 -- <carapace argv>
```

`systemd-run` asks the user manager for a transient scope, moves itself into it and
execs carapace, keeping its PID and process group, so carapace and its helpers are
charged to that scope, not to tether's unit. Nice level, I/O class and
`OOMScoreAdjust` are inherited from tether's process.

- **`--description`** replaces the default, which is the command line: without it,
  the user journal records every run's arguments, the words Jimmy typed.
- **`RuntimeMaxSec`** ends a scope that outlives its run. A kill that lands before
  `systemd-run` has exec'd (5–20 ms after spawn) leaves an empty scope that would
  otherwise stay active forever, and helpers that outlive a crashed tether are bounded
  by it too.
- Started outside systemd (a dev run), carapace is spawned directly. A `systemd-run`
  that fails (no user bus) counts as a carapace failure.

Measured on the dev box (carapace 1.8.0, 24 cores, 64 GB), each run in a fresh scope;
"peak" is that scope's `memory.peak`, which counts page cache; "cold" means the 95 MB
binary was evicted from the page cache first:

| Completion | Values | Max RSS | Peak, warm | Peak, cold | Time, warm |
|---|---|---|---|---|---|
| `tmux ''`, `ls --`, `npm ''` | 44–124 | 17–19 MB | 9–10 MB | 10–11 MB | 7–9 ms |
| `cargo build --`, `kubectl ''` | 38–46 | 18–21 MB | 10–14 MB | 29–31 MB | 11–21 ms |
| `git ''`, `git checkout ''`, `git log --` | 7–230 | 31–34 MB | 15–21 MB | 42–46 MB | 23–44 ms |
| `docker ''`, `docker run --` | 59–103 | 43–44 MB | 38–49 MB | 41–74 MB | 44–92 ms |
| `systemctl status ''` | 473 | 26 MB | 12 MB | 22 MB | 560 ms |

Run inside tether's unit, one `docker` completion would add 43 MB of RSS, and up to
74 MB on a cold cache, to a unit whose ceiling already reaches its 64 MB `MemoryMax`
([daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling)).
Scoped, the cost to tether's unit is `systemd-run` before its exec: the unit's peak
rose 1.1 MB for a `docker run --` completion. The scope adds about 27 ms (34 ms scoped
against 7 ms direct for `tmux ''`), which the 300 ms timeout covers.
`systemctl status ''` times out (it lists every unit) and offers no values; that is
accepted.

## Paths

The current word's value splits at its last `/` into a directory and a name prefix. A
leading `~` or `~/` expands to `$HOME` (`~user` is not completed; a bare `~` gets the
chip `/`); a relative directory joins `cwd`, and needs a non-null `cwd`. The directory
is opened with `fs::open` and a `Scope` of `/`, wanting a directory
([fs.md](fs.md#path-resolution-fsopen)): the same canonicalization, `O_NOFOLLOW` open
and descriptor re-check as the file API, with `/` as the scope. Path completion returns names, never contents, from any
directory Jimmy can read, as the shell's own Tab does; the roots stay the scope of
everything that reads files.

The listing reads names and `d_type` through the descriptor up to the listing cap,
`fstatat`-ing only links and unknown types, on the dir lane. It is cached for
the last directory and reused while a fresh open's `fstat` shows the same mtime. `.`
and `..` are never offered; other names starting with `.` only when the typed prefix
starts with `.`; names that aren't UTF-8 are skipped. Matches sort by name with ASCII
case folded. `insert` is the rest of the name, [escaped](#escaping), then `/` for a
directory or a space for anything else. The lexer reads the escapes back, so the next
request after a chip continues from the same directory.

### Escaping

One encoder, `context::literal`, writes every command, path and carapace `insert`. It
backslash-escapes every ASCII character outside `[A-Za-z0-9._+,:@%/-]` and leaves
non-ASCII characters as they are; bash and zsh read the result back as exactly the
name, at any position in a word. That covers blanks, `;`, `&`, `|`, quotes, `$`,
backticks, globs, `!`, braces, `#` and the rest. Control characters never reach it:
`chip()` drops the candidate first, since a backslash before a newline would join lines.

**`~` and `=` are escaped everywhere in the name, not only at its start.** Both shells
give them meaning in places other than a word's first character: bash expands `~` after
`=` or `:` in an argument too (`echo a=~root` prints `a=/root` on bash 5.2); zsh expands
a leading `=cmd` and, with `MAGIC_EQUAL_SUBST`, a `~` or `=` after `=` or `:`; and
bash's own Tab escapes both. A file named `~root` completed bare would run as `/root`,
and `=ls` as the path of `ls` (an error in zsh when there is no such command), so the
line that runs would not be the file the chip named. The cost is that names like `foo~`
show as `foo\~` on the line.

**The lexer reads it back**, so the next request after a chip continues from the same
file: `\~x` and `'~'/s` come back as `./~x` and `./~/s` (the [`./` rule](#answering-a-request)).
Without it a line holding `\~x` would be read as the home directory `~x`, and the next
request would list `$HOME`.

## Memory, CPU and threads

Everything `complete` holds is built on demand and freed together by the idle drop:
one timer, re-armed by each request, that fires once five minutes after the last. With
no phone typing, completion holds nothing and wakes nothing.

| Item | Bound | MB |
|---|---|---|
| history: the 1 MiB read, its dedup map (12,000 lines at most), the new index and the old one during a rebuild | 1 + ~0.4 + 1.1 + 1.1 | 4 |
| PATH index, old and new during a rebuild | 2 × 256 KiB | 0.5 |
| carapace: cache, one run's output and its parse, the command list | 1 + 1 + ~1 + 0.3 MiB | 3.3 |
| `systemd-run` before its exec | measured | 1.1 |
| path listing and its cache | 2 × (1 MiB of names + 5,000 × 32 B) | 2.4 |
| kernel dentry and inode slab from the `PATH` scan and directory listings, charged to the unit | measured | 2.4 |
| **completion** | | **~14** |

The history row's worst case, measured: 10,400 lines of 101 bytes, the largest index a
1 MiB read keeps, takes 2.9 MB on the first parse and 3.9 MB on a rebuild with the old
index still held, inside the 4 MB allowance.

That row replaces the unmeasured carapace estimate (~15 MB) in
[daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling).

The slab row is kernel memory the daemon doesn't hold: walking `PATH`'s directories and
listing others leaves their dentries and inodes cached, and the cache is charged to the
unit's cgroup. It is reclaimable, so the kernel gives it back under pressure before
`MemoryMax` bites, but the idle drop does not free it, and it counts toward
`MemoryHigh`, where the unit's tasks are throttled. It is in the ceiling so the table
doesn't promise a margin the unit doesn't have.

**Freed memory must reach the kernel**, or the idle drop doesn't restore the ~5 MB
idle budget. glibc mmaps the first large allocation, but after it is freed raises its
dynamic mmap threshold, so later indexes come from the heap and stay resident. The
unit pins the threshold with
`Environment=GLIBC_TUNABLES=glibc.malloc.mmap_threshold=131072`, which turns the
dynamic threshold off with no `unsafe` call; then every index, list and listing buffer
over 128 KiB is its own mapping, returned on free. Measured on the dev box with the
unit's limits, after an idle drop: anon RSS 1.51 MB with the tunable (0.33 MB above
its baseline), 1.80 MB without it (1.39 MB above), about 1 MB less resident.

**The tunable reaches only the glibc build.** Only glibc's allocator reads
`GLIBC_TUNABLES`. The unit's `ExecStart` is `~/.cargo/bin/tether`, the binary
`cargo install` builds on the server, which links glibc. The Linux release binaries are
static musl builds (`.github/workflows/release.yml`) and ignore the variable. Run under
the unit, a release binary gets none of the effect measured above; how musl's allocator
returns freed memory is unmeasured. The budget run must read the RSS after an idle
drop for whichever binary the unit runs.

**Blocking lanes.** Completion uses the one-thread index lane for history parsing and
the PATH scan, and the one-thread dir lane for `check_dir` and path listings. The dir
lane is shared with `newWindow` and `newSession` checks. Each lane has a 300 ms wait; a
source that cannot get a thread in time is skipped. A call stuck on a hung mount holds
its lane rather than permitting more work to accumulate. File API work uses its own
four-thread fs lane; auth has two threads. The eight threads sum to
`BLOCKING_THREADS` in `src/blocking.rs`. carapace is awaited asynchronously and takes
no blocking thread. All blocking work uses these lanes; Tokio filesystem APIs are
disabled. In tether's `TasksMax`, a run counts only `systemd-run` until it
moves into its scope.

**CPU.** Every lookup is a scan of an in-memory index (10,000 lines at most); the
work that costs anything (re-parsing, rebuilding, a carapace run) happens once per
change, per new stem, or per 30 s. carapace's scope has tether's `CPUWeight` and
inherits its nice level 10.

## What the client does

- **Asks only when it can read the line:** an input-start mark (OSC 133 B) or the
  prompt-regex fallback ([plan.md](plan.md#suggestion-strip)), not on the alternate
  screen, and only when the text changed.
- **Computes `before` and `after`** from its own buffer: `before` from the input start
  to the cursor, `after` from the cursor to the end of the input's last row, wrapped
  rows joined and trailing spaces dropped.
- **Debounces** 100 ms after the last change, and **cancels** the request a newer one
  supersedes with an `AbortController`; the scheme handler cancels the upstream
  request on `webView(_:stop:)` ([ios-shell.md](ios-shell.md#where-the-web-ui-comes-from)).
  A response for a `before` other than the current one is dropped.
- **Sends `cwd`** as the path of the OSC 7 that followed the current prompt's OSC 133
  A mark, else the tab's cwd from `watching`
  ([daemon-core.md §3.7](daemon-core.md#37-cwd-subscription)), which lags a `cd` by
  up to a second. The host part of the OSC 7 URL is ignored.
- **On a tap,** sends `insert` as typed text; the changed line triggers the next
  request.
- **On `503 busy` or a network error,** shows no chips and waits for the next change.

## The shell snippet

[`contrib/shell/tether.bash`](../../contrib/shell/tether.bash) (bash 4.4+) and
[`contrib/shell/tether.zsh`](../../contrib/shell/tether.zsh) (zsh 5.1+) emit these
marks, raw: tmux passes them through control mode with `allow-passthrough` off
([probe-tmux.md §1](research/probe-tmux.md)).

| Mark | Meaning | bash | zsh |
|---|---|---|---|
| `OSC 133;D;<status>` | the last command ended | first `PROMPT_COMMAND` hook | first `precmd` hook |
| `OSC 133;A` | prompt starts | same hook, after D | same hook, after D |
| `OSC 7;file://<host><path>` | the shell's directory, percent-encoded | same hook | same hook |
| `OSC 133;B` | prompt ends; typed input starts | appended to `PS1` by the last `PROMPT_COMMAND` hook | appended to `PS1` by the last `precmd` hook |
| `OSC 133;C` | the line was accepted; output starts | `PS0` | `preexec` hook |

Every OSC ends with BEL. B is re-appended at each prompt when missing, because prompt
themes rebuild `PS1` in their own hooks. The hooks return the status they found, so
later hooks still see `$?`. bash's hooks wrap an existing `PROMPT_COMMAND` as an
array on bash 5.1+ and newline-joined before that, so an existing command ending in
`&` or a comment can't swallow the last hook. An empty Enter gets D and A but no C.
Both files return at once in a non-interactive shell or when already sourced.

Both also make history current for the strip: bash runs `history -a` before each
prompt; zsh sets `INC_APPEND_HISTORY`. `TETHER_NO_HISTORY_APPEND=1`, set before
sourcing, turns that off.

### Installing

1. **The snippet.** Add one line at the **end** of `~/.bashrc` (or `~/.zshrc`, with
   `tether.zsh`), after anything that sets the prompt, and open a new shell. Dotfiles
   that must not depend on the checkout copy the file instead.

   ```bash
   [ -r ~/gitrepos/tether/contrib/shell/tether.bash ] && . ~/gitrepos/tether/contrib/shell/tether.bash
   ```

   zsh saves history only with `HISTFILE` and `SAVEHIST` set; with no `HISTFILE` the
   strip has no history.
2. **`PATH`.** From an interactive shell, write its `PATH` into `config.toml`, then
   restart tether: `path = "<the output of echo $PATH>"` under `[complete]`.
3. **carapace**, as Jimmy, never system-wide: the
   [v1.8.0 release](https://github.com/carapace-sh/carapace-bin/releases/tag/v1.8.0)'s
   `carapace-bin_1.8.0_linux_amd64.tar.gz`, checked against its `checksums.txt`, with
   `carapace` extracted to `~/.local/bin/`. Upgrading is a deliberate re-pin: rerun
   the parser's golden fixtures against the new binary first.

## Logging

- **Never:** history lines, the request's `before`, `after` or `cwd`, chip text,
  carapace's arguments or output, or a parser's own error message: serde's `Display`
  quotes the input it choked on, which holds the words Jimmy typed.
- **`info`, once per process:** carapace missing.
- **`warn`:** the history file unreadable or failing to parse, by path and byte
  offset; once per process, `systemd-run` failing or the carapace list failing, with
  the kept stderr tail.
- **`debug`:** per request, which sources ran, their counts and times; carapace
  failures by kind (timeout, killed for a newer key, exit status, bad JSON).
- **Bad JSON is logged by kind and position only**, in the debug line and in the
  `--list` warning alike: one of four fixed phrases (bad syntax, an unexpected shape,
  cut short, a read error) and the line and column, as in "its JSON doesn't parse: an
  unexpected shape at line 1, column 57". serde's own message is never logged. No other
  log line in `src/complete/` or `src/fs/` carries a parser's message; config parse
  errors log a line number only ([fs.md](fs.md#logging)).

## Module shape

`src/complete/` knows nothing of axum; `src/http/complete.rs` parses the body, takes
an in-flight permit and calls `Completer::complete(Request) -> Completion`. The pure
parts are tested without a disk or a process.

| File | Contents |
|---|---|
| `complete/mod.rs` | `Completer`: the indexes as `Arc` snapshots swapped whole, index and dir lanes, the idle drop, merge and the caps; `Settings::new(config, Environment)` resolves config and daemon environment (`home`, `PATH`, `XDG_DATA_HOME`, and systemd status) |
| `complete/context.rs` | the lexer, `context(before, after) -> Query`, and `literal`, the escaping the lexer reads back (pure) |
| `complete/history.rs` | the three parsers, scoring and the contiguous index (pure); the stat-and-reload (`files::Stamp`) |
| `complete/commands.rs` | the PATH scan and its mtime check (`files::Stamp`) |
| `complete/carapace.rs` | stems, argv and JSON → values (pure), plus shared cache state |
| `complete/runner.rs` | child process task, scope wrapper and run serialization |
| `complete/paths.rs` | splitting (pure); the listing through `fs::open` |
| `complete/packed.rs` | strings stored end to end in one buffer, which every index uses, so an index is two allocations and goes back to the kernel when freed |

No new crates: `serde_json` is already in, and the LRU is a small local type. Tests:
the lexer and context rules on a table of lines (redirections, `2>&1`, escaped and
quoted words); each history format on fixture files, with metafied zsh bytes,
continuation lines and a truncated first line; the carapace parser on golden output;
the runner's timeout, newer-key kill, abandoned-request caching and process-group kill
against a script that sleeps and forks; and `bash -c` reading hostile names (`;`, `$`,
`~`, `=`, quotes, blanks) back from command, path and carapace chips as exactly the
name, which fails if `~` or `=` rejoin the unescaped set.

## Open risks

- **Marks after a snapshot.** A snapshot repaints the screen without the OSC 133
  marks, so after a tab switch or reconnect the client has no B mark until the next
  prompt and falls back to the prompt regex. The client can keep the last B column
  for a pane whose screen shows no newer A or C; spike 7 checks whether that is
  enough.
- **Text after the cursor that isn't input:** zsh's `RPROMPT` and
  zsh-autosuggestions' ghost text make `after` non-blank, which turns history off.
  Jimmy uses neither today.
- **carapace runs project code with no Tab pressed.** Typing `make ` runs `make -qp`,
  which evaluates the Makefile; git honours `core.fsmonitor`; `kubectl` and `gh`
  reach the network. It is the exposure of pressing Tab in that directory, reached
  sooner.
- **Insert safety assumes emacs or insert mode.** In vi command mode, printable bytes
  are commands. Jimmy uses emacs mode.
- **The escaping is run-tested against bash only.** The read-back test needs `bash`;
  zsh's side rests on its documented rules ([Escaping](#escaping)), since the dev box
  has no zsh to run them. Check a hostile file name in Jimmy's zsh.
- **carapace's JSON** has no stability promise; the pin and the golden fixtures are
  the guard. A changed shape degrades to no carapace chips.
- **The 128 MB scope limit** holds every measured completion (49 MB warm, 74 MB cold
  peak), but helpers carapace runs for other commands are unmeasured; a scope that
  hits its limit is killed by the kernel inside that scope only.
- **The snippet with other shell integrations** (VS Code's, a prompt theme's own OSC
  133) can emit duplicate marks; the client takes the latest B before the cursor.
  Async zsh themes (powerlevel10k, pure) that redraw the prompt are untested.
- **Inside `ssh`**, path chips list the dev box's directories: tmux's cwd is the
  local `ssh` process's, and a remote shell's OSC 7 names a remote path.
- **zsh was tested with zsh 5.8 from a scratch build**, since the dev box has none;
  the zsh file needs a check in Jimmy's real zsh setup.
