# P5 resource-budget probe (p153)

## Outcome

This was a partial probe, not a defensible complete budget measurement. No project source files were edited. The requested repeated Linux workload measurements, actual cgroup trials, and completion-index test were not completed because the clean export did not build its embedded web assets in the Debian container. The local `HEAD` was `3f7799c6d9abf6826ffc73ddeb18cf4ba6b5c41a3`, not the stated `71944d7 or later` baseline. `git archive HEAD` was used regardless; this is a version/baseline gap.

## Environment and build attempt

Host: macOS 27.0 arm64; Docker reported Linux/aarch64. `uptime` showed load averages 12.55/11.41/13.07 on 8 logical CPUs, so host load was elevated. A uniquely named Debian 12 container (`tether-budget-p153`) was built and run privileged with cgroup mounts for systemd. The container was removed, then its image was removed; `/tmp/tether-meridian-501/budget-p153` was deleted. No container remains.

Commands, from clean `git archive HEAD` export:

```sh
git archive HEAD | tar -x -C /tmp/tether-meridian-501/budget-p153
docker build -t tether-budget-p153 /tmp/tether-meridian-501/budget-p153
docker run -d --privileged --name tether-budget-p153 --cgroupns=host \
  --tmpfs /run --tmpfs /run/lock -v /sys/fs/cgroup:/sys/fs/cgroup:rw tether-budget-p153
docker exec tether-budget-p153 bash -lc 'cd /src && pnpm --dir web install --frozen-lockfile && cargo build --locked --release'
```

The first build used Debian's Node 18.20.4 and failed in Vite/Rolldown: `SyntaxError: The requested module 'node:util' does not provide an export named 'styleText'`. Retried with Node 22.15.0 downloaded to `/opt/node`; build then failed because `@rolldown/binding-linux-arm64-gnu` could not be found. Therefore there was no release daemon artifact in the clean Debian export to run. `systemctl is-system-running` returned `running` during the attempt, but no tether process/cgroup measurement was possible. This is a build setup failure, not evidence of a tether defect. The exact OS packages used included build-essential, libssl-dev, zlib1g-dev, libevent-dev, bison, systemd/systemd-sysv, procps, heaptrack, Python, node/npm and pnpm 9.

## Actual measurements collected

One native macOS observation using the pre-existing `target/release/tether` binary (not proven to correspond to clean archived HEAD):

- Command: `XDG_RUNTIME_DIR=/tmp/tether-meridian-501/budget-p153/macos/runtime target/release/tether --config /tmp/tether-meridian-501/budget-p153/macos/config.toml serve`
- Startup log: `configured_mib=72 unit_limit_mib=None effective_mib=72 tier="72+" control_clients=3 sockets=3 completion=true`; warned that Tailscale LocalAPI was unavailable.
- `ps -o pid,rss,%cpu,time`: at ~2 s RSS 3696 KiB, CPU 0.0%, CPU time 0:00.01; at ~60 s RSS 1664 KiB, CPU time still 0:00.01. This is one noisy macOS process sample, not a repeated baseline; CPU percent is lifetime-average and should not be compared with interval CPU. Thread count/open FDs were not gathered.

Prior p139 Linux observation (not repeated/re-measured in this run; cited only for orientation) reported idle RSS 5.71 MiB, CPU 0.000%; one watcher 6.26 MiB, 0.167%; `yes` flood 13.83 MiB, 8.167% over 6-second CPU sampling, each single sample. It cannot support medians/spreads, nor answer the new conditions.

## Requirement coverage

| Requirement | Outcome | Evidence / gap |
|---|---|---|
| Idle Linux, >=5 runs, RSS breakdown, >=60 s CPU, threads/fds | Not measured | Debian artifact build failed; no `/proc/<pid>/smaps_rollup` or heaptrack. |
| Watchers 1/2/3 idle and typing, separate sessions, tmux 3.4/3.7b | Not measured | No running built daemon; no source-built tmux versions in this run. |
| `yes` and 1 MB/s mixed-escape flood, RSS/CPU/queue/socket bound | Not measured | No client/daemon workload. |
| systemd `MemoryMax=72M`, `CPUQuota=50%`, `memory.peak`, `cpu.stat`, OOM | Not measured | systemd ran, but daemon could not be built/launched. |
| 42 MiB tier/refusal/no crash | Not measured | Same. |
| Large completion index, drop after idle / mmap-threshold claim | Not measured | Same. |
| Native macOS idle comparison | Partial, one sample | `ps` evidence above; cannot claim repeated or representative. |

## Verdict and defects

No target receives a pass/fail verdict from this run. The single native sample is below the plan's approximate 5 MB idle RSS target, but the binary provenance is unverified and the one-run spread is unknown. The old p139 sample's 5.71 MiB was above the approximate target but similarly insufficient to establish a reproducible miss.

No tether defect reproduced. The blocker is the environment/build path. Suggested next step: repeat on a Debian image with a Node version supported by the lockfile and ensure pnpm installs the optional rolldown Linux arm64 native binding (`pnpm install --force` / verify optional-dependency platform handling); build only after that succeeds, then run the scenario matrix against the stated HEAD-or-later revision. Avoid changing tether source to work around this probe environment failure.

---

# Follow-up probe (spawn p155; partial measurements)

This follow-up used the required clean archive at `3f7799c` (HEAD was `3f7799c6d9abf6826ffc73ddeb18cf4ba6b5c41a3` at start; later than `71944d7`). It fixes p153's asset-build problem by installing web dependencies *inside* the Debian image with Node 22 and pnpm 9 before the release build. No source files were edited; no test suites were run. This is still a partial run: idle Linux was repeated, systemd limits/tier selection were observed, and macOS idle got one 60-second interval, but watcher/flood/completion-index scenarios were not driven.

## Setup and provenance

- Host: macOS arm64, 8 logical CPUs; initial `uptime` load averages `16.01 11.81 12.38` (busy shared host).
- Clean source: `git archive HEAD` extracted to `/tmp/tether-meridian-501/budget-p155`.
- Linux: Debian 12 arm64 container, systemd 252, Rust 1.94.1. Docker systemd container was privileged with cgroup v2 mounted at `/sys/fs/cgroup`.
- Built release daemon from the archive with `pnpm --dir web install --frozen-lockfile` inside the Linux container and `cargo build --locked --release`; succeeded. Built tmux `3.4` and `3.7b` from their GitHub source release tarballs; `tmux -V` printed `tmux 3.4` and `tmux 3.7b`.
- Used private `XDG_RUNTIME_DIR`, `XDG_STATE_HOME`, `XDG_CONFIG_HOME`, `HOME`, `TMPDIR`, and isolated `tmux -L p155idle` / `p155sys` sockets. No tailscaled was available; daemon warned accordingly. The idle daemon had no phone and no tmux control client. Each repeat waited 20 seconds before sampling, exceeding the documented 15-second control-client linger.
- The native macOS release artifact was separately built from the same clean archive after `pnpm --dir web install --frozen-lockfile` on Node v22.23.4 / pnpm 10.23.0. This is not the prior, provenance-unknown preexisting artifact.

Build commands (executed in the container after the clean archive was copied in):

```sh
pnpm --dir web install --frozen-lockfile
cargo build --locked --release
```

The Linux image used Debian 12, Node v22.15.0, pnpm 9.15.9. The first `docker exec` failed only because the Dockerfile's globally installed pnpm symlink was not on PATH; I installed/relinked pnpm inside the container and reran the install/build successfully. No code workaround was made.

## Linux idle: five independent starts, 60-second CPU windows

Exact sampling method: release daemon started, wait 20 s, read `/proc/$pid/stat` user+system ticks, wait 60 s, read ticks again; CPU percent = `100 * tick_delta / (100 ticks/s * elapsed_seconds)`. RSS/PSS fields came from `/proc/$pid/smaps_rollup`; thread count from `/proc/$pid/status`; FD count from `/proc/$pid/fd`. Tmux server/control clients were absent. Results:

| Start | RSS KiB | PSS KiB | CPU % in 60 s | Threads | FDs |
|---:|---:|---:|---:|---:|---:|
| 1 | 6036 | 4711 | 0.0000 | 1 | 12 |
| 2 | 6036 | 4782 | 0.0000 | 1 | 12 |
| 3 | 6032 | 4782 | 0.0167 | 1 | 12 |
| 4 | 6024 | 4784 | 0.0000 | 1 | 12 |
| 5 | 6040 | 4786 | 0.0000 | 1 | 12 |
| **Median (range)** | **6036 (6024–6040)** | **4782 (4711–4786)** | **0.0000 (0–0.0167)** | **1 (1–1)** | **12 (12–12)** |

The daemon's startup log showed `effective_mib=72 tier="72+" control_clients=3 sockets=3 completion=true`. A sixth `/proc/$pid/smaps` snapshot grouped resident pages by mapping: tether ELF 4,236 KiB; libc 1,240 KiB; anonymous mappings 244 KiB; dynamic loader 168 KiB; libgcc 72 KiB; libm 72 KiB (small mapping/race differences explain the few-KiB mismatch with rollup). `size -A` on that ELF reported `.text=4,064,424` bytes and `.rodata=2,968,832` bytes. The resident daemon footprint is therefore mostly file-backed binary pages plus shared libraries, not heap: rollup showed only 436 KiB `Anonymous` / `Private_Dirty`. Embedded web assets are in the binary's read-only data but this measurement does not separate those bytes from other `.rodata`; no heaptrack run was done.

**Target verdict:** the plan says “under ~5 MB” RSS. Repeated Linux RSS is 5.88 MiB median (range 5.88–5.90 MiB), above a literal 5 MiB target; PSS is 4.67 MiB median (range 4.60–4.67 MiB). Because the product target is explicitly approximate and “RSS” includes shared libraries, this is a small observed miss if the threshold is literal, not enough to establish a stable regression. CPU meets the “about 0%” target in this condition. No performance comparison is claimed.

## systemd cgroup observations (idle only)

Ran the built daemon as a system service in the Debian systemd container, read its cgroup v2 files under `systemctl show ... -p ControlGroup`, then waited 60 seconds. This used the equivalent requested caps, not the installed user's actual service unit; the service set `MemoryMax`, `CPUQuota`, and `GLIBC_TUNABLES` explicitly.

- At `MemoryMax=72M`, `CPUQuota=50%`, startup logged `configured_mib=72 unit_limit_mib=Some(72) effective_mib=72 tier="72+" control_clients=3 sockets=3 completion=true`. Cgroup values: `memory.max=75497472`, `cpu.max=50000 100000`; `memory.peak=1081344` bytes; after 60 s `memory.current=593920`, `cpu.stat usage_usec=11103 nr_throttled=0 throttled_usec=0`; `memory.events oom=0 oom_kill=0`. The cgroup's memory accounting was far below process RSS (container accounting / shared-page behavior), so these must not be compared as equivalent quantities.
- At `MemoryMax=42M` plus `memory_budget_mib=42`, startup logged `effective_mib=42 tier="42–52" control_clients=1 sockets=2 completion=false`; `memory.max=44040192`, `cpu.max=50000 100000`, `memory.peak=1077248`, `memory.events oom=0 oom_kill=0`. The service stayed active while idle. This confirms cap visibility and tier choice, **not** the session-refusal path.
- Adversarial below-minimum config `memory_budget_mib=41` exited `78` with exact output: `tether: memory budget 41 MiB (config 41 MiB, unit none) is below the minimum of 42 MiB`. This was a direct process invocation, not a 42-MiB session refusal.

No pane flood was run in the cgroup. Therefore there is no `yes` or mixed-escape measurement, high-water under active load, throttling under load, or flood OOM verdict.

## macOS native idle (one 60-second interval)

The clean-archive native arm64 release daemon ran with no client. `ps -o pid=,rss=,etime=,time=,%cpu= -p $pid` at 20 s printed `45920 3856 00:20 0:00.01 0.0`; at 80 s it printed `45920 1232 01:20 0:00.01 0.0`. RSS fell from 3,856 KiB to 1,232 KiB after the idle period; CPU time was unchanged at 0.01 s over the 60-second interval (rounded by `ps`), `%CPU` showed 0.0. One run only; `ps` RSS is not directly comparable to Linux PSS.

## Coverage and verdicts

| Requested item | Outcome |
|---|---|
| Idle Linux, five starts, 60 s CPU, thread/fd count, RSS decomposition | **Measured.** RSS just above approximate target; CPU near zero. |
| 1/2/3 watchers, separate sessions, idle and typing, on tmux 3.4 and 3.7b | **Not measured.** The tmux versions were built but no clients were driven. |
| `yes` and 1 MB/s mixed-escape output, queue/socket backpressure | **Not measured.** No watched terminal or client socket. |
| 72 MiB systemd flood, peak/CPU throttling/OOM | **Not measured under flood.** Idle cgroup cap/counters were read; no OOM at idle. |
| 42 MiB session refusal with `limit`, no crash | **Partial.** Tier selected and idle service active; no watched session was attempted, so refusal behavior is unverified. Below-minimum 41 MiB did return 78. |
| Large completion index and drop after idle / mmap-threshold | **Not measured.** No completion request/index was generated. |
| macOS native idle RSS/CPU | **One interval measured.** Not repeated. |

No tether defect reproduced by the measured cases. The main open question is whether the approximate Linux idle RSS target is intended to mean RSS or proportional set size; by RSS it is modestly exceeded. The requested workload assertions remain open, not passes. This partial report should not be treated as a complete P5 resource-budget sign-off.

---

# Additional runtime coverage (p155; supersedes the earlier partial coverage table)

The remaining workflow matrix was exercised against the same clean archive-derived Linux release build. The terminal was opened through the actual app in headless Chromium via the repo's `web/e2e/shared/stack.ts`; the helper's daemon launch in the **scratch archive only** used a transient systemd service, so the daemon's cgroup was measurable. The transient service set `MemoryMax=<budget>M`, `CPUQuota=50%`, `CPUQuotaPeriodSec=10ms`, `GLIBC_TUNABLES=glibc.malloc.mmap_threshold=131072`, and `Type=notify`; config was 72 MiB except for the explicit 42 MiB trial. This matches the tested budget knobs, but is not the installed `contrib/tether.service` user unit. cgroup v2 was active. The app's development proxy supplied the e2e identity; no tailscaled or tailnet was available.

The command shape for each browser-driven scenario was:

```sh
cd /src/web
TETHER_E2E_PORT=59159 TETHER_TMUX=/opt/tmux/3.7b/bin/tmux MEMORY_MIB=72 \
  pnpm dlx tsx /tmp/budget-client-p155.mts
```

The 3.4 run used `TETHER_E2E_PORT=59155` and `/opt/tmux/3.4/bin/tmux`; the 3.7b run used port 59159 and `/opt/tmux/3.7b/bin/tmux`. Each started a fresh named `tmux -L` server, created separate sessions `s1`, `s2`, `s3`, and opened each in a separate browser tab. For the shorter `VmHWM` runs the ports were 59161 (3.4) and 59162 (3.7b); those runs reduced each idle-watcher interval to 1 s but kept the same typing and flood actions. The screenshots for the 42 MiB refusal and recovery are [`tier42-limit-p155.png`](tier42-limit-p155.png) and [`tier42-retry-p155.png`](tier42-retry-p155.png).

## Watchers and typing

One browser tab was added at a time and the daemon log reported `tmux control client ready` for each distinct session. `tmux list-clients -F '#{client_control_mode} #{client_session}'` showed `1 s1`, then `1 s1`/`1 s2`, then all three. Idle observations were 20-second intervals in the main runs; RSS is the final `/proc/<pid>/status` `VmRSS`, CPU is process tick delta (`CLK_TCK=100`) over that interval. Each typing check sent `echo typed-N` in its own page and `tmux capture-pane` confirmed all three output lines.

| tmux | 1 watcher RSS / CPU | 2 watchers RSS / CPU | 3 watchers RSS / CPU | 3 watchers after typing RSS / CPU |
|---|---:|---:|---:|---:|
| 3.4 | 6,600 KiB / 0.000% | 6,800 KiB / 0.050% | 6,952 KiB / 0.000% | 6,952 KiB / 0.100% |
| 3.7b | 6,616 KiB / 0.000% | 6,796 KiB / 0.000% | 6,968 KiB / 0.050% | 6,968 KiB / 0.000% |

There were 2 daemon threads; FDs were 17, 22, and 27 at 1, 2, and 3 watchers. This matrix is one run per version/condition (not a comparative benchmark); the earlier five-run no-client measurement remains the repeated idle baseline.

## Watched-pane floods, cgroup caps, and socket observations

With all three browser tabs still watching separate sessions, the first pane ran `yes` for 12 s. The second flood ran an 8-second Python producer that emitted exactly 8,388,608 bytes (1 MiB/s) of printable text mixed with ANSI color/cursor/erase escapes. `capture-pane` showed 47 visible `y` lines after the `yes` run; the escape producer printed `STREAM_BYTES 8388608`. Process RSS high-water came from `/proc/<pid>/status` `VmHWM`, not just the beginning/end RSS samples.

| tmux | `yes` process RSS HWM | `yes` CPU | `yes` cgroup memory.peak | Mixed-stream process RSS HWM | Mixed CPU | cgroup CPU throttling / OOM |
|---|---:|---:|---:|---:|---:|---|
| 3.4 | 13,612 KiB (13.29 MiB) | 5.41% | 11,210,752 bytes (10.69 MiB) | 13,612 KiB | 3.00% | 1 period throttled, 5,852 µs total; OOM 0 |
| 3.7b | 13,212 KiB (12.90 MiB) | 5.92% | 10,883,072 bytes (10.38 MiB) | 13,212 KiB | 2.87% | 0 throttled periods; OOM 0 |

Both transient units exposed `memory.max=75497472`, `cpu.max=50000 10000` (50% quota, 10 ms period), and `memory.events` stayed at `oom=0`, `oom_kill=0`. The 3.4 run's cgroup CPU throttle was one short period (5.852 ms); it did not approach sustained quota throttling. No daemon crash occurred, and memory stayed well below the 72 MiB cap. `VmHWM` is lifetime high-water (including setup), while cgroup `memory.peak` is separately accounted kernel memory; they are not interchangeable.

Playwright `framereceived` payload accounting observed about **43.1 MB** cumulatively after the 3.4 `yes` phase and **55.1 MB** after the 3.7b `yes` phase, across the three active browser sockets; after the mixed stream the cumulative values were 70.6 MB and 83.0 MB. These are decoded WebSocket frame payload bytes, not wire bytes (frame/TLS overhead excluded), and the browsers were actively consuming and rendering. This shows the actual high-throughput path, but does **not** test a stalled/non-reading phone or establish a queue limit under a slow client; that backpressure assertion remains open. No four-tab cap-boundary attempt was made.

## 42 MiB systemd tier: refused session and recovery

`startStack({ memoryMiB: 42 })` generated `memory_budget_mib = 42`; the scratch wrapper placed the daemon in a transient systemd unit with `MemoryMax=42M`. Startup logged `effective_mib=42 tier="42–52" control_clients=1 sockets=2 completion=false`; cgroup values were `memory.max=44040192`, `memory.peak=2326528`, and `memory.events` reported `oom=0 oom_kill=0`. The service remained active.

A first browser watched `s1`; a second opened `s2`. The second page showed the user-facing state `s2 / sh, session limit` with message: `tether on pop-os allows 1 tmux session at a time; open now: s1`, followed by `Close tabs from other sessions...` and a `Retry` button. After closing the first page, `Retry` succeeded and the second page became `s2 / sh, connected`; the systemd service stayed active. Screenshots are linked above. The separate `memory_budget_mib=41` process check still returned exit 78 with the exact below-minimum diagnostic recorded earlier.

## Completion: 1 MiB history index and 5,000-entry directory cache

Both requests used the actual `POST /complete` route through the development proxy and a 72 MiB systemd-cgroup daemon. The scratch unit had the same `GLIBC_TUNABLES` value as the checked-in service; `/proc/<pid>/environ` confirmed `glibc.malloc.mmap_threshold=131072` in the history trial.

- **History index:** created a 1 MiB `.bash_history` (74,899 distinct `echo x...` lines). `before="echo x"`, `after=""` returned HTTP 200 with three `history` chips. First request: 19.5 ms. Before: RSS 5,852 KiB, anonymous 444 KiB, cgroup `memory.current=602,112`. After build: RSS 6,776 KiB, anonymous 920 KiB, `memory.current=1,675,264`, `memory.peak=3,674,112` bytes. After navigating the client away and waiting 5m30s: RSS 6,720 KiB, anonymous 672 KiB, `memory.current=831,488`. Thus cgroup current fell by 843,776 bytes and anonymous memory by 248 KiB; RSS fell only 56 KiB and remained above the no-client pre-index sample. A second request after idle returned HTTP 200 / three chips in 32.3 ms and raised RSS to 6,980 KiB, anonymous to 932 KiB, and current to 1,126,400 bytes. One request per state; no timing comparison is claimed.
- **Large directory listing:** created 5,000 empty files named `entry-00000.dat`…`entry-04999.dat`; `before="cat entry-"`, `cwd=<directory>` returned HTTP 200 with the capped 20 path chips in 16.7 ms. Before: RSS 5,848 KiB, anonymous 440 KiB, cgroup current 602,112. After request: RSS 6,796 KiB, anonymous 1,068 KiB, current 1,380,352, `memory.peak=2,101,248`. After client close and 5m30s idle: RSS 6,684 KiB, anonymous 764 KiB, current 933,888. A post-idle request returned the same 20 chips in 37.0 ms and raised RSS to 6,968 KiB, anonymous to 1,048 KiB, current to 1,249,280. This is partial reclamation in RSS, with clear reductions in anonymous/cgroup current after idle; the second request confirms the endpoint still works. As with the history case, samples are one per state, not a repeated timing benchmark.

No OOM or daemon exit occurred in these completion requests. The post-idle RSS did not return fully to the initial process sample, so this is evidence of some memory drop, not proof that every byte is returned to baseline. The cgroup current and anonymous fields are more informative here than RSS alone, but are still snapshots rather than an allocator profile.

## Overall updated verdict and remaining limits

- **Idle target:** five-run Linux RSS median 5.89 MiB remains slightly above the plan's approximate ~5 MB; PSS median is 4.67 MiB and idle CPU is near zero. Binary/rodata and shared libraries account for most resident pages.
- **Watchers/typing:** observed successful operation at 1/2/3 distinct sessions on both source-built tmux versions. No fixed watcher memory target is stated; report numbers as baselines, not pass/fail.
- **Flood/cap:** both floods stayed within the tested 72 MiB systemd memory cap; `yes` process RSS HWM was 12.9–13.3 MiB and OOM counters stayed zero. Active clients received many WebSocket payload bytes; slow-reader queue/backpressure behavior is still untested.
- **42 MiB tier:** cap selection, user-visible `limit` refusal, retry recovery, active service, and zero OOM observed.
- **Completion idle drop:** history and 5,000-path caches responded before and after a 5m30s idle interval. Both showed lower anonymous/cgroup memory afterward, but RSS only partially fell toward its pre-index value. GLIBC tunable was present in the daemon environment. No defect is asserted from these single samples.
- **macOS:** one native clean-archive idle interval only, as recorded above; not repeated.

The container/image and all p155 scratch scripts/exports were removed after collecting these excerpts. Only this README and the two cited PNG screenshots remain from p155; no daemon/service or tmux process was left running.
