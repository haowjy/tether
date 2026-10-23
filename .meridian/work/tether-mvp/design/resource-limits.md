# Resource limits: a memory budget and a CPU cap (draft for review)

## 1. Summary

One integer in `config.toml`, `memory_budget_mib` (default 72), sets the most memory
tether's unit may use. At startup the daemon takes the lower of it and the unit's
`MemoryMax`, then picks the row of a five-row tier table that fits. That row fixes how
many tmux sessions, WebSockets, small slots, and whether completion runs. A tighter
budget means fewer things open at once, refused with a `limit` message, never an OOM
kill: each tier's ceiling at every cap, plus 4 MiB of headroom, fits the lowest budget
in its range. Below 40 MiB the daemon refuses to start, because one tmux session, two
sockets and the fixed protocol bounds don't fit in less.

The default budget of 72 keeps **3 tmux sessions** (answering browser-auth D6), 3
sockets and every other cap at today's value. Its ceiling is about 63.8 MB the kernel
can't reclaim, against 72. The default raises the unit's `MemoryMax` from today's 64M
to 72M, and its `MemoryHigh` from 48M to 54M. That costs the box only tether's own
8 MiB: tmux, its sessions and their processes run outside the unit, so the cap never
bounds them. A budget of 64 drops to 2 sessions. A budget of 32 is refused; 40, the
floor, yields 1 session, 2 sockets, no completion, and a ceiling of about 35 MB.

The unit gains `CPUQuota=50%` with `CPUQuotaPeriodSec=20ms`: half a core, throttled in
slices short enough that a throttled keystroke waits at most 10 ms. tether's heaviest
sustained work, an output flood, measured 2% of a core
([decisions.md "Batched pipe reads"](../../../../docs/design/decisions.md#batched-pipe-reads-for-control-clients)).

**The budget has a prerequisite.** Today nothing bounds HTTP connections that aren't
upgraded (`axum::serve`, hyper's default buffers), so no budget can promise "never an
OOM kill". The accept loop that browser-auth §5 specifies (64 connection permits,
16 KiB hyper buffers) ships with this change, ahead of the rest of browser auth (D6
below).

### Vocabulary

| Term | Meaning |
|---|---|
| **memory budget** | `memory_budget_mib`: the most memory, in MiB, tether's unit may hold that the kernel can't reclaim. The unit's `MemoryMax` should equal it |
| **effective budget** | the lower of the memory budget and the unit's cgroup limit, read once at startup; what the tiers are chosen from |
| **tier** | one row of the tier table: the caps for a range of effective budgets |
| **ceiling** | the sum of every memory row with every cap reached at once ([daemon-core §6](#31-daemon-coremd-6-replacement)). "Unreclaimable ceiling" leaves out the clean file pages and reclaimable slab the kernel drops before it kills |
| **headroom** | 4 MiB kept between a tier's unreclaimable ceiling and the lowest budget in its range, for estimate error in rows that are targets, not measurements |
| **`busy`** | a refusal that clears within a second or so; the client retries soon |
| **`limit`** (new) | a refusal at a budget-derived cap; it clears only when something else closes or the budget is raised |

`tooManySessions` keeps its one meaning, the scratch-session cap. Today the
control-client cap's message also says "too many tmux sessions"; it becomes `limit`.
plan.md's "Resource budget" section keeps its name, since it covers CPU and idle
targets too. "Budget measurement" there is the measurement run, and it now checks the
memory budget.

## 2. Decisions for Jimmy

| # | Decision | Recommended | Alternatives |
|---|---|---|---|
| D1 | The setting | **`memory_budget_mib`, an integer in MiB, top-level in `config.toml`, default 72, at least 40.** Values above 72 behave as 72, since caps never exceed today's. MiB matches systemd's `M`, so `memory_budget_mib = 48` pairs with `MemoryMax=48M` | A suffixed string (`"48M"`): more parsing for no gain. A `[limits]` table: one key doesn't need one. Letting budgets above 72 raise caps past today's: untested configurations for a case nobody has asked for. A default of 64, 2 tmux sessions at once, keeping today's `MemoryMax=64M`: one fewer session for the user, to save 8 MiB that only tether can use, since tmux and its processes run outside the unit |
| D2 | How the budget and the unit agree | **Both: the daemon reads its cgroup limit at startup and uses the lower value, and running.md says to set `MemoryMax` to the budget and `MemoryHigh` to three quarters of it.** Lowering `MemoryMax` alone then tightens tether safely. Raising it needs both. Below 40 MiB effective, the daemon exits 78 with a message naming both numbers, and the unit's `RestartPreventExitStatus=78` stops a restart loop | Documentation only: one missed edit and the caps outgrow `MemoryMax`, which is the OOM kill this exists to prevent. Check only: correct, but the person tuning wouldn't know what to set. No config key, budget = the unit's `MemoryMax`: contradicts the config setting Jimmy chose, and a dev run outside systemd would have no budget. Starting at the floor tier when the unit is below 40: the ceiling then exceeds `MemoryMax` at caps, an OOM kill |
| D3 | What goes first as the budget tightens | **The third tmux session goes below 72, the second (with the small slots halved) below 64, the third socket below 56, and completion below 52.** A lost socket heals by itself: a stale one ages out within 25 s and the client's retry gets in. Lost completion stays lost until the budget rises | Completion before the third socket (tiers at 48 and 40): keeps a browser tab and the phone connected together at 48–55 MiB, but no suggestion strip there. Halving completion's history and caches instead of turning it off: saves about 3.7 MB, makes three of complete.md's constants depend on the budget, and changes ranking with the budget |
| D4 | Startup or live | **Startup only.** A `systemctl --user restart tether` applies a change and costs a reconnect, which tether is built to make cheap | Live: shrinking a cap that is in use needs a policy for what's already open (close it, or let it drain), and resizing the hub's caps breaks its fixed-at-construction state. It buys nothing for a value set once per box |
| D5 | The CPU cap | **`CPUQuota=50%`, `CPUQuotaPeriodSec=20ms`** (reasons in §3.3) | `100%`: one core, about what the current-thread runtime can use anyway, so it caps nothing on a crowded box. `25%`: bursts take 4× as long and a throttled keystroke can wait 15 ms per 20 ms period, for a box-wide saving that matters only at more than a few users. The 100 ms default period: a throttled keystroke can wait 50 ms |
| D6 | Ship the accept loop now | **Yes: browser-auth's accept loop (64 connection permits, 16 KiB hyper buffers, 100 s header-read timeout) lands with the budget**, without the static shell or the rest of browser auth. Without it, HTTP connections are unbounded and the ceiling isn't one | Wait for browser auth: the budget would claim a bound that doesn't hold until then |
| D7 | Refusal wording on the wire | **A new value, `limit`, in two enums: `watchEnded { reason: "limit" }` and HTTP `{"error":"limit"}`.** The web shows the cap and retries on a backoff that grows. No protocol bump: an older web reads any reason but `detached` as `error`, and any HTTP error but `busy` as a failure, as today. 4005 keeps meaning the socket cap | Reuse `error` and `busy`: the web can't tell "retry in a second" from "won't clear until a tab closes". It retries a refused watch every 0.5 s forever (below), each retry a Locate one-shot spawning tmux |

D3's table, for reference (§3.1 has it in full):

| Effective budget, MiB | tmux sessions | sockets | small slots | completion | unreclaimable ceiling, MB |
|---|---|---|---|---|---|
| **72 and up (default 72)** | **3** | **3** | **full** | **on** | **63.8** |
| 64–71 | 2 | 3 | full | on | 58.5 |
| 56–63 | 1 | 3 | halved | on | 50.7 |
| 52–55 | 1 | 2 | halved | on | 46.3 |
| 40–51 | 1 | 2 | halved | off | 35.0 |
| below 40 | refuses to start | | | | |

**Found while checking the refusal paths, outside this spec's scope:** the web's tab
reducer (`web/tabs/connection.ts`) restarts its backoff at attempt 0 on every
`watchEnded { error }`, so a watch that fails the same way each time is retried every
0.5 s forever. The tmux-session cap is one way in; a control client that keeps crashing
is another. The client change in §3.6 fixes both: every refused watch climbs the
backoff.

## 3. Proposed text

Each block is written as the current rule, for the recommended answers above. Where a
block depends on browser auth having landed, rows marked † drop out if this lands
first.

### 3.1 daemon-core.md §6 (replacement)

> ## 6. Limits and the memory ceiling
>
> Every daemon constant lives here, except the file API's, which are in
> [fs.md](fs.md#constants), and completion's, in [complete.md](complete.md#constants);
> other documents link to this table. Most are fixed. A few scale with the memory
> budget, and those come from the tier table below.
>
> ### 6.1 The memory budget
>
> `memory_budget_mib` in `config.toml` ([plan.md](plan.md#config)), default 72, is the
> most memory tether's unit may hold that the kernel can't reclaim. At startup
> `main` reads it, then reads the unit's cgroup limit: the `0::` line of
> `/proc/self/cgroup` names the cgroup, and the lowest `memory.max` from that
> directory up to the cgroup root is the limit (`max` means none). The **effective
> budget** is the lower of the two, rounded down to whole MiB. With no cgroup v2
> hierarchy, as in a dev run, it is the configured value.
>
> - Effective budget below 40 MiB: the daemon logs `memory budget <n> MiB (config <c>,
>   unit <u>) is below the minimum of 40 MiB` and exits with status 78. The unit's
>   `RestartPreventExitStatus=78` keeps systemd from restarting it.
> - Configured budget above the unit's limit: a warning names both and the lower
>   governs. The unit's limit above the budget is logged at info: the budget
>   governs.
> - The startup log line names the effective budget, the tier, and its caps. The debug
>   endpoint reports them.
>
> The budget is read once. A change takes effect at the next start. `memory_budget_mib`
> is not written by the Settings sheet.
>
> **The tiers.** The effective budget picks one row. Each row's unreclaimable ceiling
> (§6.3) plus 4 MiB of headroom fits the lowest budget in its range, so no cap in the
> row can bring the unit to `MemoryMax`. Above 72 nothing more opens: no cap exceeds
> its 72-row value.
>
> | Effective budget, MiB | Control clients | Connections (sockets) | Capture slots | Paste slots | Raw responses | Shell slots, waiters† | Completion |
> |---|---|---|---|---|---|---|---|
> | 72 and up (default) | 3 | 3 | 2 | 4 | 2 | 4, 16 | on |
> | 64–71 | 2 | 3 | 2 | 4 | 2 | 4, 16 | on |
> | 56–63 | 1 | 3 | 1 | 2 | 1 | 2, 18 | on |
> | 52–55 | 1 | 2 | 1 | 2 | 1 | 2, 18 | on |
> | 40–51 | 1 | 2 | 1 | 2 | 1 | 2, 18 | off |
>
> Halving the shell slots raises the waiters by 2, so slots plus waiters stays 20: two
> browser profiles' cold loads (about 10 requests each) still queue rather than get
> `503`.
>
> **Why these scale and nothing else.** Each scaled cap is a count of things open at
> once, and refusing one more costs the user a wait or a retry, never a wrong result.
> Every other limit stays fixed:
>
> - **Per-message and per-frame bounds** (inbound message, input and paste per
>   message, frame size, line length, reply bodies per group, tmux names): they are
>   protocol and security bounds, and a peer must not see them change with the host's
>   tuning.
> - **Per-connection credit, overdraft and the capture reservation:** a snapshot of the
>   largest clamped screen has to fit the reservation, and the reservation has to fit
>   the credit. Shrinking them would fail snapshots, not refuse them.
> - **One-shots (1), scans (1), uploads (1), watches per connection (2):** already at
>   their minimum useful count.
> - **The connection backstop (64) and hyper's buffers (16 KiB):** together 2.1 MB.
>   The backstop has to stay above the sum of the routes' caps and waiters, or a
>   native reconnect would queue behind a browser's page load; halving it would save
>   about 1 MB.
> - **Blocking lanes and `TasksMax`:** they bound threads, not memory.
> - **Timeouts, deadlines and coalescing:** time, not memory.
> - **Completion's constants**, when completion is on: halving them would change
>   ranking with the budget. Completion is on or off.
>
> The tier table, the per-item costs below, and a unit test that recomputes each row's
> ceiling and checks it against its range all live in `src/budget.rs`. The hub's
> `State`, the HTTP semaphores, the fs slots and `complete` take their caps from the
> `Caps` it returns, once, at construction.
>
> ### 6.2 Limits
>
> | Limit | Value | When hit |
> |---|---|---|
> | connections, from the upgrade | tier table: 3 by default; browser tabs, the PWA and native all count† | close 4005 |
> | connection permits, the backstop | 64, every accepted connection, upgraded ones included | stop accepting; the kernel's backlog of 32 holds newcomers |
> | hyper buffer per connection | 16 KiB, read and write each | a larger request head: 431 |
> | header-read and idle timeout | 100 s | connection closed |
> | watches per connection | 2 | `watchEnded { error }` |
> | control clients | tier table: 3 by default; lingering ones closed first | `watchEnded { limit }` |
> | control-client linger | 15 s | |
> | groups in flight per control client | 32; user requests below 24 | user: `busy`; maintenance waits |
> | capture slots (snapshot, history) | tier table: 2 by default, daemon-wide | history: `busy`; snapshot waits |
> | reply timeout | 10 s with groups in flight and none completing | kill the client (crashed) |
> | line length (parser) | 1 MiB | line discarded; the group it falls in fails `TooLarge` |
> | reply bodies per group (`Session`) | 1 MiB | group fails `TooLarge` |
> | snapshot attempts | 3 | `Torn` |
> | pump read size; pump → hub channel | 16 KiB; 128 chunks | the pump waits |
> | connection → hub channel | 128 messages | the connection waits |
> | credit per connection | 2 MiB outstanding | output: that watch starves; snapshot: waits; history, listing: `busy` |
> | capture reservation (snapshot, history) | 1 MiB; a history chunk's base64 text must fit it | snapshot: `TooLarge`; history: fewer rows, and a `TooLarge` capture is retried with half the rows (§4.6) |
> | listing reservation | 256 KiB | `error { tmux }` |
> | control JSON overdraft | 64 KiB past the credit | wedged, 4002 |
> | connection's own replies (`welcome`, `pong`, paste refusals), uncharged | 16 queued | the socket isn't read until one is written (§4.6) |
> | hub → connection channel | (credit + overdraft) / 64 B charge floor = 33,792 messages, so it can't fill | wedged, 4002 |
> | tmux names and error texts in messages | 256 bytes | cut |
> | snapshot spacing for a starved watch | 250 ms | |
> | output coalescing | 33 ms, frames ≤ 64 KiB | |
> | one-shots | 1 at a time, 2 s timeout | user one-shots: `busy` |
> | crash respawn | after 1 s; a second crash in 60 s ends the watches | |
> | inbound WebSocket message | 512 KiB | close 4009 |
> | input / paste per message | 4 KiB / 256 KiB | `error { inputTooLarge }` |
> | paste slots (files awaiting tmux) | tier table: 4 by default, daemon-wide | `error { busy }`, before writing |
> | completion: carapace, history, PATH, paths | [complete.md](complete.md#constants); off in the lowest tier | off: `503 limit` |
> | history per request | 200 rows | clamped |
> | `hello` deadline | 10 s | close 4003 |
> | ping / idle timeout | every 10 s / 25 s silent | close 4000; the 10 s timer also re-checks auth (removed: 4401; unreadable file: 4503) |
> | size clamp | 20..=500 cols × 5..=300 rows | clamped |
> | `pause-after` | 3 s | `Gap` → snapshot |
> | scratch sessions | 2 | `error { tooManySessions }` |
> | shell slots and waiters† | tier table: 4 and 16 by default | the next: `503 busy` at once |
> | shell stall; response deadline† | 30 s; 60 s | aborted |
> | shell size† | 3 MiB embedded, 1.5 MiB per file, 128 files | the build fails |
>
> **A cap refusal says which kind it is.** `busy` clears within a second or so, and the
> client retries soon. `limit` is a tier cap that clears only when something else
> closes or the budget is raised: `watchEnded { reason: "limit", message }`, whose
> message names the cap ("tether on this host allows 1 tmux session at a time"), and
> HTTP `503 {"error":"limit"}` with no `Retry-After`. The socket cap keeps its own
> close code, 4005.
>
> ### 6.3 The memory ceiling
>
> With every item at its cap at once. Nothing grows with time. The default column is the
> 72-and-up tier.
>
> | Item | Bound | Per cap, MB | Default, MB |
> |---|---|---|---|
> | daemon: code, runtime, tasks | budget target | | 5 |
> | one-shot `tmux` | 1 × 4.9 MB measured | | 5 |
> | tmux chunks, pump → hub | 128 × 16 KiB | | 2 |
> | file API, fixed part: a scan, an upload (2 MiB of dirty pages between flushes included), a listing page | [fs.md](fs.md#limits-and-the-memory-ceiling) | | 3.5 |
> | HTTP connections not upgraded | (64 permits − sockets) × (16 KiB read + 16 KiB write buffer + ~4 KiB state) | | 2.1 |
> | kernel socket buffers, fixed part: an upload and a couple of JSON replies | 3 × 256 KiB | | 0.75 |
> | control clients | 5.3 measured each | 5.3 | 15.9 |
> | sockets: payloads hub → socket (2 MiB credit + 64 KiB overdraft), the writer's copy of a frame (1 MiB), an inbound message and its decoded copy (1 MiB), kernel buffers (256 KiB) | each | 4.4 | 13.2 |
> | reply bodies, in the capture slots | 1 MiB each | 1 | 2 |
> | paste files on tmpfs | 256 KiB each | 0.25 | 1 |
> | raw responses: a 64 KiB chunk and its channel, kernel buffers | each | 0.5 | 1 |
> | shell slots: kernel buffers† | each | 0.25 | 1 |
> | completion, on: indexes, caches, a carapace launch | [complete.md](complete.md#memory-cpu-and-threads), less the slab | | 11.3 |
> | **unreclaimable ceiling** | | | **63.8** |
> | completion's dentry and inode slab (reclaimable) | measured | | 2.4 |
> | embedded shell pages (clean, file-backed, reclaimable)† | at most the 3 MiB embedded | | 3.1 |
> | **ceiling** | | | **69.3** |
>
> By tier, the unreclaimable ceiling is 63.8 MB (72 and up), 58.5 (64–71), 50.7
> (56–63), 46.3 (52–55) and 35.0 (40–51). Each plus the 4 MiB headroom fits the lowest
> budget in its range. Without the rows marked †, each is 0.5 MB (halved tiers) to 1 MB lower.
>
> **What has to fit.** The ceiling counts every item, reclaimable ones included. The
> rule is held on the rest: the unreclaimable ceiling plus the headroom must fit the
> effective budget, because the kernel drops clean file pages and reclaimable slab
> before it kills, and the effective budget is never above `MemoryMax`. The
> reclaimable rows still count toward `MemoryHigh` (three quarters of the budget,
> 54 MiB by default), where systemd throttles the unit, so the throttle comes sooner
> while they are warm. At every cap a unit is above its `MemoryHigh` in every tier:
> throttled, not killed, and only in a state one user rarely reaches.
>
> The [budget measurement](plan.md#resource-budget) checks each tier at the bottom of
> its range: under load at every cap, sample the unit's `memory.stat` every 100 ms; the
> largest `anon + kernel + sock − slab_reclaimable` must not exceed the row's computed
> unreclaimable ceiling, and `memory.events` must show no `oom_kill`. Record
> `memory.peak` beside it. If a measurement exceeds a row, the row's cost is raised in
> `src/budget.rs`, and the test moves the tier boundary.
>
> The normal case, one control client and one watch, is about 11 MB, plus up to
> 14 MB of completion state while Jimmy types and for five minutes after (the slab is
> the part the idle drop doesn't free).

### 3.2 plan.md "Config" (row added) and "Resource budget" (replacement)

Config, one row after `port`:

> | `memory_budget_mib` | 72 | the most memory tether's unit may hold, in MiB, at least 40. It sets how many tmux sessions, sockets and slots can be open at once, and whether completion runs ([daemon-core.md §6.1](daemon-core.md#61-the-memory-budget)). Read at startup. Keep the unit's `MemoryMax` equal to it ([running.md](../running.md#tune-the-resource-limits)) |

The sentence under the table, "With neither socket key…", stays.

Resource budget, replacing the section:

> ## Resource budget
>
> The dev server is already overloaded and crashes, and more than one user may run a
> tether there. Targets: daemon idle RSS under ~5 MB with no phone connected, about 0%
> CPU when nobody is connected, a hard cap on CPU and memory that the user can tighten,
> and no way to make the existing crashes worse. The caps rarely bind for one user;
> they exist for a crowded box. The MVP gate is meeting this budget, measured on the
> box with the debug endpoint (behind auth), which reports RSS, tasks, control
> clients, buffer use, and the effective memory budget and its caps.
>
> - **Event-driven:** control-mode events, no periodic capture, no `tmux ls` loop. With
>   no phone connected, tether holds no control clients and no pane state once the
>   control-client linger has passed.
> - **Nothing held for panes nobody views:** a pane's state exists only while a tab on
>   screen shows it, and unviewed panes are paused in tmux.
> - **Everything bounded, and sized by one setting:** every queue, buffer and cap, and
>   the resulting memory ceiling, is in
>   [daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling). The counts of
>   things open at once (tmux sessions, sockets, a few small slots, and whether
>   completion runs) follow the memory budget, `memory_budget_mib` in
>   [Config](#config). A tighter budget opens fewer things at once and refuses the next
>   with a `limit` message. It never lets the ceiling reach the unit's `MemoryMax`:
>   the daemon reads that limit at startup, uses it if it is lower, and refuses to
>   start below 40 MiB.
> - **Blocking work is isolated:** the 8-thread Tokio blocking pool is split into lanes;
>   a hung filesystem operation cannot consume auth threads. All blocking work enters
>   through `src/blocking.rs`; Tokio filesystem APIs are disabled. Lane budgets:
>
>   | Lane | Threads | Wait | Waiting callers | Work |
>   |---|---:|---:|---:|---|
>   | `fs` | 4 | 10 s | 8 shared across scans, raw responses and blocking calls | file API |
>   | `index` | 1 | 300 ms | uncapped | history and PATH indexes |
>   | `dir` | 1 | 300 ms | uncapped | directory checks and completion listings |
>   | `auth` | 2 | 10 s | uncapped | auth files and paste files |
>
>   A caller that exceeds its lane wait receives `busy` or skips that completion source;
>   the permit stays with work that is still running.
>   Uploads stream to disk; listings are paged; previews truncated; scrollback comes in
>   fixed chunks.
> - **Completion is lazy:** the PATH index is built on first use and refreshed when a
>   PATH directory's mtime changes (checked on request); carapace runs per request, one
>   at a time, in its own transient systemd scope, so its 17–44 MB per run never counts
>   against this unit. Everything completion holds is freed after 5 idle minutes. Below
>   a 52 MiB budget completion is off. Limits: [complete.md](complete.md#constants).
> - **No heavy server work:** HEIC conversion happens on the phone; videos stream as-is
>   over HTTP Range; no thumbnails, no transcoding, no file watcher.
> - **Crash safety:** tmux is the source of truth. If tether restarts, clients reconnect
>   and repaint from snapshots.
>
> **systemd user unit** (`contrib/tether.service`): `Type=notify`, `KillMode=mixed`,
> `Restart=on-failure` with a backoff (`RestartSec=2`, `RestartSteps=5`,
> `RestartMaxDelaySec=60`, `StartLimitIntervalSec=0`) and
> `RestartPreventExitStatus=78`, `MemoryHigh=54M`, `MemoryMax=72M`, `CPUQuota=50%`,
> `CPUQuotaPeriodSec=20ms`, `CPUWeight=20`, `Nice=10`, `IOWeight=10`,
> `IOSchedulingClass=idle`, `TasksMax=32`, `OOMScoreAdjust=500` (the kernel kills
> tether before tmux or the agents), and
> `Environment=GLIBC_TUNABLES=glibc.malloc.mmap_threshold=131072`. Each is tuned with
> `systemctl --user edit tether` ([running.md](../running.md#tune-the-resource-limits)).
>
> - `KillMode=mixed` sends SIGTERM to tether alone, so it closes its sockets with 4004
>   and its control clients itself. Under the default kill mode, systemd also signals the
>   `tmux -C` clients directly, and the hub would report them as detached while the
>   sockets close, so a phone could get `watchEnded { detached }` instead of reconnecting.
>   SIGKILL after the stop timeout still reaches every process in the cgroup.
> - The restart backoff is there because tailscaled is a system unit that this user unit
>   can't order itself after: at boot tether may start before tailscaled is up and exit,
>   and the backoff keeps it retrying instead of hitting the start limit. Exit status
>   78 means the memory budget is below the minimum, which a restart can't fix.
> - `MemoryMax` equals the default memory budget, 72M, and `MemoryHigh` is three
>   quarters of it, 54M. The daemon reads `MemoryMax` at startup and never sizes its
>   caps above it, so lowering `MemoryMax` alone is safe; raising it needs
>   `memory_budget_mib` raised too. `MemoryMax` covers the daemon, its control clients
>   and one-shots. tmux, the scratch server and carapace run outside the unit: carapace
>   in a transient scope with its own limits
>   ([complete.md](complete.md#where-carapace-runs-its-own-scope)). So the cap bounds
>   only tether's own memory, and the default leaves room for 3 tmux sessions at once.
> - `CPUQuota=50%` holds the unit to half of one core. The daemon's async work runs on
>   one thread (the current-thread runtime), and its heaviest sustained load, an output
>   flood, measured 2% of a core after the pump batched its reads, so the quota binds
>   only on bursts: a snapshot, an index build, a directory scan, which it stretches by
>   up to double. `CPUQuotaPeriodSec=20ms` slices the quota finely, so a keystroke that
>   arrives while the unit is throttled waits at most 10 ms, inside one 60 Hz frame.
>   `CPUWeight` and `Nice` still make tether yield first under contention, below the
>   quota.
> - `GLIBC_TUNABLES` pins glibc's mmap threshold at 128 KiB. glibc raises that threshold
>   after the first large free, so completion's indexes would land in the heap and stay
>   resident after its idle drop; pinned, each is its own mapping and goes back to the
>   kernel on free, with no `unsafe` call ([complete.md](complete.md#memory-cpu-and-threads)).
>   It affects only the glibc build, the one `cargo install` makes and the unit runs. The
>   Linux release binaries are static musl, which ignore it; musl's behaviour is
>   unmeasured.
> - `TasksMax` counts threads and processes in the cgroup. tokio's blocking pool
>   defaults to 512 threads, so `max_blocking_threads` is 8. The total, with control
>   clients and a one-shot, stays under 32. A carapace run (a Go binary starts several
>   threads) counts only as `systemd-run` until it moves into its own scope.
> - The memory and CPU limits take effect only where the user manager has the `memory`
>   and `cpu` controllers delegated; without `cpu`, `CPUQuota` and `CPUWeight` do
>   nothing, silently. The budget measurement checks it.

### 3.3 `contrib/tether.service` (replacement)

```ini
# tether, as a systemd user unit (plan.md "Resource budget"). Install and run it as
# docs/running.md says; it isn't installed for you. Tune the limits with
# `systemctl --user edit tether` (running.md "Tune the resource limits").
#
# tether attaches to your tmux server and never starts it: a tmux server started from
# this unit would live in its cgroup and die with it.

[Unit]
Description=tether: phone-first client for tmux, over Tailscale
Documentation=https://github.com/haowjy/tether/blob/main/docs/running.md
# Restarts back off instead (RestartSteps below): at boot tailscaled, a system unit
# this user unit can't order itself after, may not be up yet.
StartLimitIntervalSec=0

[Service]
Type=notify
ExecStart=%h/.cargo/bin/tether serve
# SIGTERM goes to tether alone, which closes its sockets with 4004 and its tmux
# control clients itself. Signalled directly, a control client exits as if detached,
# and a phone could be told "detached" instead of reconnecting.
KillMode=mixed
Restart=on-failure
RestartSec=2
RestartSteps=5
RestartMaxDelaySec=60
# 78: the memory budget is below tether's minimum of 40 MiB. A restart can't fix it.
RestartPreventExitStatus=78

# MemoryMax is the memory budget: keep it equal to memory_budget_mib in config.toml
# (default 72), and MemoryHigh at three quarters of it. tether reads MemoryMax at
# startup and sizes what it opens at once to the lower of the two.
MemoryHigh=54M
MemoryMax=72M
# glibc raises its mmap threshold after the first large free, so later completion
# indexes would come from the heap and stay resident after the idle drop. Pinned,
# every allocation over 128 KiB is its own mapping, returned on free (complete.md).
Environment=GLIBC_TUNABLES=glibc.malloc.mmap_threshold=131072
# Half a core at most, metered every 20 ms so a throttled keystroke waits at most
# 10 ms. An output flood costs about 2% of a core; only bursts reach the cap.
CPUQuota=50%
CPUQuotaPeriodSec=20ms
CPUWeight=20
Nice=10
IOWeight=10
IOSchedulingClass=idle
# Each carapace run moves into its own transient scope (systemd-run --user --scope,
# through the user manager this unit runs under), so only systemd-run counts here,
# and only until it execs.
TasksMax=32
# The kernel kills tether before tmux or the agents in it.
OOMScoreAdjust=500

[Install]
WantedBy=default.target
```

### 3.4 `docs/running.md`

In "Configure", one line in the example after `name`:

```toml
# memory_budget_mib = 72 # the most memory tether may use; keep the unit's MemoryMax equal ([Tune the resource limits](#tune-the-resource-limits))
```

In "Run it under systemd", the sentence "The unit carries the resource limits…" gains
a pointer: "…from [plan.md](design/plan.md#resource-budget), which you can tighten
([Tune the resource limits](#tune-the-resource-limits)), …".

A new section after "Run it under systemd":

> ## Tune the resource limits
>
> tether is capped at half a CPU core and 72 MiB of memory. For one user the caps
> rarely bind. Tighten them on a crowded box, or when several users each run their own
> tether.
>
> **Memory** is set in two places that must agree: `memory_budget_mib` in
> `config.toml` and the unit's `MemoryMax`. tether sizes what it opens at once to the
> budget, so a tighter budget means fewer things open, never an out-of-memory kill:
>
> | Budget, MiB | tmux sessions at once | Connections | Suggestion strip |
> |---|---|---|---|
> | 72 and up (default 72) | 3 | 3 | on |
> | 64–71 | 2 | 3 | on |
> | 56–63 | 1 | 3 | on |
> | 52–55 | 1 | 2 | on |
> | 40–51 | 1 | 2 | off |
>
> "tmux sessions" counts sessions with a window open in a tab, on any device; tabs from
> one session share it. "Connections" counts the app and browser tabs connected at
> once, per host. The lower tiers also halve a few small slots (pastes in flight,
> scrollback fetches, image loads), which makes those wait a little more. 40 is the
> minimum.
>
> To set 48 MiB, edit the unit:
>
> ```bash
> systemctl --user edit tether
> ```
>
> ```ini
> [Service]
> MemoryMax=48M
> MemoryHigh=36M
> ```
>
> Set `MemoryHigh` to three quarters of `MemoryMax`; above it systemd slows tether
> down. Then set the budget in `config.toml` and restart:
>
> ```toml
> memory_budget_mib = 48
> ```
>
> ```bash
> systemctl --user restart tether
> journalctl --user -u tether -b | grep 'memory budget'   # the budget in use and its caps
> ```
>
> At startup tether reads the unit's `MemoryMax` and uses it if it is lower than
> `memory_budget_mib`, so lowering `MemoryMax` alone is safe. Raising it takes both.
> Below 40 MiB tether refuses to start and says so in the journal.
>
> **CPU** is `CPUQuota=50%`, half of one core. To give tether a quarter core:
>
> ```ini
> [Service]
> CPUQuota=25%
> ```
>
> Bursts (opening a big window, the first suggestion after a pause, a large directory)
> take longer under a tighter quota. Typing stays responsive: the quota is metered every
> 20 ms (`CPUQuotaPeriodSec`), so a keystroke never waits more than one slice.
> `CPUWeight=20` and `Nice=10` already make tether give way to everything else when
> the box is busy; the quota caps it even when the box is idle.
>
> Check what's in force:
>
> ```bash
> systemctl --user show tether -p MemoryMax -p MemoryHigh -p CPUQuotaPerSecUSec -p CPUQuotaPeriodUSec
> cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/cgroup.controllers
> ```
>
> The second line must list `cpu` and `memory`. If `cpu` is missing, your distribution
> doesn't delegate it to user units, and `CPUQuota` and `CPUWeight` do nothing.
> `systemctl edit user@.service` with `Delegate=cpu cpuset io memory pids` (as root)
> turns it on.

"When something fails", rows added:

> | tether exits at start: "memory budget … is below the minimum of 40 MiB" | `memory_budget_mib` or the unit's `MemoryMax` is under 40 MiB. Raise it; systemd won't restart tether until you do |
> | a tab says "Session limit" | tabs on this host already hold windows from as many tmux sessions as the memory budget allows. Close the tabs from another session, or raise the budget |
> | "Too many connections to <host>" | the app and browser tabs on this host fill its connections. It retries by itself; a connection left over from a network change clears within 25 s |
> | no suggestion strip, and the journal's startup line says completion is off | the memory budget is below 52 MiB |

### 3.5 What the user sees when a cap binds

The iOS app and a browser run the same web UI and the same `HostLink`, so each refusal
looks the same on both. Native screens (host list, Add host) use only the auth
routes, which nothing here scales, so they show nothing new.

| Cap | Wire | Web UI, in the app or a browser |
|---|---|---|
| tmux sessions (control clients) | `watchEnded { reason: "limit", message }` | the tab's pill: "Session limit". Detail: the message ("tether on devbox allows 1 tmux session at a time"); hint: "Close tabs from another tmux session". The tab retries on the climbing backoff (0.5 s … 30 s); a tap retries now. Switching one device between sessions works: at the cap the lingering client for the old session closes first |
| connections (sockets) | close 4005 | host status "Too many connections to <host>", with the usual retry countdown (the host backoff already climbs) |
| completion off | `503 {"error":"limit"}` from `/complete` | the strip shows one muted line, "Suggestions off on <host>", once per connection, then nothing. The suggester stops asking that host until its next `welcome`, so no request goes out per keystroke |
| paste slots | `error { busy }` (unchanged) | the existing paste refusal |
| capture slots | snapshot waits; history `busy` (unchanged) | a scrollback fetch retries as today |
| raw responses | waits on the fs lane; `503 busy` past 8 waiters (unchanged) | images load one at a time instead of two; "<host> is busy" only past the waiters, as today |
| shell slots† | waits; `503 busy` past the waiters | the browser's own load retry; a service-worker update fails whole and retries at the next check |

### 3.6 Other spec lines this touches

Short edits, for the build to carry in the same commits:

- **daemon-core §4.5:** "the window's watches end with `watchEnded { limit }` (the
  control-client cap, from the tier table), and the window is dropped".
- **daemon-core §5.3:** `watchEnded.reason` is `detached | error | limit`; `HttpError`
  gains `limit`. No version bump: an older web reads any reason but `detached` as
  `error`, and any HTTP error but `busy` as a failure.
- **daemon-core §7:** "user requests at the threshold → `busy`" gains a row: "a tier
  cap → `limit` (`watchEnded`, HTTP `503`), or 4005 for a socket".
- **daemon-core, new HTTP subsection:** browser-auth §5's "One rule bounds HTTP"
  (without the shell row) and "The accept loop", moved here so they land with the
  budget (D6). Browser auth then adds only the shell.
- **fs.md "Constants":** raw responses "2, or 1 below a 64 MiB budget
  ([daemon-core §6.1](daemon-core.md#61-the-memory-budget))". "Errors" gains no row:
  the file API never answers `limit`.
- **complete.md "Constants":** a first row, "completion: on at a memory budget of 52
  MiB and up; off below, every request answered `503 limit` and nothing built".
- **The web client** (its spec under `docs/design/client/`): a `watchEnded` with reason
  `limit` or `error` is a failed attempt, so the backoff climbs from the tab's attempt
  count instead of restarting at 0.5 s. A `limit` shows its message. A `/complete`
  `limit` turns the strip off for that host until the next `welcome`. 4005 shows "Too
  many connections".
- **browser-auth.md, revision 4:** D6 is answered here: keep 3 control clients. The
  count is budget-derived, and the default budget of 72 yields 3; `MemoryMax` rises to
  72M rather than a session being dropped. Its §5 daemon-core §6 rows (the accept loop
  and the static shell) are already in §3.1 above, marked †.

## 4. `decisions.md` entry

A new section, `## Resource limits`, after `## Tailscale first, public HTTPS follow-up`:

> ## Resource limits
>
> ### One memory budget sizes the caps, checked against the unit
>
> - **Decided:** 2026-10-23, Jimmy (a hard CPU cap, one memory setting in
>   `config.toml`, OOM never the result, tuning documented in running.md; D6 of the
>   browser-auth draft answered "budget-derived", and a default of 72, keeping 3 tmux
>   sessions at once), design (the rest).
> - **What:** `memory_budget_mib` (default 72, at least 40) bounds the memory tether's
>   unit holds that the kernel can't reclaim. At startup the daemon takes the lower of
>   it and the unit's cgroup `memory.max` (the lowest from its cgroup up), and picks
>   one of five tiers. Each tier's unreclaimable ceiling plus 4 MiB fits the lowest
>   budget in its range. As the budget tightens, the third tmux session goes below 72,
>   the second (with the capture, paste, raw and shell slots halved) below 64, the third
>   socket below 56, and completion below 52. Below 40 the daemon exits 78 and the
>   unit's `RestartPreventExitStatus=78` keeps it down. The default yields 3 tmux
>   sessions, 3 sockets and every other cap as before, with an unreclaimable ceiling of
>   about 63.8 MB against 72; the unit's `MemoryMax` rises from 64M to 72M and
>   `MemoryHigh` from 48M to 54M. A tier cap refuses with a new `limit` value
>   (`watchEnded`, HTTP), distinct from `busy`; the socket cap keeps 4005. Read at
>   startup only. Browser auth's accept loop (64 connection permits, 16 KiB hyper
>   buffers) ships with this change, because without it HTTP connections are unbounded
>   and no budget is a bound.
> - **Why:** the dev box is shared and overloaded, and several users may each run a
>   tether. One number is all a user should have to choose; the daemon knows its own
>   costs. Reading the unit's limit makes lowering `MemoryMax` alone safe, so the
>   setting and the unit can't drift into an OOM kill. Tiers instead of a formula keep
>   each configuration few enough to measure on the box. A lost socket heals itself
>   within 25 s (the stale one ages out), so it goes before completion, which stays
>   lost. The default keeps 3 tmux sessions because the unit's cap bounds only tether:
>   tmux, its sessions and their processes run outside the unit, so a higher cap costs
>   only tether's own ceiling, 8 MiB more at most. Fixed bounds stay fixed: per-message and per-frame bounds are protocol and
>   security limits a peer must not see change; credit and the capture reservation must
>   hold the largest snapshot; the connection backstop must stay above the routes' sum.
> - **Rejected:** documentation only (one missed edit and the caps outgrow
>   `MemoryMax`); a check without documentation (the user wouldn't know what to set);
>   the budget taken from `MemoryMax` with no config key (contradicts Jimmy's setting;
>   no budget in a dev run); starting at the floor tier under 40 MiB (an OOM kill at
>   caps); a solver over every cap (configurations nobody has measured); budgets above
>   72 raising caps past today's; halving completion's history and caches instead of
>   turning it off (three constants depend on the budget and ranking changes with it,
>   for 3.7 MB); completion before the third socket (tiers at 48 and 40; no strip at
>   48–55); reloading the budget live (a policy for shrinking caps in use, for a value
>   set once); reusing `error` and `busy` for cap refusals (the web couldn't tell a
>   one-second wait from one that needs a tab closed, and retried a refused watch every
>   0.5 s); a default of 64 with 2 tmux sessions at once, keeping today's `MemoryMax`
>   (one fewer session, to save 8 MiB of tether's own memory; tmux and its processes
>   run outside the unit, so a higher cap costs only tether's ceiling); 3 tmux sessions
>   at a budget of 64 (an unreclaimable ceiling of 63.8 MB leaves no headroom).
>
> ### The unit caps CPU at half a core, metered every 20 ms
>
> - **Decided:** 2026-10-23, Jimmy (a hard cap), design (the value).
> - **What:** `CPUQuota=50%`, `CPUQuotaPeriodSec=20ms`, beside the existing
>   `CPUWeight=20` and `Nice=10`.
> - **Why:** `CPUWeight` and `Nice` make tether yield under contention but cap nothing.
>   The daemon's async work runs on one thread, and its heaviest sustained load, an
>   output flood, measured 2% of a core (Batched pipe reads), so half a core binds only
>   on bursts (a snapshot, an index build, a directory scan) and stretches them by up to
>   double. The 20 ms period keeps a throttled keystroke's wait to 10 ms, inside one
>   60 Hz frame; the 100 ms default would allow 50 ms.
> - **Rejected:** 100% (about what the current-thread runtime uses anyway: no cap on a
>   crowded box); 25% (bursts 4× longer and 15 ms stalls, for a saving that matters only
>   with several users at once, who can set it); the default period (50 ms keystroke
>   stalls).

## 5. Probe gates

Run on the dev box under a second, probe-only unit, never the live `tether.service`:
`systemd-run --user --unit tether-probe -p MemoryMax=… -p MemoryHigh=… -p CPUQuota=50%
-p CPUQuotaPeriodSec=20ms -p RestartPreventExitStatus=78 … tether serve --config <probe
config>`, on its own port, against a scratch tmux server (`-L tether-probe`). Record
every number in the build's decisions entry.

| Gate | Setup | Pass |
|---|---|---|
| R1 controllers | Read `cgroup.controllers` of the user manager's cgroup and the probe unit's; `systemctl --user show tether-probe` for the four limits | `cpu`, `memory` and `pids` delegated; `MemoryMax`, `MemoryHigh`, `CPUQuotaPerSecUSec=500ms` and `CPUQuotaPeriodUSec=20ms` as set. If `cpu` is missing, the CPU gates can't pass and running.md's delegation note is the fix |
| R2 startup check | Start the probe with (config, `MemoryMax`) = (unset, 72M), (unset, 64M), (72, 48M), (48, 72M), (72, unset, outside systemd), (72, 32M), (30, 72M) | The log names the effective budget and tier: 72 / tier 72 and up; 64 / tier 64–71, with a warning naming both (a unit left at today's `MemoryMax`); 48 / tier 40–51, with a warning; 48, info; 72. The last two exit 78 with the message, and `systemctl --user status` shows no restart after 2 minutes |
| R3 ceiling per tier | For each tier at the bottom of its range (72, 64, 56, 52, 40): every cap held at once, as browser-auth G12 does it (the tier's control clients, each socket with 2 watches flooding through readers throttled to 64 kbit/s, raw streams, an upload, completion warm on a 1 MiB history and a 5,000-entry listing, a carapace run, the shell's two-profile cold load†, a 64-connection flood); sample `memory.stat` every 100 ms for 2 minutes | The largest `anon + kernel + sock − slab_reclaimable` is at most the row's computed unreclaimable ceiling (63.8, 58.5, 50.7, 46.3, 35.0 MB); `memory.events` shows `oom_kill 0`. Record `memory.peak`, the largest sample, and `memory.events high` |
| R4 refusals | At each cap, one more: a watch in another tmux session, a fourth (or third) socket, `/complete` in the 40 tier, a third paste | `watchEnded { limit }` with the cap in its message, and the tab's retries climb: at most 8 Locate one-shots in 60 s, counted from the probe's log. 4005 and the "Too many connections" status. One `503 limit` per connection, then no `/complete` requests. `error { busy }` |
| R5 CPU idle and flood | Idle with no phone for 10 minutes; then a numbered-line flood in a watched pane, phone on Wi-Fi, for 60 s; read `cpu.stat` before and after each | Idle: `usage_usec` grows under 0.1% of a core. Flood: under 10% of a core and `nr_throttled` unchanged; keystroke echo p99 within 16 ms (spike-1's gate), the same as with no quota |
| R6 CPU bursts | Three sockets flooding at once, plus the first completion on a cold 1 MiB history, a 5,000-entry listing and a 500 × 300 snapshot, repeated 10 times; then the same with `CPUQuota=25%` | Record `nr_throttled`, `throttled_usec`, and the time each burst takes against the unthrottled run. Pass: echo p99 within 26 ms (one frame plus one 10 ms slice) at 50%; no watch ends and no reply timeout fires at 25% |

## Sources

- Read: `docs/design/daemon-core.md` §4.5, §5.2–5.3, §6, §7; `docs/design/plan.md`
  "Config", "Resource budget"; `docs/design/fs.md` "Constants", "Errors", "Limits and
  the memory ceiling"; `docs/design/complete.md` "Constants", "Where carapace runs",
  "Memory, CPU and threads"; `docs/design/decisions.md` "Batched pipe reads for
  control clients" (the 2% flood figure) and its entry format;
  `docs/design/research/probe-tmux.md` §8 (5.3 MB per control client);
  `.meridian/work/tether-mvp/design/browser-auth.md` revision 3, §2 D6 and §5.
- Code: `contrib/tether.service`; `src/config.rs`; caps in `src/hub/mod.rs`
  (`MAX_CLIENTS`, `CAPTURE_SLOTS`), `src/http/ws.rs` (`MAX_CONNS`, `PASTE_SLOTS`),
  `src/http/complete.rs` (`IN_FLIGHT`), `src/fs/slots.rs`; `src/http/mod.rs` still
  calls `axum::serve`, so no connection cap exists today; `src/main.rs` exits 1 for
  every error. Web: `web/tabs/connection.ts` (`watchEnded` restarts the backoff at 0),
  `web/net/host.ts` (4005 takes the generic climbing backoff),
  `web/complete/suggest.ts`, `web/files/images.ts`.
- The ceiling arithmetic itemizes browser-auth revision 3's rows (it rounds each row up
  and gets ~64.3 MB unreclaimable with 3 control clients and ~59 with 2; itemized
  here, 63.8 and 58.5). Every per-cap cost comes from a row already in daemon-core §6,
  fs.md or complete.md; none is newly measured. R3 measures them.
- Unverified: the CPU cost of bursts (snapshot, index build, scan) under the quota;
  only the flood figure is measured. R5 and R6 measure them.
