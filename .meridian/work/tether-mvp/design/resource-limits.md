# Resource limits: a memory budget and a CPU cap (draft, revision 2)

Revision 2 applies [review 1](resource-limits-review-1.md) and aligns with
[browser-auth.md](browser-auth.md) revision 4, which moves the daemon onto a Unix socket.
How each finding was settled is in [Review disposition](#review-disposition), at the end.

## 1. Summary

One integer in `config.toml`, `memory_budget_mib` (default 72), sets the most memory
tether's unit may use. At startup the daemon takes the lower of it and the unit's
cgroup `memory.max`, then picks the row of a five-row tier table that fits. That row
fixes three counts: tmux sessions open at once, WebSockets, and whether completion
runs. A tighter budget means fewer things open at once, refused with a `limit` message,
never an OOM kill: each tier's unreclaimable ceiling at every cap, plus 4 MiB of
headroom, fits the lowest budget in its range. Below 42 MiB the daemon refuses to
start, because one tmux session, two sockets and the fixed protocol bounds don't fit
in less. Every figure in this spec is in MiB (2²⁰ bytes).

The default budget of 72 keeps **3 tmux sessions** (answering browser-auth D6), 3
sockets and completion. Its unreclaimable ceiling is 63.6 MiB against 72. The unit's
`MemoryMax` rises from today's 64M to 72M, and `MemoryHigh` is removed: set below the
ceiling, as today's 48M is, it stalls tether for up to seconds per allocation at caps.
The higher cap costs the box only tether's own 8 MiB: tmux, its sessions and their
processes run outside the unit, so the cap never bounds them. A budget of 64 drops to
2 sessions. A budget of 40 is refused; 42, the floor, yields 1 session, 2 sockets, no
completion, and a ceiling of 37.5 MiB.

The unit gains `CPUQuota=50%` with `CPUQuotaPeriodSec=10ms`: half a core, metered in
periods short enough that a keystroke arriving while the unit is throttled waits at
most one period, 10 ms. The daemon's heaviest sustained work, an output flood,
measured 2% of a core for the daemon process
([decisions.md "Batched pipe reads"](../../../../docs/design/decisions.md#batched-pipe-reads-for-control-clients));
the `tmux -C` relay in the same unit wasn't measured, and R5 measures the whole unit.

**The budget has a prerequisite.** Today nothing bounds HTTP connections that aren't
upgraded (`axum::serve`, hyper's default buffers), so no budget can promise "never an
OOM kill". The accept loop (64 connection permits, 16 KiB hyper buffers, §3.7) ships
with this change, ahead of the rest of browser auth (D6 below). On Linux the budget
also refuses uploads to a memory-backed filesystem, the one way a request could leave
unreclaimable memory behind outside the ceiling's rows (§3.1, "What has to fit").

On macOS there is no cgroup and no hard cap: the budget sizes the counts and nothing
enforces it.

### Vocabulary

| Term | Meaning |
|---|---|
| **memory budget** | `memory_budget_mib`: the most memory, in MiB, tether's unit may hold that the kernel can't reclaim. The unit's `MemoryMax` should equal it |
| **effective budget** | the lower of the memory budget and the cgroup limit read once at startup ([§6.1](#31-daemon-coremd-6-replacement)); what the tier is chosen from |
| **tier** | one row of the tier table: the caps for a range of effective budgets |
| **ceiling** | the sum of every memory row with every cap reached at once. The **unreclaimable ceiling** leaves out the clean file pages and reclaimable slab the kernel drops before it kills |
| **headroom** | 4 MiB kept between a tier's unreclaimable ceiling and the lowest budget in its range, for estimate error in rows that are targets, not measurements |
| **memory-backed filesystem** | tmpfs or ramfs. A file written there is `shmem`, charged to the writer's cgroup and unreclaimable without swap, for as long as the file exists |
| **`busy`** | a refusal that clears within a second or so; the client retries soon |
| **`limit`** (new) | `watchEnded { reason: "limit" }`: the control-client cap, which clears only when another session's tabs close or the budget is raised |

`tooManySessions` keeps its one meaning, the scratch-session cap. Today the
control-client cap's message also says "too many tmux sessions"; it becomes `limit`.
plan.md's "Resource budget" section keeps its name, since it covers CPU and idle
targets too. "Budget measurement" there is the measurement run, and it now checks the
memory budget.

## 2. Decisions for Jimmy

| # | Decision | Recommended | Alternatives |
|---|---|---|---|
| D1 | The setting | **`memory_budget_mib`, an integer in MiB, top-level in `config.toml`, default 72, at least 42.** Values above 72 behave as 72, since caps never exceed today's. MiB matches systemd's `M`, so `memory_budget_mib = 48` pairs with `MemoryMax=48M` | A suffixed string (`"48M"`): more parsing for no gain. A `[limits]` table: one key doesn't need one. Letting budgets above 72 raise caps past today's: untested configurations for a case nobody has asked for. A default of 64, 2 tmux sessions at once, keeping today's `MemoryMax=64M`: one fewer session for the user, to save 8 MiB that only tether can use, since tmux and its processes run outside the unit |
| D2 | How the budget and the unit agree | **Both: the daemon reads its cgroup limit at startup and uses the lower value, and running.md says to set `MemoryMax` to the budget. The unit sets no `MemoryHigh`.** Lowering `MemoryMax` then a restart tightens tether safely; raising it needs both. A `MemoryHigh` found below the budget less 4 MiB is logged as a warning. Every configuration error, a budget below the floor included, exits 78, and the unit's `RestartPreventExitStatus=78` stops a restart loop | `MemoryHigh` at three quarters of the budget (today's ratio): below every tier's unreclaimable ceiling, so at caps the kernel can't reclaim its way under it and sleeps each allocating task, up to 2 s per charge (`mm/memcontrol.c`); the 10 s reply timeout then kills control clients as crashed. `MemoryHigh` at the budget less 4 MiB: safe, but a second number to keep in sync, for page cache that `memory.max` reclaims anyway before it kills. Documentation only: one missed edit and the caps outgrow `MemoryMax`. No config key, budget = `MemoryMax`: contradicts the setting Jimmy chose, and a dev run would have no budget. Starting at the floor tier below 42: an OOM kill at caps |
| D3 | What goes first as the budget tightens | **The third tmux session goes below 72, the second below 64, the third socket below 58, and completion below 53.** Boundaries 58, 53 and 42 are the lowest whole MiB that fit; 72 and 64 keep systemd-round values with room for R3 to raise a row. A lost socket heals by itself: a stale one ages out within 25 s and the client's retry gets in. Lost completion stays lost until the budget rises | Completion before the third socket: keeps a browser tab and the phone connected together at 46–57, but no suggestion strip there. Halving completion's history and caches instead of turning it off: saves about 3.7 MiB, makes three of complete.md's constants depend on the budget, and changes ranking with the budget. Halving the capture, paste, raw and shell slots in the lower tiers (revision 1): saves 2.5 MiB for four more budget-dependent caps, a waiter-rebalancing rule and a cross-spec dependency in fs.md |
| D4 | Startup or live | **Startup only.** A `systemctl --user restart tether` applies a change and costs a reconnect, which tether is built to make cheap | Live: shrinking a cap that is in use needs a policy for what's already open, and resizing the hub's caps breaks its fixed-at-construction state. It buys nothing for a value set once per box |
| D5 | The CPU cap | **`CPUQuota=50%`, `CPUQuotaPeriodSec=10ms`** (reasons in §3.3) | `100%`: one core, which doesn't cap the blocking pool and the `tmux -C` clients, both of which can exceed a core together. `25%`: bursts take 4× as long, for a box-wide saving that matters only with several users at once. A 20 ms period: the quota is per cgroup across CPUs, so when the blocking pool drains it on several cores at once, a keystroke waits up to the rest of the period, nearly 20 ms, past one 60 Hz frame. The 100 ms default period: up to 100 ms |
| D6 | Ship the accept loop now | **Yes: the accept loop (§3.7: 64 connection permits, 16 KiB hyper buffers, 100 s header-read timeout) lands with the budget**, without the static shell or the rest of browser auth. Until browser auth lands it accepts on today's loopback TCP listener; browser auth swaps in the Unix socket. Without it, HTTP connections are unbounded and the ceiling isn't one | Wait for browser auth: the budget would claim a bound that doesn't hold until then |
| D7 | How a refusal reaches the client | **A new value, `limit`, in `watchEnded.reason`, whose message names the cap and the sessions holding it; and `welcome.daemon.completion: bool`, so a client never asks for completion the tier turned off.** The web shows the message and retries on a backoff that grows. No protocol bump: an older web reads any reason but `detached` as `error`, and ignores an unknown `welcome` field. A `/complete` that arrives anyway answers `200 {"chips": []}`. 4005 keeps meaning the socket cap | Reuse `error`: the web can't tell "retry in a second" from "won't clear until a tab closes", and retries a refused watch every 0.5 s forever, each retry a Locate one-shot spawning tmux. HTTP `503 {"error":"limit"}` from `/complete` (revision 1): a new error value, and per-connection suppression state in the client, for a fact fixed for the daemon's life |

D3's table, for reference (§3.1 has it in full):

| Effective budget, MiB | tmux sessions | sockets | completion | unreclaimable ceiling, MiB |
|---|---|---|---|---|
| **72 and up (default 72)** | **3** | **3** | **on** | **63.6** |
| 64–71 | 2 | 3 | on | 58.3 |
| 58–63 | 1 | 3 | on | 53.0 |
| 53–57 | 1 | 2 | on | 48.8 |
| 42–52 | 1 | 2 | off | 37.5 |
| below 42 | refuses to start | | | |

The arithmetic would admit 3 sessions from 68 and 2 from 63. The 72 and 64 boundaries
are kept until R3 measures the rows: a measurement that raises a row then moves no
boundary a user relies on.

**Found while checking the refusal paths, outside this spec's scope:** the web's tab
reducer (`web/tabs/connection.ts`) restarts its backoff at attempt 0 on every
`watchEnded { error }`, so a watch that fails the same way each time is retried every
0.5 s forever. The tmux-session cap is one way in; a control client that keeps crashing
is another. The client change in §3.6 fixes both: every refused watch climbs the
backoff.

## 3. Proposed text

Each block is written as the current rule, for the recommended answers above. Rows
and sentences marked † depend on browser auth (the static shell, whois, the Unix
socket); they drop out, or take today's value, if this lands first.

### 3.1 daemon-core.md §6 (replacement)

> ## 6. Limits and the memory ceiling
>
> Every daemon constant lives here, except the file API's, which are in
> [fs.md](fs.md#constants), and completion's, in [complete.md](complete.md#constants);
> other documents link to this table. Most are fixed. Three scale with the memory
> budget, and those come from the tier table below. Every memory figure is in MiB.
>
> ### 6.1 The memory budget
>
> `memory_budget_mib` in `config.toml` ([plan.md](plan.md#config)), default 72, is the
> most memory tether's unit may hold that the kernel can't reclaim. At startup `main`
> reads it, then the cgroup limit:
>
> 1. Find the cgroup2 mount in `/proc/self/mountinfo` (filesystem type `cgroup2`):
>    `/sys/fs/cgroup` on a unified host, `/sys/fs/cgroup/unified` on a hybrid one.
> 2. Take the path from the `0::` line of `/proc/self/cgroup`, relative to that
>    mount's root (mountinfo's fourth field).
> 3. Walk from that directory up to the mount point, reading `memory.max` and
>    `memory.high` at each level. The limit is the lowest `memory.max` that isn't
>    `max`.
> 4. A missing or unreadable file means no limit at that level. `memory.max` is absent
>    where the parent doesn't enable the memory controller and at the root. A missing
>    mount, `0::` line or unparsable file means no limit at all, with a warning naming
>    the file. Never refuse to start because `/proc` or `/sys` looks odd.
> 5. Floor the limit to whole MiB.
>
> The **effective budget** is the lower of the configured budget and that limit.
>
> - **Below 42 MiB:** the daemon logs `memory budget <n> MiB (config <c>, unit <u>) is
>   below the minimum of 42 MiB` and exits with status 78, as for every configuration
>   error ([plan.md](plan.md#resource-budget)).
> - **The limit below the configured budget:** a warning names both, and the limit
>   governs. The limit above the budget is logged at info: the budget governs.
> - **No limit found under systemd** (`INVOCATION_ID` is set): a warning, "no cgroup
>   memory limit is in force; the budget alone sizes the caps". This is the case on a
>   cgroup v1 or hybrid host, where the memory controller is v1 and a user unit's
>   `MemoryMax` isn't enforced, and on a host that doesn't delegate `memory` to the
>   user manager. Outside systemd (a dev run, macOS) no limit is expected and nothing
>   is logged.
> - **A `memory.high` below the effective budget less 4 MiB:** a warning, "MemoryHigh
>   <h> is below what tether may hold at its caps; remove it", since the unit would
>   stall at caps (`MemoryHigh` in [plan.md](plan.md#resource-budget)). It changes no
>   cap.
> - The startup log line names the effective budget, the tier, and its caps. The debug
>   endpoint reports them.
>
> The budget is read once. A change takes effect at the next start, including one made
> with `systemctl --user set-property`, which changes the cgroup at once but not the
> caps. `memory_budget_mib` is not written by the Settings sheet.
>
> **The tiers.** The effective budget picks one row. Each row's unreclaimable ceiling
> (§6.3) plus 4 MiB of headroom fits the lowest budget in its range, so no cap in the
> row can bring the unit to `MemoryMax`. Above 72 nothing more opens.
>
> | Effective budget, MiB | Control clients | Connections (sockets) | Completion |
> |---|---|---|---|
> | 72 and up (default) | 3 | 3 | on |
> | 64–71 | 2 | 3 | on |
> | 58–63 | 1 | 3 | on |
> | 53–57 | 1 | 2 | on |
> | 42–52 | 1 | 2 | off |
>
> **Why these scale and nothing else.** Each scaled cap is a count of things the user
> can see and name (sessions, connections, suggestions), and refusing one more costs a
> wait or a retry, never a wrong result. Every other limit stays fixed:
>
> - **Per-message and per-frame bounds** (inbound message, input and paste per
>   message, frame size, line length, reply bodies per group, tmux names): they are
>   protocol and security bounds, and a peer must not see them change with the host's
>   tuning.
> - **Per-connection credit, overdraft and the capture reservation:** a snapshot of the
>   largest clamped screen has to fit the reservation, and the reservation has to fit
>   the credit. Shrinking them would fail snapshots, not refuse them.
> - **Small slots** (capture 2, paste 4, raw responses 2, shell 4†) and **one-shots,
>   scans, uploads (1 each), watches per connection (2):** together they cost under
>   6 MiB at every tier, and halving them would save 2.5 MiB for four more
>   budget-dependent caps.
> - **The connection backstop (64) and hyper's buffers (16 KiB):** together 2.1 MiB.
>   The backstop has to stay above the sum of the routes' caps and waiters (§6.4), or a
>   native reconnect would queue behind a browser's page load.
> - **Blocking lanes and `TasksMax`:** they bound threads, not memory.
> - **Timeouts, deadlines and coalescing:** time, not memory.
> - **Completion's constants**, when completion is on: halving them would change
>   ranking with the budget. Completion is on or off.
>
> The tier table, the per-item costs in KiB, and a unit test that recomputes each
> row's ceiling and checks it against its range all live in `src/budget.rs`. `Caps`
> has three fields; the hub's `State`, the socket semaphore and `complete` take theirs
> once, at construction.
>
> ### 6.2 Limits
>
> | Limit | Value | When hit |
> |---|---|---|
> | connections, from the upgrade | tier table: 3 by default; browser tabs, the PWA and native all count | close 4005 |
> | connection permits, the backstop | 64, every accepted connection, upgraded ones included (§6.4) | stop accepting; the listen backlog holds newcomers: `somaxconn` on the Unix socket†, 128 on today's loopback TCP listener |
> | hyper buffer per connection | 16 KiB, read and write each | a larger request head: 431 |
> | header-read and idle timeout | 100 s | connection closed |
> | watches per connection | 2 | `watchEnded { error }` |
> | control clients | tier table: 3 by default, for every tmux server tether attaches to (a scratch server's included, when scratch shells land); lingering ones closed first | `watchEnded { limit }` naming the sessions that hold the slots |
> | control-client linger | 15 s | |
> | groups in flight per control client | 32; user requests below 24 | user: `busy`; maintenance waits |
> | capture slots (snapshot, history) | 2 daemon-wide | history: `busy`; snapshot waits |
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
> | paste slots (files awaiting tmux) | 4, daemon-wide | `error { busy }`, before writing |
> | completion: carapace, history, PATH, paths | [complete.md](complete.md#constants); off in the lowest tier | off: `welcome.daemon.completion` is `false`, and a `/complete` that arrives anyway answers `200 {"chips": []}`, building nothing |
> | history per request | 200 rows | clamped |
> | `hello` deadline | 10 s | close 4003 |
> | ping / idle timeout | every 10 s / 25 s silent | close 4000; the 10 s timer also re-checks auth (removed: 4401; unreadable file: 4503) |
> | size clamp | 20..=500 cols × 5..=300 rows | clamped |
> | `pause-after` | 3 s | `Gap` → snapshot |
> | scratch sessions | 2 | `error { tooManySessions }` |
> | whois calls† | 2 in flight daemon-wide, 16 waiting | the 17th: `503 busy` at once |
> | shell slots and waiters† | 4 and 16 | the 17th waiter: `503 busy` at once |
> | shell stall† | 30 s for the socket to take the next slice | aborted |
> | shell size† | 3 MiB embedded, 1.5 MiB per file, 128 files | the build fails |
>
> **A cap refusal says which kind it is.** `busy` clears within a second or so, and the
> client retries soon. `watchEnded { reason: "limit", message }` is the control-client
> cap, which clears only when another session's tabs close or the budget is raised.
> Its message names the cap and the sessions holding it: "tether on devbox allows 1
> tmux session at a time; open now: work". A lingering client doesn't hold a slot,
> since the next watch closes it, so once the user closes the named session's tabs on
> any device, the next attempt succeeds. The socket cap keeps its own close code, 4005.
>
> ### 6.3 The memory ceiling
>
> With every item at its cap at once, in MiB. Nothing grows with time. Measured rows
> (control client, one-shot, completion, slab) were recorded in MB and are taken here
> as MiB, which overstates them by 5%. The default column is the 72-and-up tier.
>
> | Item | Bound | Per cap | Default |
> |---|---|---|---|
> | daemon: code, runtime, tasks | budget target | | 5 |
> | one-shot `tmux` | 1 × 4.9 measured | | 4.9 |
> | tmux chunks, pump → hub | 128 × 16 KiB | | 2 |
> | file API, fixed part: a scan, an upload (2 MiB of dirty pages between flushes included), a listing page | [fs.md](fs.md#limits-and-the-memory-ceiling), with 16 KiB hyper buffers | | 3.5 |
> | HTTP connections not upgraded | (64 permits − sockets) × (16 KiB read + 16 KiB write buffer + ~4 KiB state) | | 2.1 |
> | kernel socket buffers, fixed part: an upload and a couple of JSON replies | 3 × 256 KiB | | 0.75 |
> | reply bodies, in the capture slots | 2 × 1 MiB | | 2 |
> | paste files on tmpfs (`shmem`) | 4 × 256 KiB | | 1 |
> | raw responses: a 64 KiB chunk and its channel, kernel buffers | 2 × 0.5 | | 1 |
> | shell slots: kernel buffers† | 4 × 256 KiB | | 1 |
> | whois†: an answer and its parse | 2 in flight × (64 KiB + parse) | | 0.2 |
> | control clients | 5.3 measured each | 5.3 | 15.9 |
> | sockets: payloads hub → socket (2 MiB credit + 64 KiB overdraft), the writer's copy of a frame (1 MiB), an inbound message and its decoded copy (1 MiB), kernel buffers (256 KiB) | each | 4.31 | 12.9 |
> | completion, on: indexes, caches, a carapace launch | [complete.md](complete.md#memory-cpu-and-threads), less the slab | | 11.3 |
> | **unreclaimable ceiling** | | | **63.6** |
> | completion's dentry and inode slab (reclaimable) | measured | | 2.4 |
> | embedded shell pages (clean, file-backed, reclaimable)† | at most the 3 MiB embedded | | 3 |
> | **ceiling** | | | **69.0** |
>
> By tier, the unreclaimable ceiling is 63.6 (72 and up), 58.3 (64–71), 53.0 (58–63),
> 48.8 (53–57) and 37.5 (42–52). Each plus the 4 MiB headroom fits the lowest budget in
> its range. Without the rows marked †, each is 1.2 lower.
>
> **What has to fit.** The rule is held on the unreclaimable ceiling: it plus the
> headroom must fit the effective budget, which is never above `MemoryMax`. The
> reclaimable rows can take the unit to `MemoryMax`, where the kernel reclaims clean
> file pages and reclaimable slab synchronously before it kills. The unit sets no
> `MemoryHigh`: below the unreclaimable ceiling, a soft limit can't be met by reclaim
> and turns into a sleep on every allocation instead.
>
> One write could leave unreclaimable memory outside these rows: an upload to a
> memory-backed filesystem (tmpfs, ramfs: `/tmp` on many distributions, `/dev/shm`,
> `$XDG_RUNTIME_DIR`), whose pages stay charged to the unit for as long as the file
> exists. The file API refuses such uploads
> ([fs.md](fs.md#errors), `memory_backed`). Paste files are the one deliberate tmpfs
> write, bounded by their row.
>
> The [budget measurement](plan.md#resource-budget) checks each tier at the bottom of
> its range: under load at every cap, sample the unit's `memory.stat` every 100 ms; the
> largest `anon + shmem + file_dirty + file_writeback + kernel + sock −
> slab_reclaimable`, divided by 2²⁰, must not exceed the row's computed unreclaimable
> ceiling, and `memory.events` must show no `oom_kill`. Record `memory.peak` beside it.
> If a measurement exceeds a row, the row's cost is raised in `src/budget.rs`, and the
> test moves the tier boundary. The `kernel` key needs Linux 5.18 or later; on older
> kernels replace `kernel − slab_reclaimable` with `kernel_stack + pagetables +
> percpu + slab_unreclaimable`. The tiers are claimed for the glibc build the unit runs
> (`%h/.cargo/bin/tether`); the musl release binaries are unmeasured.
>
> The normal case, one control client and one watch, is about 11 MiB, plus up to
> 14 MiB of completion state while Jimmy types and for five minutes after (the slab is
> the part the idle drop doesn't free).

§6.4 (the HTTP rule and the accept loop) is in §3.7 below.

### 3.2 plan.md "Config" (row added), "Resource budget" (replacement), "Server platform" (sentence added)

Config, one row after `port`:

> | `memory_budget_mib` | 72 | the most memory tether's unit may hold, in MiB, at least 42. It sets how many tmux sessions and sockets can be open at once, and whether completion runs ([daemon-core.md §6.1](daemon-core.md#61-the-memory-budget)). Read at startup. Keep the unit's `MemoryMax` equal to it ([running.md](../running.md#tune-the-resource-limits)) |

The sentence under the table, "With neither socket key…", stays.

Server platform, one sentence added: "On macOS the memory budget only sizes how many
things open at once; nothing caps tether's memory or CPU there."

Resource budget, replacing the section:

> ## Resource budget
>
> The dev server is already overloaded and crashes, and more than one user may run a
> tether there. Targets: daemon idle RSS under ~5 MB with no phone connected, about 0%
> CPU when nobody is connected, a hard cap on CPU and memory on Linux that the user can
> tighten, and no way to make the existing crashes worse. The caps rarely bind for one
> user; they exist for a crowded box. The MVP gate is meeting this budget, measured on
> the box with the debug endpoint (behind auth), which reports RSS, tasks, control
> clients, buffer use, and the effective memory budget and its caps.
>
> - **Event-driven:** control-mode events, no periodic capture, no `tmux ls` loop. With
>   no phone connected, tether holds no control clients and no pane state once the
>   control-client linger has passed.
> - **Nothing held for panes nobody views:** a pane's state exists only while a tab on
>   screen shows it, and unviewed panes are paused in tmux.
> - **Everything bounded, and sized by one setting:** every queue, buffer and cap, and
>   the resulting memory ceiling, is in
>   [daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling). Three counts
>   (tmux sessions, sockets, and whether completion runs) follow the memory budget,
>   `memory_budget_mib` in [Config](#config). A tighter budget opens fewer things at
>   once and refuses the next with a `limit` message. It never lets the ceiling reach
>   the unit's `MemoryMax`: the daemon reads that limit at startup, uses it if it is
>   lower, and refuses to start below 42 MiB.
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
>   a 53 MiB budget completion is off. Limits: [complete.md](complete.md#constants).
> - **No heavy server work:** HEIC conversion happens on the phone; videos stream as-is
>   over HTTP Range; no thumbnails, no transcoding, no file watcher.
> - **Crash safety:** tmux is the source of truth. If tether restarts, clients reconnect
>   and repaint from snapshots.
>
> **systemd user unit** (`contrib/tether.service`): `Type=notify`, `KillMode=mixed`,
> `Restart=on-failure` with a backoff (`RestartSec=2`, `RestartSteps=5`,
> `RestartMaxDelaySec=60`, `StartLimitIntervalSec=0`) and
> `RestartPreventExitStatus=78`, `MemoryMax=72M`, `CPUQuota=50%`,
> `CPUQuotaPeriodSec=10ms`, `CPUWeight=20`, `Nice=10`, `IOWeight=10`,
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
>   78 (`EX_CONFIG`) means tether's configuration is invalid: `config.toml` doesn't
>   parse or contradicts itself, `$HOME` can't be found, or the memory budget is below
>   the minimum. A restart can't fix any of them, so systemd doesn't try.
> - `MemoryMax` equals the default memory budget, 72M. The daemon reads it at startup
>   and never sizes its caps above it, so lowering `MemoryMax` and restarting is safe;
>   raising it needs `memory_budget_mib` raised too. `MemoryMax` covers the daemon, its
>   control clients and one-shots. tmux, the scratch server and carapace run outside
>   the unit: carapace in a transient scope with its own limits
>   ([complete.md](complete.md#where-carapace-runs-its-own-scope)). So the cap bounds
>   only tether's own memory, and the default leaves room for 3 tmux sessions at once.
> - There is no `MemoryHigh`. The daemon's caps keep what the kernel can't reclaim
>   under `MemoryMax`, and at `MemoryMax` the kernel reclaims page cache before it
>   kills. A `MemoryHigh` below what tether holds at its caps would make the kernel
>   sleep every allocating task in the unit, for up to 2 s per allocation, and the
>   control clients' 10 s reply timeout would then end watches. The daemon warns at
>   startup if one is set too low.
> - `CPUQuota=50%` holds the unit to half of one core. Sustained load is small (an
>   output flood measured 2% of a core for the daemon process), so the quota binds on
>   bursts: a snapshot, an index build, a directory scan, which it stretches by up to
>   double. The quota is per cgroup and spent across every CPU: when the blocking pool
>   and the `tmux -C` clients run on several cores at once, they can drain a period's
>   quota in a few milliseconds, and the unit then waits out the period. So a keystroke
>   that arrives while the unit is throttled waits at most one period, and
>   `CPUQuotaPeriodSec=10ms` keeps that inside one 60 Hz frame. `CPUWeight` and `Nice`
>   still make tether yield first under contention, below the quota.
> - `GLIBC_TUNABLES` pins glibc's mmap threshold at 128 KiB. glibc raises that threshold
>   after the first large free, so completion's indexes would land in the heap and stay
>   resident after its idle drop; pinned, each is its own mapping and goes back to the
>   kernel on free, with no `unsafe` call ([complete.md](complete.md#memory-cpu-and-threads)).
>   It affects only the glibc build, the one `cargo install` makes and the unit runs. The
>   Linux release binaries are static musl, which ignore it; musl's behaviour is
>   unmeasured, and the memory ceiling is claimed for the glibc build.
> - `TasksMax` counts threads and processes in the cgroup: the runtime thread, the 8
>   blocking threads (`max_blocking_threads`, since tokio's default is 512), 3 control
>   clients, a one-shot and a `systemd-run`, about 14, well under 32. A carapace run (a
>   Go binary starts several threads) counts only as `systemd-run` until it moves into
>   its own scope.
> - The memory and CPU limits take effect only where the user manager has the `memory`
>   and `cpu` controllers delegated through cgroup v2; without `cpu`, `CPUQuota` and
>   `CPUWeight` do nothing, silently, and without `memory` (or on a cgroup v1 or hybrid
>   host) `MemoryMax` isn't enforced, which the daemon reports at startup. The budget
>   measurement checks both.

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
# 78: tether's configuration is invalid (config.toml, $HOME, or a memory budget below
# 42 MiB). A restart can't fix it.
RestartPreventExitStatus=78

# MemoryMax is the memory budget: keep it equal to memory_budget_mib in config.toml
# (default 72). tether reads it at startup and sizes what it opens at once to the
# lower of the two. Don't add MemoryHigh: below what tether holds at its caps, it
# stalls tether instead of slowing it.
MemoryMax=72M
# glibc raises its mmap threshold after the first large free, so later completion
# indexes would come from the heap and stay resident after the idle drop. Pinned,
# every allocation over 128 KiB is its own mapping, returned on free (complete.md).
Environment=GLIBC_TUNABLES=glibc.malloc.mmap_threshold=131072
# Half a core at most, metered every 10 ms, so a keystroke waits at most 10 ms when
# tether is throttled. Sustained load is small; only bursts reach the cap.
CPUQuota=50%
CPUQuotaPeriodSec=10ms
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
([Tune the resource limits](#tune-the-resource-limits)), …". After the install steps,
one paragraph:

> **Upgrading from a unit with `MemoryMax=64M`.** Copy `contrib/tether.service` again
> (or edit yours to `MemoryMax=72M` and delete its `MemoryHigh` line), then
> `systemctl --user daemon-reload` and restart. A unit left at 64M runs 2 tmux
> sessions at once instead of 3, and its `MemoryHigh=48M` can stall tether at caps;
> the journal warns about both at startup.

A new section after "Run it under systemd":

> ## Tune the resource limits
>
> On Linux, tether is capped at half a CPU core and 72 MiB of memory. For one user the
> caps rarely bind. Tighten them on a crowded box, or when several users each run their
> own tether. macOS has no cap: the budget there only sets how many things open at
> once.
>
> **Memory** is set in two places that must agree: `memory_budget_mib` in
> `config.toml` and the unit's `MemoryMax`. tether sizes what it opens at once to the
> budget, so a tighter budget means fewer things open, never an out-of-memory kill:
>
> | Budget, MiB | tmux sessions at once | Connections | Suggestion strip |
> |---|---|---|---|
> | 72 and up (default 72) | 3 | 3 | on |
> | 64–71 | 2 | 3 | on |
> | 58–63 | 1 | 3 | on |
> | 53–57 | 1 | 2 | on |
> | 42–52 | 1 | 2 | off |
>
> "tmux sessions" counts sessions with a window open in a tab, on any device; tabs from
> one session share it. "Connections" counts the app and browser tabs connected at
> once, per host. 42 is the minimum.
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
> ```
>
> Don't set `MemoryHigh`: below what tether holds at its caps, it stalls tether for
> seconds at a time. Then set the budget in `config.toml` and restart:
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
> `memory_budget_mib`, so lowering `MemoryMax` alone is safe once tether restarts.
> `systemctl --user set-property tether MemoryMax=…` changes the limit at once but not
> tether's caps, so restart after it too. Raising the limit takes both settings. Below
> 42 MiB tether refuses to start and says so in the journal.
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
> 10 ms (`CPUQuotaPeriodSec`), so a keystroke waits at most 10 ms however tight the
> quota. `CPUWeight=20` and `Nice=10` already make tether give way to everything else
> when the box is busy; the quota caps it even when the box is idle.
>
> Check what's in force:
>
> ```bash
> systemctl --user show tether -p MemoryMax -p MemoryHigh -p CPUQuotaPerSecUSec -p CPUQuotaPeriodUSec
> cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/cgroup.controllers
> ```
>
> `MemoryHigh` should be `infinity`. The second line must list `cpu` and `memory`. If
> `cpu` is missing, your distribution doesn't delegate it to user units, and
> `CPUQuota` and `CPUWeight` do nothing; if `memory` is missing, `MemoryMax` isn't
> enforced. `systemctl edit user@.service` with `Delegate=cpu cpuset io memory pids`
> (as root) turns them on. If `/sys/fs/cgroup/user.slice` doesn't exist, the host
> runs cgroup v1 or a hybrid layout, where user units get neither cap.

"When something fails", rows added:

> | tether exits at start and systemd doesn't restart it | tether's configuration is invalid: the journal names the cause (`config.toml` line, `$HOME`, or "memory budget … is below the minimum of 42 MiB"). Fix it and start tether again |
> | the journal says "no cgroup memory limit is in force" | the unit's `MemoryMax` isn't enforced: `memory` isn't delegated to user units, or the host runs cgroup v1. See "Check what's in force" |
> | the journal says "MemoryHigh … is below what tether may hold at its caps" | delete `MemoryHigh` from the unit (`systemctl --user edit tether`, or copy `contrib/tether.service` again) and restart |
> | a tab says "Session limit" | tabs on this host already hold windows from as many tmux sessions as the memory budget allows; the message names them. Close those tabs, on any device, and tap to retry, or raise the budget |
> | "Too many connections to <host>" | the app and browser tabs on this host fill its connections. It retries by itself; a connection left over from a network change clears within 25 s |
> | no suggestion strip, and the journal's startup line says completion is off | the memory budget is below 53 MiB |
> | an upload fails with "can't upload to a memory-backed folder" | the destination is on tmpfs or ramfs (often `/tmp`), where the file would count against tether's memory for as long as it exists. Upload to a folder on disk |

### 3.5 What the user sees when a cap binds

The iOS app and a browser run the same web UI and the same `HostLink`, so each refusal
looks the same on both. Native screens (host list, Add host) use only the auth
routes, which nothing here scales, so they show nothing new.

| Cap | Wire | Web UI, in the app or a browser |
|---|---|---|
| tmux sessions (control clients) | `watchEnded { reason: "limit", message }` | the tab's pill: "Session limit". Detail: the message ("tether on devbox allows 1 tmux session at a time; open now: work"); hint: "Close the tabs showing those sessions, on any device, then tap to retry". The tab retries on the climbing backoff (0.5 s … 30 s); a tap retries now. Switching one device between sessions works: at the cap the lingering client for the old session closes first |
| connections (sockets) | close 4005 | host status "Too many connections to <host>", with the usual retry countdown (the host backoff already climbs) |
| completion off | `welcome.daemon.completion: false` | the suggester never asks that host. The first time the user types on a connection, the strip shows one muted line, "Suggestions off on <host>", then nothing |
| paste slots | `error { busy }` (unchanged) | the existing paste refusal |
| capture slots | snapshot waits; history `busy` (unchanged) | a scrollback fetch retries as today |
| raw responses | waits on the fs lane; `503 busy` past 8 waiters (unchanged) | "<host> is busy" only past the waiters, as today |
| an upload to a memory-backed filesystem | `409 {"error":"memory_backed"}` | the upload's error: "Can't upload to a memory-backed folder (tmpfs). Choose a folder on disk" |
| shell slots† | waits; `503 busy` past the waiters | the browser's own load retry; a service-worker update fails whole and retries at the next check |

### 3.6 Other spec lines this touches

Short edits, for the build to carry in the same commits:

- **daemon-core §4.5:** "the window's watches end with `watchEnded { limit }` (the
  control-client cap, from the tier table), whose message names the sessions holding
  the cap, and the window is dropped".
- **daemon-core §5.2–5.3:** `watchEnded.reason` is `detached | error | limit`;
  `welcome.daemon` (`DaemonInfo`) gains `completion: bool`. No version bump: an older
  web reads any reason but `detached` as `error` and ignores the new field.
- **daemon-core §7:** "user requests at the threshold → `busy`" gains a row: "the
  control-client cap → `watchEnded { limit }`; the socket cap → 4005".
- **daemon-core §6.4, new:** the HTTP rule and the accept loop, §3.7 below. They move
  here from browser auth so they land with the budget (D6); browser auth then adds the
  shell and whois rows and the Unix socket.
- **`src/main.rs`:** every `ConfigError` and a budget below the floor exit 78; other
  errors keep exit 1.
- **fs.md "Errors":** a row, `409 memory_backed`: "an upload whose destination
  directory is on tmpfs or ramfs (`statfs` `f_type` `TMPFS_MAGIC` or `RAMFS_MAGIC`,
  Linux only); its pages would stay charged to tether's unit, unreclaimable, for as
  long as the file exists". The check runs on the destination directory's descriptor
  before the `.part` file is created. "Limits and the memory ceiling": its paragraph on
  page cache says clean pages push the unit toward `MemoryMax`, where the kernel
  reclaims them first (there is no `MemoryHigh`), and its table's hyper buffers are
  16 KiB, not ~400 KiB. No `fs.md` constant depends on the budget.
- **complete.md "Constants":** a first row, "completion: on at a memory budget of 53
  MiB and up. Off below: nothing is built, `welcome.daemon.completion` is `false`, and
  a request answers `200 {"chips": []}`". Its note on "a unit whose ceiling already
  reaches its 64 MB `MemoryMax`" now reads against the 72 MiB default.
- **The web client** (its spec under `docs/design/client/`): a `watchEnded` with reason
  `limit` or `error` is a failed attempt, so the backoff climbs from the tab's attempt
  count instead of restarting at 0.5 s. A `limit` shows its message. The suggester
  reads `welcome.daemon.completion` and never asks a host that says `false`. 4005 shows
  "Too many connections". `409 memory_backed` shows its upload error.
- **browser-auth.md, revision 4:** D6 is answered here: keep 3 control clients, since
  the default budget of 72 yields 3. The whois and shell rows it adds are already in
  §3.1 above, marked †, and its Unix-socket listener in §3.7. Gate G12's pass formula
  matches R3's.
- **`CHANGELOG.md` `[Unreleased]`:** "tether now has a memory budget,
  `memory_budget_mib` (default 72 MiB), and a CPU cap of half a core. Copy
  `contrib/tether.service` again: it raises `MemoryMax` to 72M, removes `MemoryHigh`,
  and adds `CPUQuota`. A tab at the tmux-session cap now says which sessions hold it.
  A typo in `config.toml` no longer restarts tether every minute."

### 3.7 daemon-core.md §6.4 HTTP connections (new)

> ### 6.4 HTTP connections
>
> **One rule bounds HTTP.** Each route caps its own concurrency and, when its
> waiters are full, answers at once: `503 busy` with `Retry-After: 1`, or 4005 for a
> socket. Waiters are bounded by count, never by a timer, except on the auth lane,
> whose waiters give up after its 10 s wait. A connection cap sits behind them as a
> backstop, sized above their sum so that ordinary bursts never reach it, and the
> native app's reconnect never queues behind a browser's page load.
>
> | Route | Served at once | Waiting | When full |
> |---|---|---|---|
> | `/ws` | tier table: 3 sockets by default | — | close 4005 |
> | file API | 1 scan, 2 raw, 1 upload | 8 on the fs lane | `503 busy` at once |
> | `/complete` | 4 | — | `503 busy` at once |
> | node-lane identity (whois)† | 2 calls | 16 | `503 busy` at once |
> | shell† | 4 slots | 16, in arrival order, no deadline | `503 busy` at once |
> | auth routes, and each device route's credential read | the auth lane's 2 threads | a handful; a read takes milliseconds | `503 busy` after the lane's 10 s wait |
>
> Those caps add up to about 60 connections with the auth lane's handful and the idle
> connections tailscaled keeps pooled to the daemon: at most 2, held for 90 s (Go's
> default `MaxIdleConnsPerHost`, which Serve doesn't change; `IdleConnTimeout: 90 *
> time.Second` in its proxy transport). The backstop is **64 connections**, so
> reaching it means a flood, and a flood only denies service.
>
> **The accept loop.** `http::serve` owns its accept loop rather than calling
> `axum::serve`. A `Listener` wrapper could cap connections alone, but the memory
> bound needs hyper's buffer size, and axum 0.8.9 builds each connection with
> hyper's defaults and no hook (`serve/mod.rs`). At the default (8 KiB + 400 KiB per
> buffer), 61 connections could hold about 25 MiB. The loop:
>
> - accepts on the daemon's Unix socket, `$XDG_RUNTIME_DIR/tether/http.sock`
>   ([auth.md](auth.md#tailscale-identity-and-tailscaled-peers))†. Until browser auth
>   lands, it accepts on today's loopback TCP listener;
> - takes one of the **64 connection permits** before each `accept`. With none free it
>   stops accepting, and the kernel's listen backlog holds newcomers: `somaxconn` on
>   the Unix socket (mio passes −1), where only tailscaled and Jimmy's own processes can
>   queue†; 128 on the TCP listener. The permit lives inside the connection's I/O
>   wrapper, so it moves into an upgraded socket and is freed only when the socket
>   closes. The wrapper forwards `poll_write_vectored` and `is_write_vectored`, so
>   hyper keeps queueing body `Bytes` instead of copying them into its write buffer;
> - sizes each socket's kernel buffers with `small_buffers`, on the Unix stream as on
>   TCP;
> - reads the peer once per accepted connection and inserts it into every request's
>   extensions before the router: the `SO_PEERCRED` peer class (tailscaled peer or
>   local peer)† on the Unix socket, `ConnectInfo<SocketAddr>` on TCP;
> - serves the connection with hyper's `http1::Builder`. The daemon has only ever
>   spoken HTTP/1.1 (axum's `http1` feature), and tailscaled proxies plain-HTTP
>   backends over HTTP/1.1. The builder gets a tokio timer, **`max_buf_size` of
>   16 KiB** (it bounds the read and the write buffer alike, and a request head that
>   doesn't fit is answered 431), a **100 s header-read timeout**, and
>   `with_upgrades()` for `/ws`.
>
> The header-read timeout also closes idle keep-alive connections, since hyper arms
> it at every request head. 100 s is above tailscaled's 90 s idle timeout, so
> tailscaled always closes an idle connection first and never sends a request on one
> the daemon is closing. Go doesn't retry a POST on such a connection, so a shorter
> timeout would turn a rare enrolment or upload into a 502. tailscaled forwards
> complete heads at once, so a slow sender can only be a local process, and the
> permits bound how many such connections there can be.
>
> **Shutdown.** Each connection task lives in a `JoinSet` and runs `tokio::select!`
> between the connection future and a shutdown `watch` receiver. On the signal it calls
> `UpgradeableConnection::graceful_shutdown()` and keeps polling the connection, as
> axum's own `serve` does; hyper-util's `GracefulShutdown` has no impl for the `http1`
> upgradeable connection. The loop stops accepting and sets `stop` (every socket
> closes with 4004, as today). At the 2 s deadline it aborts every connection task
> still in the `JoinSet`, so a stalled raw response is closed instead of outliving
> `serve`. It then waits for the upgraded sockets' slots until the same deadline, as
> today. axum spawns upgraded sockets outside the `JoinSet`, so one that misses the
> deadline still holds a `Ctx`, and `main` keeps calling `HubHandle::stop`.

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
> - **What:** `memory_budget_mib` (default 72, at least 42) bounds the memory tether's
>   unit holds that the kernel can't reclaim. At startup the daemon takes the lower of
>   it and the lowest cgroup v2 `memory.max` from its cgroup up, and picks one of five
>   tiers. Each tier's unreclaimable ceiling plus 4 MiB fits the lowest budget in its
>   range. Three counts scale: the third tmux session goes below 72, the second below
>   64, the third socket below 58, and completion below 53; every other
>   cap is fixed. The default yields 3 tmux sessions, 3 sockets and completion, with an
>   unreclaimable ceiling of 63.6 MiB against 72; the unit's `MemoryMax` rises from 64M
>   to 72M, and its `MemoryHigh` is removed. The control-client cap refuses with
>   `watchEnded { limit }` naming the sessions that hold it; completion off is
>   `welcome.daemon.completion: false`; the socket cap keeps 4005. Uploads to tmpfs or
>   ramfs are refused. Every configuration error, a budget below 42 included, exits 78,
>   and the unit's `RestartPreventExitStatus=78` keeps it down. Read at startup only.
>   The accept loop (64 connection permits, 16 KiB hyper buffers) ships with this
>   change, because without it HTTP connections are unbounded and no budget is a bound.
> - **Why:** the dev box is shared and overloaded, and several users may each run a
>   tether. One number is all a user should have to choose; the daemon knows its own
>   costs. Reading the unit's limit makes lowering `MemoryMax` (then restarting) safe,
>   so the setting and the unit can't drift into an OOM kill. Tiers instead of a
>   formula keep each configuration few enough to measure on the box, and scaling only
>   counts the user can see and name keeps the refusals explainable. A lost socket
>   heals itself within 25 s (the stale one ages out), so it goes before
>   completion, which stays lost. The default keeps 3 tmux sessions because the unit's
>   cap bounds only tether: tmux, its sessions and their processes run outside the
>   unit, so a higher cap costs only tether's ceiling, 8 MiB more at most. `MemoryHigh`
>   goes because a soft limit below the unreclaimable ceiling can't be met by reclaim:
>   the kernel sleeps each allocating task, up to 2 s per charge, and the 10 s reply
>   timeout then ends watches as crashes. A tmpfs upload is the one write whose pages
>   stay charged to the unit after the request ends. Fixed bounds stay fixed:
>   per-message and per-frame bounds are protocol and security limits a peer must not
>   see change; credit and the capture reservation must hold the largest snapshot; the
>   connection backstop must stay above the routes' sum.
> - **Rejected:** documentation only (one missed edit and the caps outgrow
>   `MemoryMax`); a check without documentation (the user wouldn't know what to set);
>   the budget taken from `MemoryMax` with no config key (contradicts Jimmy's setting;
>   no budget in a dev run); starting at the floor tier under 42 MiB (an OOM kill at
>   caps); a solver over every cap (configurations nobody has measured); budgets above
>   72 raising caps past today's; `MemoryHigh` at three quarters of the budget
>   (seconds-long stalls at caps); `MemoryHigh` at the budget less 4 MiB (a second
>   number to keep in sync, for page cache `memory.max` reclaims anyway); halving the
>   capture, paste, raw and shell slots in the lower tiers (2.5 MiB, for four more
>   budget-dependent caps and a cross-spec dependency); halving completion's history
>   and caches instead of turning it off (three constants depend on the budget and
>   ranking changes with it, for 3.7 MiB); completion before the third socket (no strip
>   at 46–57); reloading the budget live (a policy for shrinking caps in use, for a
>   value set once); reusing `error` for the session cap (the web couldn't tell a
>   one-second wait from one that needs a tab closed, and retried a refused watch every
>   0.5 s); HTTP `503 limit` for completion off (a new error value and client state
>   for a fact fixed for the daemon's life); naming the device in the session-limit
>   message (the hub doesn't know devices, and the session name is enough to act on);
>   a "slot freed" broadcast to refused tabs (a tap already succeeds at once, since the
>   closed tab's client only lingers); capping uploads to tmpfs at a size the headroom
>   absorbs (an upload size that depends on the destination, for a destination nobody
>   needs); a default of 64 with 2 tmux sessions at once (one fewer session, to save
>   8 MiB of tether's own memory); 3 tmux sessions at a budget of 64 (no headroom).
>
> ### The unit caps CPU at half a core, metered every 10 ms
>
> - **Decided:** 2026-10-23, Jimmy (a hard cap), design (the value).
> - **What:** `CPUQuota=50%`, `CPUQuotaPeriodSec=10ms`, beside the existing
>   `CPUWeight=20` and `Nice=10`.
> - **Why:** `CPUWeight` and `Nice` make tether yield under contention but cap nothing.
>   Sustained load is small (an output flood measured 2% of a core for the daemon
>   process, Batched pipe reads), so half a core binds on bursts (a snapshot, an index
>   build, a directory scan) and stretches them by up to double. The quota is per
>   cgroup and spent across CPUs, so when the blocking pool and the `tmux -C` clients
>   drain it on several cores at once, the unit waits out the rest of the period. A
>   throttled keystroke therefore waits up to one period; 10 ms keeps that inside one
>   60 Hz frame.
> - **Rejected:** 100% (doesn't cap the blocking pool and tmux clients, which together
>   can exceed a core); 25% (bursts 4× longer, for a saving that matters only with
>   several users at once, who can set it); a 20 ms period (keystroke waits up to
>   20 ms when several threads drain the quota); the 100 ms default period (up to
>   100 ms).

## 5. Probe gates

Run on the dev box under a second, probe-only unit, never the live `tether.service`:
`systemd-run --user --unit tether-probe -p MemoryMax=… -p CPUQuota=50%
-p CPUQuotaPeriodSec=10ms -p Restart=on-failure -p RestartSec=2
-p RestartPreventExitStatus=78 … tether serve --config <probe config>`, on its own
socket or port, against a scratch tmux server (`-L tether-probe`). Run the glibc build
the unit runs (`cargo install`); a musl run is optional and recorded separately. Record
every number in the build's decisions entry, in MiB.

| Gate | Setup | Pass |
|---|---|---|
| R1 controllers | Read `cgroup.controllers` of the user manager's cgroup and the probe unit's; `systemctl --user show tether-probe` for the limits | `cpu`, `memory` and `pids` delegated; `MemoryMax`, `CPUQuotaPerSecUSec=500ms` and `CPUQuotaPeriodUSec=10ms` as set; `MemoryHigh=infinity`. If `cpu` is missing, the CPU gates can't pass and running.md's delegation note is the fix |
| R2 startup check | Start the probe with (config, `MemoryMax`) = (unset, 72M), (unset, 64M), (72, 48M), (48, 72M), (72, infinity), (72, outside systemd), (72, 40M), (40, 72M); then (unset, 72M) with `-p MemoryHigh=48M`; then a `config.toml` that doesn't parse; then a control case that exits 1 (the socket path or port already in use) | The log names the effective budget and tier: 72 / tier 72 and up; 64 / tier 64–71 with a warning naming both (a unit left at today's `MemoryMax`); 48 / tier 42–52 with a warning; 48, info; 72 with "no cgroup memory limit is in force"; 72 and no warning. The two below 42 and the parse error exit 78, and `systemctl --user status` shows no restart after 2 minutes. The `MemoryHigh` case logs its warning. The control case restarts on the backoff |
| R3 ceiling per tier | For each tier at the bottom of its range (72, 64, 58, 53, 42): every cap held at once, as browser-auth G12 does it (the tier's control clients, each socket with 2 watches flooding through readers throttled to 64 kbit/s, raw streams, an upload, 4 pastes, completion warm on a 1 MiB history and a 5,000-entry listing, a carapace run, two browsers' cold load†, a burst of node-lane requests filling the whois waiters†, a 64-connection flood); sample `memory.stat` every 100 ms for 2 minutes, and type in a watched pane every 200 ms throughout | The largest `anon + shmem + file_dirty + file_writeback + kernel + sock − slab_reclaimable`, in MiB, is at most the row's computed unreclaimable ceiling (63.6, 58.3, 53.0, 48.8, 37.5); `memory.events` shows `oom_kill 0`; no `watchEnded` and no reply-timeout kill in the log; keystroke echo p99 within R5's bound. Record `memory.peak`, the largest sample, and `memory.events high` (expected 0, with no `MemoryHigh`) |
| R4 refusals | At each cap, one more: a watch in another tmux session, a fourth (or third) socket, a third paste, an upload into a tmpfs directory; and a connection in the 42 tier | `watchEnded { limit }` whose message names the holding sessions, and the tab's retries climb: at most 8 Locate one-shots in 60 s, counted from the probe's log; after the holding tab closes, a tap succeeds at once. 4005 and the "Too many connections" status. `error { busy }`. `409 memory_backed` before any `.part` file exists. In the 42 tier, `welcome.daemon.completion` is `false` and no `/complete` request goes out while typing |
| R5 CPU idle and flood | Idle with no phone for 10 minutes; then a numbered-line flood in a watched pane, phone on Wi-Fi, for 60 s; read the unit's `cpu.stat` before and after each | Idle: `usage_usec` grows under 0.1% of a core. Flood: the whole unit (daemon and `tmux -C`) under 10% of a core and `nr_throttled` unchanged; keystroke echo p99 within 16 ms (one 60 Hz frame, the device checklist's latency bound in ios-shell.md), the same as with no quota |
| R6 CPU bursts | Three sockets flooding at once, plus the first completion on a cold 1 MiB history, a 5,000-entry listing and a 500 × 300 snapshot, run concurrently and repeated 10 times; then the same with `CPUQuota=25%` | Record `nr_throttled`, `throttled_usec`, and the time each burst takes against the unthrottled run. Pass: echo p99 within 26 ms (one frame plus one 10 ms period) at 50% and at 25%; no watch ends and no reply timeout fires at 25% |

## Sources

- Read: `docs/design/daemon-core.md` §4.5, §5.2–5.3, §6, §7; `docs/design/plan.md`
  "Config", "Resource budget"; `docs/design/fs.md` "Constants", "Errors", "Limits and
  the memory ceiling"; `docs/design/complete.md` "Request and response", "Constants",
  "Where carapace runs", "Memory, CPU and threads"; `docs/design/decisions.md`
  "Batched pipe reads for control clients" (the 2% flood figure) and its entry format;
  `docs/design/research/probe-tmux.md` §8 (5.3 MB per control client);
  `.meridian/work/tether-mvp/design/browser-auth.md` revision 4 (D1, §3.3–3.5, §5
  "daemon-core.md" and "resource-limits.md", G12) and revision 3's "One rule bounds
  HTTP" and "The accept loop" (commit `07c4357`), from which §3.7 is carried.
- [Review 1](resource-limits-review-1.md): the `memory.high` throttle formula (Linux
  v6.8 `mm/memcontrol.c`, `MEMCG_MAX_HIGH_DELAY_JIFFIES`), mio's TCP backlog of 128,
  the `memory.stat` fields per row, and `src/main.rs` exiting 1 for every error.
- Code: `contrib/tether.service`; `src/config.rs` (`ConfigError`); caps in
  `src/hub/mod.rs` (`MAX_CLIENTS`, `CAPTURE_SLOTS`), `src/http/ws.rs` (`MAX_CONNS`,
  `PASTE_SLOTS`), `src/http/complete.rs` (`IN_FLIGHT`), `src/fs/slots.rs`;
  `src/proto/messages.rs` (`DaemonInfo` holds only `version`); `src/http/mod.rs` still
  calls `axum::serve`, so no connection cap exists today. The hub holds no device
  identity. Web: `web/tabs/connection.ts` (`watchEnded` restarts the backoff at 0),
  `web/net/host.ts` (4005 takes the generic climbing backoff),
  `web/complete/suggest.ts`, `web/files/images.ts`.
- The ceiling arithmetic: every per-cap cost comes from a row already in daemon-core
  §6, fs.md, complete.md or browser-auth revision 4 (whois); none is newly measured.
  R3 measures them.
- Unverified: the CPU cost of bursts under the quota, and the per-CPU slice behaviour
  of a 5 ms quota in a 10 ms period (R6 measures both); the kernel memory of
  Unix-stream socket buffers against the 256 KiB rows, which were reasoned for TCP
  (R3 measures it, since `kernel` and `sock` are both in the formula); whether the dev
  box's `/tmp` is tmpfs (the refusal holds regardless).

## Review disposition

### Review 1

| Finding | Disposition | Where |
|---|---|---|
| H1 `MemoryHigh` at ¾ budget stalls at caps | **Fixed: dropped.** A soft limit at budget − 4 MiB would be safe, but it is a second number to keep in sync, and `memory.max` reclaims page cache before it kills anyway. The daemon warns when a `memory.high` sits below budget − 4 MiB, which catches a stale install. R3 now checks no `watchEnded`, no reply-timeout kill and echo p99 at caps. `TasksMax` checked by the same class: about 14 of 32 | §1, D2, §3.1 §6.1 and §6.3, §3.2, §3.3, §3.4, R1–R3, decisions |
| M1 tmpfs uploads | **Fixed:** fs refuses an upload whose destination's `statfs` type is tmpfs or ramfs, `409 memory_backed`; "What has to fit" names it | §1, §3.1 §6.3, §3.4, §3.5, §3.6, R4 |
| M2 pass formula and units | **Fixed:** the formula adds `shmem`, `file_dirty`, `file_writeback`, with a pre-5.18 fallback; every figure is MiB, measured MB rows taken as MiB (safe side) | §3.1 §6.3, R3 |
| M3 CPU wait bound | **Fixed: shortened the period** to 10 ms, so the honest bound (one period) is 10 ms and R6's 26 ms stands. D5's 100% rejection reworded; the 2% figure is labelled the daemon process's, and R5 measures the whole unit | §1, D5, §3.2, §3.3, §3.4, R5, R6, decisions |
| M4 cgroup read | **Fixed:** the five-step algorithm (mountinfo, `0::`, walk, missing = no limit, floor to MiB); the `INVOCATION_ID` warning covers v1, hybrid and undelegated hosts; restart after `set-property`; macOS has no cap, stated in plan.md and running.md | §1, §3.1 §6.1, §3.2, §3.4, R2 |
| M5 exit 78 for one cause | **Fixed:** 78 means `EX_CONFIG`, every `ConfigError` and a budget below the floor | D2, §3.1 §6.1, §3.2, §3.3, §3.6, R2 |
| M6 session-limit message | **Fixed:** the message names the sessions holding the cap. Naming the device and a "slot freed" nudge are rejected: the hub has no device identity, and a tap succeeds at once because the closed tab's client only lingers | §3.1 §6.2, §3.4, §3.5, R4, decisions |
| S1 small-slot halving | **Adopted:** three scaled caps; tiers 72, 64, 58, 53, 42; floor 42. 72 and 64 kept as boundaries though the arithmetic admits 68 and 63 | §1, D1, D3, §3.1, §3.4, decisions |
| S2 completion flag in `welcome` | **Adopted:** `welcome.daemon.completion`; a stray `/complete` answers `200` with no chips; `limit` lives only in `watchEnded` | D7, §3.1 §6.2, §3.5, §3.6, R4 |
| L1 MB and MiB mixed | **Fixed:** MiB throughout, KiB in `src/budget.rs`, `memory.stat` / 2²⁰ | §1, §3.1 |
| L2 backlog 128, not 32 | **Fixed** with rev 4: `somaxconn` on the Unix socket, 128 on today's TCP listener | §3.1 §6.2, §3.7 |
| L3 R2 needs `Restart=on-failure` | **Fixed:** `-p Restart=on-failure -p RestartSec=2`, and an exit-1 control case | R2 |
| L4 glibc measurements | **Fixed:** tiers claimed for the glibc build; R3 names it; a musl run optional | §3.1 §6.3, §3.2, §5 |
| L5 no CHANGELOG or upgrade note | **Fixed:** an `[Unreleased]` bullet and an upgrade paragraph in running.md | §3.4, §3.6 |
| L6 scratch control clients | **Fixed:** they count against the control-client cap when scratch shells land | §3.1 §6.2 |

### Browser auth revision 4 ([notes](browser-auth-rev4-notes.md))

| Stale line | Disposition |
|---|---|
| backlog of 32 | the listen backlog: `somaxconn` on the Unix socket†, 128 on TCP until then |
| shell stall and 60 s response deadline | "shell stall† — 30 s"; no whole-response deadline |
| R3 pass rule | `anon + shmem + file_dirty + file_writeback + kernel + sock − slab_reclaimable`, in MiB |
| no whois ceiling row | whois†: 2 × (64 KiB + parse), 0.2 MiB, every tier; the default ceiling is 63.6 MiB with it |
| units | MiB throughout |
| no whois route cap | §6.2 row and §6.4 route table: 2 in flight, 16 waiting, the 17th `503 busy` |
| accept loop on `TcpListener`, `ConnectInfo`, hyper-util `GracefulShutdown` | §3.7: the Unix socket† with the `SO_PEERCRED` peer class, today's TCP listener until browser auth lands; per-connection `select!` with `UpgradeableConnection::graceful_shutdown()`; waiters bounded by count except the auth lane |
| R3 "two-profile cold load" | "two browsers' cold load" |

### Still open

- **Browser auth's own startup refusals** (the socket directory with the wrong mode or
  owner, Funnel on the publication) aren't `ConfigError`s. Whether they also exit 78
  is browser auth's call; a restart can't fix either.
- **The boundaries at 72 and 64** sit above what the arithmetic needs (68 and 63).
  After R3, they could drop to the computed values, or stay round.
- **R3 and R6 on the dev box** settle the stall-free claim at caps, the Unix-socket
  buffer cost, and the 10 ms wait bound; none is measured yet.
