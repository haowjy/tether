# Review 1: resource-limits.md (draft for review)

Reviewed `.meridian/work/tether-mvp/design/resource-limits.md` against `main` at
`07c4357`: `docs/design/daemon-core.md` §6–§7, `plan.md` "Resource budget",
`contrib/tether.service`, `docs/running.md`, `fs.md` and `complete.md` ceilings,
browser-auth revision 3 §2 D6 and §5, and the code (`src/config.rs`, `src/main.rs`,
`src/http/{mod,ws,fs,complete}.rs`, `src/hub/mod.rs`, `src/fs/slots.rs`,
`src/blocking.rs`, `src/proto/messages.rs`, `web/tabs/connection.ts`). Kernel facts are
from Linux v6.8 `mm/memcontrol.c`; crate facts from the vendored mio 1.2.4.

## Verdict: request changes

The direction is right. One number, checked against the unit at startup, is the right
shape for "capped where Jimmy chooses": refuse at a cap, never get OOM-killed. The
arithmetic holds. I recomputed every tier from the per-item rows and got 63.75, 58.45,
50.65, 46.29 and 35.0 MB, each matching the spec, and each plus 4 MiB fits its range.
The client backoff bug is real (`connection.ts:68` restarts at attempt 0 on every
`watchEnded`). Moving the accept loop forward (D6) is necessary.

Four things should change before building:

- **H1.** `MemoryHigh` at three quarters sits below every tier's ceiling. At caps the
  kernel then stalls tether for whole seconds per allocation, and the spec treats that
  state as harmless.
- **M1.** The budget leaks through tmpfs uploads.
- **M2.** R3's pass formula leaves out rows the ceiling counts.
- **M3.** The keystroke bound of 10 ms assumes one thread.

There are also two simplifications that would take out about half the tier table's
moving parts (S1, S2).

## High

### H1. `MemoryHigh` = ¾ budget puts every at-caps state into seconds-long kernel stalls

**Where:** §3.1 "What has to fit" ("throttled, not killed, and only in a state one user
rarely reaches"), §3.2 unit bullet, §3.3 `MemoryHigh=54M`, §3.4 "Set `MemoryHigh` to
three quarters", D2.

**The failure:**

- At the default the unreclaimable ceiling is 63.8 MB (60.8 MiB), against
  `MemoryHigh=54M`. At the floor it is 35.0 MB (33.4 MiB), against 30M.
- Above `memory.high` the kernel tries to reclaim. When the overage is unreclaimable
  anon, socket or shmem memory, reclaim fails, and the task sleeps on its return to
  user space.
- `mm/memcontrol.c` (v6.8, lines 2543–2721) computes the sleep as
  `overage² · HZ >> 34`, scaled by `nr_pages / 64` and capped at
  `MEMCG_MAX_HIGH_DELAY_JIFFIES = 2·HZ`. Sleeps of 10 ms or less are skipped. Overage
  is `(usage − high) / high`.
- At the default ceiling the overage is about 12.6%. A 64-page charge (256 KiB, one
  output frame or one snapshot buffer) sleeps about 1 s. A 16 KiB charge sleeps about
  64 ms.

The daemon runs its async work on one thread, so every socket, the pump and the pings
stall together. The `tmux -C` clients are in the same cgroup and stall too. The 10 s
reply timeout then kills control clients as crashed, so watches end with `error`.
That is the exact outcome the tiers exist to prevent, reached through throttling
instead of OOM.

The spec (and today's unit, 48M against ~65) treats `MemoryHigh` as a soft warning. It
is a hard latency cliff for memory that can't be reclaimed. R3 holds every cap for two
minutes and is likely to show watch ends or reply-timeout kills. It doesn't check for
either.

**The check:** read the kernel source above. Recomputed the overage from the spec's own
numbers.

**Fix direction (simplest):** drop `MemoryHigh` from the unit and from running.md. The
daemon's caps already keep the unreclaimable part under `MemoryMax`, and `memory.max`
reclaims page cache synchronously before it OOM-kills. This also removes the second
number a tuner must keep in sync, the "three quarters" rule, and the "throttle comes
sooner while reclaimable rows are warm" paragraph.

If a soft line is wanted for page cache from raw streaming, set it at or above the
tier's unreclaimable ceiling plus headroom: `MemoryHigh` = budget − 4 MiB. Never set it
below the ceiling.

Either way, add to R3: no `watchEnded`, no reply-timeout kill, and echo p99 within the
R5 bound while at caps.

**Class:** this is the instance. The class is "a limit set below what the daemon
legitimately holds". The same check applies to `TasksMax`: 8 blocking threads, the
runtime, 3 control clients, a one-shot and `systemd-run` come to 14, comfortably
under 32.

## Medium

### M1. Uploads to a tmpfs root are charged to the unit as unreclaimable shmem, up to 128 MiB

**Where:** §3.1 "Why these scale and nothing else" and the ceiling table. The tier
model assumes every unreclaimable byte is a row.

**The failure:**

- fs.md allows uploads up to 128 MiB (`fs.md:29`), into `uploads_dir` or any root.
- If that directory is on tmpfs (`/tmp` on Fedora, Arch and recent Ubuntu, `/dev/shm`,
  `$XDG_RUNTIME_DIR`), the written pages are shmem, charged to the cgroup of the
  writer: tether's unit.
- Without swap they can't be reclaimed. They stay charged after the upload finishes,
  for as long as the file exists.

A 70 MiB upload to `/tmp` OOM-kills tether at the default budget. Two 20 MiB uploads
push the 72 tier over. No tier or `limit` refusal sees it, because nothing in the
ceiling counts it.

**The check:**

- Traced the upload row in fs.md: the dirty-page bound covers disk-backed files only.
- `src/fs/` has no `statfs` or filesystem-type check: grep for
  `statfs|TMPFS` finds nothing.
- Paste files are already modelled as tmpfs at 256 KiB each, so the spec knows the
  mechanism.

**Fix direction:**

- fs refuses an upload whose destination's `statfs` type is tmpfs or ramfs. Add an
  error to fs.md "Errors".
- Or cap uploads there at a size the headroom absorbs.
- In either case, add a sentence under "What has to fit" naming tmpfs writes as the
  one way outside the rows.

Strictly this is an fs.md finding, but the guarantee belongs to this spec.

### M2. R3's pass formula leaves out shmem and dirty pages, which the ceiling counts as unreclaimable

**Where:** §3.1 "the largest `anon + kernel + sock − slab_reclaimable`", and R3.

**The failure:**

- Paste files on tmpfs (1 MB in the ceiling) are `shmem`. In `memory.stat` they are
  under `file` and `shmem`, not `anon`.
- An upload's 2 MiB of dirty pages are `file_dirty` and `file_writeback`.
- So the gate measures up to about 3 MB less than the model claims is unreclaimable.
  That is most of the 4 MiB headroom, and the R3 numbers become uninformative for
  exactly the rows that can't be reclaimed.

**The check:** compared the ceiling rows (§3.1) with what each `memory.stat` field
counts.

**Fix direction:** measure
`anon + shmem + file_dirty + file_writeback + kernel + sock − slab_reclaimable`. The
dev box runs systemd 255, which implies kernel 6.8, so the `kernel` key (5.18+) is
there. Note the fallback sum for older kernels.

Also state one unit (see L1). The gap between bytes/10⁶ and bytes/2²⁰ at 63.8 is
2.9 MB, about the size of the headroom, so "at most 63.8" is ambiguous as written.

### M3. "A throttled keystroke waits at most 10 ms" holds only if one thread spends the quota

**Where:** §1, D5, §3.2 CPU bullet, §3.3 comment, §3.4 "never waits more than one
slice", decisions entry, R6 pass "26 ms".

**The failure:**

- CFS bandwidth is per cgroup. The unit holds the runtime thread, 8 blocking threads,
  the `tmux -C` clients and the one-shots.
- During the bursts the spec names (an index build on `index`, a scan on `fs`, a
  snapshot), several threads run on different cores at once and drain the 10 ms quota
  in a few ms of wall time. With 4 runnable that is 2.5 ms. The cgroup is then
  throttled for the rest of the 20 ms period.
- So a keystroke can wait up to about 17–18 ms, bounded by the period, not by
  period − quota.

D5's "100% is about what the current-thread runtime can use anyway" is wrong for the
same reason. The blocking pool and the tmux clients can exceed a core.

The flood figure of 2% (decisions "Batched pipe reads") was the daemon process.
`tmux -C`'s relay CPU, which is in the unit, wasn't counted. R5 measures the unit's
`cpu.stat`, so the gate catches it; the prose shouldn't claim it.

**The check:** read `src/blocking.rs` (8 threads, 4 lanes) and the decisions entry.
The quota semantics are standard CFS bandwidth: the quota is per cgroup per period,
across CPUs.

**Fix direction:** state the bound as "at most one period, 20 ms", and set R6's pass
to 16 + 20 ms. Or, if 10 ms matters, use `CPUQuotaPeriodSec=10ms`: same 50%, at most
10 ms. Reword D5's 100% rejection as "doesn't bound the blocking pool and tmux
clients either".

### M4. The cgroup read is underspecified where it will actually break: mount point, missing files, hybrid hosts

**Where:** §3.1 §6.1 "the `0::` line … the lowest `memory.max` from that directory up
to the cgroup root (`max` means none) … With no cgroup v2 hierarchy … the configured
value".

**Missing:**

- **Which directory.** The spec never names the cgroup2 mount. It is `/sys/fs/cgroup`
  on unified hosts but `/sys/fs/cgroup/unified` on hybrid ones. Find it in
  `/proc/self/mountinfo` (fstype `cgroup2`), not by assuming a path.
- **A level with no `memory.max`.** The file is absent where the memory controller
  isn't enabled in the parent's `subtree_control`, and at the root. That must mean "no
  limit at this level", not an error.
- **Hybrid and v1 hosts.** The `0::` line exists but memory is a v1 controller.
  `MemoryMax` for a user unit isn't enforced there at all, because v1 doesn't delegate
  to user managers. The daemon will correctly fall back to the config, but a user who
  set `MemoryMax=48M` believes it is in force.
- **Unreadable or unparsable files.** Say what happens: warn and use the config. Never
  refuse to start because `/proc` is odd.
- **`systemctl --user set-property` takes effect live.** Running.md's "lowering
  `MemoryMax` alone is safe" is true only after a restart. Say "then restart" (§3.4
  already restarts after `systemctl edit`, but the safe-alone sentence doesn't).

**The check:** read the spec text against those cases. Nothing in `src/` reads cgroups
today.

**Fix direction:**

- Spell the algorithm out in five lines:
  1. Find the cgroup2 mount from mountinfo.
  2. Take the path from the `0::` line.
  3. Walk from that directory up to the mount root, taking the minimum over the
     `memory.max` files present and not `max`.
  4. Treat a missing or unreadable file as no limit at that level.
  5. Floor the result to MiB.
- When `INVOCATION_ID` is set (running under systemd) and no limit was found, log a
  warning: "the unit's MemoryMax isn't in force (no memory controller)". Add it to
  running.md's "When something fails".
- macOS: say outright in plan.md that there is no cap there. The budget only sizes the
  counts. "A hard cap … the user can tighten" is Linux-only.

### M5. Exit 78 covers only one configuration error; the others still restart forever

**Where:** D2, §3.3 `RestartPreventExitStatus=78`, plan.md restart bullet.

**The failure:** `src/main.rs:82–86` exits `FAILURE` (1) for every error, including
`ConfigError::Parse`, `TwoSockets` and `NoHome`. Under `StartLimitIntervalSec=0` and
the backoff, a typo in `config.toml` restarts every 60 s forever. That is exactly what
78 is introduced to stop, for one cause out of four.

**The check:** read `main.rs` and `config.rs`.

**Fix direction:** make 78 mean `EX_CONFIG`: any `ConfigError` and a budget below the
floor. The unit comment becomes "78: tether's configuration is invalid; a restart
can't fix it". This is one rule instead of one case.

### M6. At the 1-session tiers, a forgotten tab on another device holds the only session, and the message can't say which

**Where:** §3.5 tmux-sessions row, §3.4 "a tab says Session limit".

**The failure:** the cap is first-come. "Lingering ones closed first" helps only after
the holder's tabs leave the screen. If a desktop browser tab on session A is left open,
the phone can't watch session B. The hint "Close tabs from another tmux session"
doesn't say which session or which device, and the phone retries on a backoff that
climbs to 30 s. So even after the user closes the desktop tab, the phone may take
another 30 s to notice (or until they tap).

**The check:** read the spec's flow; `hub/mod.rs` `MAX_CLIENTS` and the linger
semantics in daemon-core §4.5.

**Fix direction (cheapest):** put the holding session's name in the `limit` message:
"tether on devbox allows 1 tmux session at a time; `work` is open". Name the device
too if the hub knows it.

Optionally, when a control client closes, broadcast `sessionsChanged`, or a
`slotFreed` the web treats as a nudge, so refused tabs retry at once rather than at the
backoff. Preemption of the least recently used client is a bigger policy. Log it as
the alternative D3 rejects, if rejected.

## Simplifications (the simplest model that meets the goal)

### S1. Drop the small-slot halving: three scaled columns, not seven

The halved capture, paste, raw and shell slots save 2.5 MB in total. They cost:

- four extra budget-dependent caps;
- the "waiters + 2" rebalancing rule;
- a cross-spec dependency in fs.md ("2, or 1 below a 64 MiB budget");
- the † rows that depend on browser auth;
- running.md's "the lower tiers also halve a few small slots" sentence;
- four more things R3 and R4 must exercise per tier.

Without halving, the same 4 MiB rule gives these tiers:

| Effective budget, MiB | Control clients | Sockets | Completion |
|---|---|---|---|
| 72+ | 3 | 3 | on |
| 64–71 | 2 | 3 | on |
| 58–63 | 1 | 3 | on |
| 53–57 | 1 | 2 | on |
| 42–52 | 1 | 2 | off |

The ceilings are 63.75, 58.45, 53.15, 48.79 and 37.49 MB. The floor rises from 40 to
42, and every boundary shifts by at most 2 MiB. Each scaled cap is then one that the
user can see and name: sessions, connections, suggestions. `Caps` shrinks to three
fields, and the fs and shell specs stay untouched.

I recomputed the rows; the arithmetic is shown above.

### S2. Signal "completion off" in `welcome`, not with HTTP `503 limit`

Completion off is fixed for the daemon's life. Today the client learns it by sending a
`/complete` request per connection, being refused, and then holding per-host
suppression state until the next `welcome`. R4 tests that dance.

`welcome.daemon` (`DaemonInfo`, `src/proto/messages.rs:212`) can carry
`completion: bool` additively. The suggester never asks, and `HttpError` needs no
`limit`. That deletes the new HTTP error value, the "once per connection" client state
and an R4 case. `limit` then exists in one enum, `watchEnded`.

## Low

### L1. MB and MiB are mixed in one inequality

Budgets and headroom are in MiB; ceilings in MB. Some rows are MB measurements (5.3,
4.9), others MiB constants written as MB (2.1 for 61 × 36 KiB = 2.14 MiB = 2.25 MB).
At the default the two readings differ by 2.9 MB.

The rule as built errs safe, if costs are MB and are treated as MiB. But
`src/budget.rs` must pick one, and so must R3 (see M2).

Fix: keep every cost in KiB in `budget.rs`, print MiB everywhere, and convert
`memory.stat` by 2²⁰.

### L2. The listen backlog is 128, not 32

§3.1 §6.2 says "the kernel's backlog of 32 holds newcomers". `main.rs` binds with
tokio's `TcpListener::bind`, which uses mio's backlog of 128
(`mio-1.2.4/src/net/tcp/listener.rs:87–94`). Queued connections also have default,
autotuned buffers, because `small_buffers` runs after `accept`.

Either bind through `TcpSocket::listen(32)` in the new accept loop, or correct the
row. The same text is in browser-auth §5.

### L3. R2's probe unit needs `-p Restart=on-failure`

`systemd-run` defaults to `Restart=no`. "Shows no restart after 2 minutes" then passes
whether or not `RestartPreventExitStatus=78` works. Pass `Restart=on-failure`
`RestartSec=2` too, and add a control case with exit 1 that does restart.

### L4. The ceiling's measurements are glibc ones

`complete.md` and the mmap pin assume glibc. plan.md already says the musl release
binaries' behaviour is unmeasured. R3 should name the binary it runs: the unit's
`%h/.cargo/bin/tether`, glibc. Either the tiers are claimed only for that build, or R3
runs once with the musl release binary too.

### L5. No CHANGELOG or upgrade note

There is a new config key, changed unit values, and a changed refusal text. An
existing install keeps its copied unit at `MemoryMax=64M` and silently drops to 2
sessions, with only a journal warning. Add an `[Unreleased]` bullet that says to
re-copy `contrib/tether.service` (AGENTS.md "Releases").

### L6. Scratch sessions' control clients aren't placed in the model

The scratch server runs outside the unit, but its control client runs inside it. The
spec doesn't say whether that client counts against the tier's control-client cap.
When scratch shells land, say so in §6.2.

## Rows checked and found complete

The scaled count caps in code are:

- `MAX_CONNS`, `PASTE_SLOTS` (ws.rs);
- `MAX_CLIENTS`, `CAPTURE_SLOTS` (hub);
- `SCANS`, `RAW_RESPONSES`, `UPLOADS` (fs/slots.rs);
- `IN_FLIGHT` 4 (complete.rs).

The tier table covers each of them or deliberately leaves it fixed. `/complete`'s 4
in-flight requests fall under the completion row, because carapace runs one at a time.

Request bodies are bounded at 4 KiB on every JSON route (`ENROLL_BODY`, `JSON_BODY`,
complete's `BODY`), and the upload streams. So 61 non-upgraded connections can't
buffer axum's default 2 MiB each.

The 64 KiB `SO_SNDBUF`/`SO_RCVBUF` (doubled to 128 KiB by Linux) is set on every
accepted socket, which matches the 256 KiB per-socket rows.

The browser-auth move to admitting enrolled tailnet nodes doesn't touch any row here.
The accept loop and the shell rows stand as written.

`CPUQuotaPeriodSec` needs systemd ≥ 242, and `RestartSteps` ≥ 254. The dev box runs
255.4 (`research/probe-tmux.md`), and systemd ≥ 252 delegates `cpu` to `user@.service`
by default, so R1 should pass there.

## Hypotheses (not verified)

- **The size of H1's stall on the dev box.** The formula is from source. I did not
  run a probe unit at caps to measure the stall. This host is macOS and the dev box
  wasn't reachable from this lane. R3, with the added checks, settles it.
- **M3's 17–18 ms worst case.** This comes from CFS bandwidth semantics, not a
  measurement. R6 at 50% with a concurrent index build and scan settles it.
- **Whether the dev box's `/tmp` is tmpfs (M1).** I didn't check it. `/dev/shm` and
  `$XDG_RUNTIME_DIR` are tmpfs everywhere, so the finding stands regardless.
