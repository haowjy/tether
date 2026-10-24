# P5 probe: measure tether's resource budget on Linux (Docker on this Mac) and macOS

The budget is in `docs/design/plan.md` §Resource budget and `docs/design/daemon-core.md` §6 (limits and memory ceiling, tiers). A first Linux probe (p139, `meridian spawn show p139`; evidence `.meridian/work/tether-mvp/evidence/linux-docker/README.md`) took single samples: idle RSS 5.7 MiB vs the "~5 MB" target, 0.17% CPU with one watcher, 13.8 MiB / 8% CPU under a `yes` flood. Turn that into a measurement you'd defend (`/probe`'s measurement guidance: repeated samples, rule out errors and skipped work, report spread).

Use a clean `git archive HEAD` export (HEAD is 71944d7 or later) in a Debian container (systemd-enabled for the cgroup runs), tmux 3.4 and 3.7b built from source with isolated `-L` sockets. Measure:
1. Idle with no client, after the control-client linger: RSS (where does it go — run `heaptrack` or read `/proc/<pid>/smaps_rollup` to say what the 5–6 MiB is: binary text, allocator, embedded web assets?), CPU over ≥60 s, thread count, open fds. Repeat ≥5 runs.
2. Watchers: 1, 2, 3 (the default socket cap), each on a different session; idle and with typing.
3. Floods: `yes` and a 1 MB/s mixed-escape stream in a watched pane; RSS high-water, CPU, whether output stays bounded (queues per daemon-core §6), and that the phone-side socket isn't flooded beyond the design.
4. Under the systemd unit with its caps (`MemoryMax=72M`, `CPUQuota=50%`): the same flood; `memory.peak`, `cpu.stat` throttling, no OOM. Then a tight budget (`memory_budget_mib = 42` and `MemoryMax=42M`): tier chosen, a session refused with `limit`, no crash.
5. Completion index (complete.md) on a large directory: peak and the drop back after idle (the `GLIBC_TUNABLES` mmap threshold claim in `contrib/tether.service`).
6. macOS (this Mac, native build): idle RSS and CPU only, for comparison.
Drive clients with the repo's existing tooling (the real-daemon e2e stack in `web/e2e/shared/stack.ts`, or a small throwaway WebSocket client under /tmp/tether-meridian-501/budget-<spawn id>/). No source edits; record numbers and commands in `$MERIDIAN_ACTIVE_WORK_DIR/evidence/budget/README.md` (excerpts, not dumps). Defects: file:line and a proposed fix. Remove your containers/images after. Report: table of numbers vs targets, verdict per target, defects.
Spawn env TMPDIR=/tmp/tether-meridian-501.

## Retry note (after p153)
p153 failed to build in the container: Node 18 lacks `util.styleText` for Rolldown, and with Node 22 the Linux arm64 Rolldown binding was missing — because `node_modules` came from the Mac. p139 built the same tree in Docker successfully: run `pnpm --dir web install --frozen-lockfile` *inside* the container with Node 22 on a clean export that has no `node_modules` (see `.meridian/work/tether-mvp/evidence/linux-docker/README.md` and `meridian spawn show p139`). HEAD 3f7799c is later than 71944d7; that's fine. Extend `evidence/budget/README.md`.
