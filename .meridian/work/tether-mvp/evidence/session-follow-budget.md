# Session-follow daemon resource probe (p252)

## Scope and provenance

Probed the **prepared immutable snapshot** `/tmp/tether-budget-source-c235`, not the live checkout. `SOURCE-PROVENANCE.txt`: base `3821927`, 656 files, snapshot content SHA-256 `223449c8470a0796d6a10f07045b5d5c8d6d7d19c2eb4d301287a2cd48cd930e`. It contains the daemon integration fixes and client p245, **before** the separate p248 web-only review edits. Rust production code was frozen for this run. Results are not claimed to represent a later web bundle and are not compared with the earlier baseline.

Inside Debian 12 arm64, copied that snapshot to `/work`, installed web dependencies with Node `v22.23.4` and pnpm `12.11.2`, then built the embedded web assets and release daemon with `pnpm --dir web install --frozen-lockfile` and `cargo build --locked --release`. Linux Rolldown optional binding installed successfully; `/work/web/dist/index.html` was emitted. `cargo build` finished successfully and `/work/target/release/tether --version` printed `tether 0.0.1` (9,051,504-byte release binary). Rust was `1.94.1`; source-built tmux binaries printed `tmux 3.4` and `tmux 3.7b`. No test suite was run.

Host/container: Docker Desktop/Engine `29.6.2`, Linux arm64; Debian GNU/Linux 12 (bookworm), kernel `6.12.76-linuxkit`, cgroup v2. The release build and workload ran in separate task-owned containers. Private `TMUX_TMPDIR`, XDG dirs, `-L p252w34` / `-L p252w37` sockets, temporary sessions and device credentials were used. The real WebSocket v2 protocol was exercised with scratch `ws` clients and private `device add` tokens; no personal tmux, homebox, Tailscale, installed service, or real iPhone was involved. The client was a wire-level protocol driver, not the rendered browser/native UI.

## Measurements

### Repeated Linux idle starts

Three fresh release-daemon starts, each with no phone and no tmux control client; waited 20 seconds, then sampled process CPU ticks over 60 seconds and `/proc/$pid/smaps_rollup`, `status`, and `fd`. Docker cgroup was `MemoryMax=72 MiB` (`memory.max=75497472`) and `CPUQuota=50%` (`cpu.max=50000 100000`).

| Start | RSS KiB | PSS KiB | Anonymous KiB | CPU ticks / 60 s | CPU % | Threads | FDs |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 6440 | 5211 | 456 | 0 | 0.0000 | 1 | 12 |
| 2 | 6440 | 5211 | 456 | 1 | 0.0167 | 1 | 12 |
| 3 | 6440 | 5211 | 456 | 1 | 0.0167 | 1 | 12 |
| Median (range) | 6440 (6440–6440) | 5211 (5211–5211) | 456 | 1 (0–1) | 0.0167 (0–0.0167) | 1 | 12 |

CPU percentage is process tick delta divided by the 60-second interval at 100 ticks/s. Idle CPU was effectively zero. RSS was 6.29 MiB median (PSS 5.09 MiB), above a literal reading of the plan's *approximate* “under ~5 MB” idle RSS target; this is an observation, not a regression comparison or a hard-limit verdict.

### Real sessions, window follow, Fit, and laptop acts

On both tmux versions, a fresh server had three separate sessions, each with two windows. The actual authenticated WebSocket clients got protocol-2 `welcome`, listed sessions, and received `watching` for all three. `tmux list-clients` showed `1 s1`, `1 s2`, `1 s3` (control mode) on both versions. Three select/follow cycles on the first watch each completed with `watching`; each was followed by an input (`echo follow_N`) and a forced resize, mirroring the UI's Fit request. Pane capture confirmed the typed markers. Decoded WebSocket frame-payload bytes observed from each select through its `watching` and a 250 ms drain were:

- tmux 3.4: 346, 545, 804 bytes (three cycles).
- tmux 3.7b: 344, 541, 798 bytes (three cycles).

These are one-run message payload observations, including JSON/binary payloads but excluding WebSocket/TLS overhead; not an A/B performance claim.

Separate one-watch Fit probes on both versions read the actual tmux window size before and after: `80x24` → `110x36`. The 3.7b Fit probe's subsequent `echo fit_marker` was visible in pane capture. The 3.4 Fit's resize succeeded; its marker check targeted the previous window and was false, so no marker success is claimed for that Fit probe. Input markers from the 3.4 switch cycles were confirmed separately. Selection/follow and claiming input exercised the take path; I did not separately instrument tmux `latest` or each resulting size vote.

An attached PTY tmux client (the laptop analogue) was observed as `0 s1`; sending prefix+n (`C-b n`) changed `s1`'s active window to `second:1` on both versions. On 3.7b, the same list also showed the three control clients while the PTY was attached. On 3.4, the PTY act was confirmed in its own subsequent run; watcher-follow notification from that act was not separately asserted.

### 72 MiB flood, paused reader, and session churn

The final workload ran in a clean runtime container with cgroup v2 `memory.max=75497472`, `cpu.max=50000 100000`; daemon startup logged `effective_mib=72 tier="72+" control_clients=3 sockets=3 completion=true`. With three watched sessions on tmux 3.7b, one authenticated client stopped reading its WebSocket for 7 seconds during a `yes` pane output. A tmux command interrupted the pane and wrote a recovery marker; the reader resumed and the socket closed normally when the client ended. The same watched pane then ran a four-second producer that wrote four 1 MiB chunks of printable text mixed with ANSI color/cursor escapes, then returned to the shell. Pane capture showed the terminal had returned to `bash` and the wrapped tail `NE=4194304`; the exact full marker was not preserved in the terminal capture. No automatic catch-up snapshot's contents were isolated from the mixed stream, and no queue-depth instrumentation was available.

During this combined test, daemon process `VmHWM` was 12,268 KiB (12.0 MiB); final RSS after churn was 11,824 KiB. Container cgroup `memory.peak=62,332,928` bytes (59.4 MiB) against 72 MiB, `memory.current=16,834,560`, and `memory.events` had `oom=0`, `oom_kill=0`. This cgroup includes tether, tmux, and the protocol client, so is an aggregate workload bound, not daemon-only memory. Daemon process CPU over the 4.8-second ANSI phase was 5 ticks (about 1.0% of one core). The cgroup CPU counters after the run were `usage_usec=5,349,558`, `nr_periods=203`, `nr_throttled=87`, `throttled_usec=12,532,497`; these include all container processes and the whole run.

Afterward, 10 rounds opened three authenticated connections, watched the three distinct sessions (30 successful watches), then unwatched/closed them. Daemon RSS changed 11,580 → 11,624 KiB during the driver process; `VmHWM` stayed 12,268 KiB and cgroup peak stayed 62,332,928 bytes. Cgroup current rose 42,323,968 → 45,412,352 bytes while the Node driver was resident, then was 16,834,560 bytes after it exited. No OOM was recorded. This checks short session churn, not an extended endurance test.

The 72 MiB cap applied to the whole task container rather than a dedicated systemd service cgroup; Docker cgroup counters therefore include tmux and the load client. The earlier build container had a historical OOM before the clean runtime container was made; its counters were discarded. The values above come from the separate clean runtime container whose OOM counters were zero at start and end.

### 42 MiB refusal and recovery

A separate clean container ran the daemon with both Docker `MemoryMax=42 MiB` (`memory.max=44040192`) and config `memory_budget_mib=42`; startup logged `effective_mib=42 tier="42–52" control_clients=1 sockets=2 completion=false`. First WebSocket watched `s1`; a second watched distinct `s2` and received:

```json
{"type":"watchEnded","data":{"watch":2,"reason":"limit","message":"tether on tether allows 1 tmux session at a time; open now: s1"}}
```

After closing the first socket, retrying the second watch succeeded with a `watching` reply for `s2`; `tmux list-clients` showed only `1 s2`, and the daemon remained active. Afterward cgroup `memory.peak=34,594,816` bytes, `memory.current=6,696,960`, `oom=0`, `oom_kill=0`; daemon `VmHWM=7,104 KiB`. No below-minimum config trial was repeated.

## Outcome, gaps, and cleanup

Observed successful 1/3-session watching on both tmux versions, repeated follows and Fit sizes, real PTY laptop window changes, bounded aggregate memory under the 72 MiB cap, short paused-reader behavior, short session churn, and 42 MiB refusal/recovery. No defect reproduced. This is not a full product/resource sign-off: no real iPhone/tailnet, no systemd user-unit validation, no long-duration or sustained flood run, no exact hub queue/credit occupancy, no PSS/thread/FD samples during active load, and no isolated snapshot-marker proof after the stalled read. 3.4 active flood/cgroup trials were not repeated. No comparison to p155 or an allegedly identical final web bundle is made.

No project source was changed. Concise evidence is this file; raw build/runtime logs and temporary scripts were kept under `/tmp`, not here. Task-owned containers/images and temporary snapshot/runtime copies are removed after collecting these results; no service or tmux server is left running.
