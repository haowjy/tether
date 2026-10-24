# P5 backpressure probe (spawn p160)

## Outcome

The real debug daemon remained bounded during non-reading and throttled clients on native macOS with isolated tmux 3.4 and 3.7b. `yes` stalled clients did not make the daemon or the second session unusable. An additional no-`resync` check confirmed that the daemon automatically emitted a fresh snapshot after reading resumed: 825 bytes with the correct marker after 10 s on 3.4, and 798 bytes after 60 s on 3.7b. After a 5-minute stall, the socket had closed at the daemon's idle deadline (4000; `Close(Idle)` in the daemon log); a new socket/watch received a fresh snapshot with the post-stall marker. No unbounded RSS growth or wrong resumed content reproduced.

The native Mac has no cgroup `MemoryMax`, so this is not a validation of the Linux cgroup `anon + shmem + dirty + kernel + sock − reclaimable slab` budget formula. Sampled process RSS stayed below 21.3 MiB in the `yes` runs (at most 21,728 KiB, about 21.2 MiB), and did not grow with a 5-minute stall. The plan's 69 MiB ceiling / 72 MiB tier is a Linux systemd budget and is not an equivalent macOS RSS assertion.

## Basis and setup

Read `docs/design/plan.md` reconnect and budget sections, `docs/design/daemon-core.md` §§4.6, 6.2, 6.3, and `.meridian/work/tether-mvp/evidence/budget/README.md` (p155). Relevant documented bounds: 2 MiB connection credit + 64 KiB overdraft; 1 MiB capture reservation; 64 KiB output frames; `pause-after=3`; 16 queued uncharged connection replies (then the socket read pauses); 10 s ping / 25 s idle timeout; 69 MiB ceiling in the 72+ Linux tier.

Host at start: macOS arm64, 8 logical CPUs; `uptime` showed load averages 9.88, 8.12, 6.57 (shared host). No Docker. The daemon was `target/debug/tether`, same config/command shape as `web/e2e/shared/stack.ts`: private config/state/home/runtime dirs, `TMPDIR`, `XDG_RUNTIME_DIR`, `XDG_STATE_HOME`, `XDG_CONFIG_HOME`, `HOME`, and `TMUX_TMPDIR` under `/tmp/tether-meridian-501/bp-p160/`; config used `memory_budget_mib=72`, the selected tmux binary, and `socket_name`; launch was `tether --config <config> serve --allow-login e2e`, followed by `tether --config <config> device add bp-probe`. Each tmux used its own `-L bp160m34` or `-L bp160m37` server. The only sessions were `s1` (flood) and `s2` (healthy client).

A throwaway Node `ws` 8.22.0 client under `/tmp/tether-meridian-501/bp-p160/` spoke JSON protocol v1 (`hello`, `listSessions`, `watch`, `ping`, `resync`). A small Node bridge in a separate process proxied WebSocket upgrades to the daemon's private Unix socket and supplied the native device token as the subprotocol, analogous to the e2e dev proxy. The `yes`/mixed producer ran in the tmux pane. A second client watched `s2`; a pty-backed tmux client was attached to `s1` as the laptop analogue. It sent Ctrl-C and `printf 'RESUMED_…\n'` while the stalled watch was in flight.

Commands (all ran sequentially; no suite was run):

```sh
# For each version, use its binary and isolated root/socket:
ROOT=/tmp/tether-meridian-501/bp-p160/manual34 V=3.4 DURATION=10 TMUX_BIN=/tmp/tether-meridian-501/tmux/3.4/bin/tmux TETHER_TASK=/Users/jimmyyao/repos/tether SOCK=bp160m34 node /tmp/tether-meridian-501/bp-p160/start.mjs
# Same shape for DURATION=60 and DURATION=300.
ROOT=/tmp/tether-meridian-501/bp-p160/manual37 V=3.7b DURATION=10 TMUX_BIN=/tmp/tether-meridian-501/tmux/3.7b/bin/tmux TETHER_TASK=/Users/jimmyyao/repos/tether SOCK=bp160m37 node /tmp/tether-meridian-501/bp-p160/start.mjs
# Same shape for DURATION=60 and DURATION=300.
# 3.4 mixed-escape flood:
ROOT=/tmp/tether-meridian-501/bp-p160/manual34 V=3.4 DURATION=10 MIXED=1 TMUX_BIN=/tmp/tether-meridian-501/tmux/3.4/bin/tmux TETHER_TASK=/Users/jimmyyao/repos/tether SOCK=bp160m34 node /tmp/tether-meridian-501/bp-p160/start.mjs
# 3.7b mixed stream + slow-reader average (~7.6 KiB/s over 100 s):
ROOT=/tmp/tether-meridian-501/bp-p160/manual37 V=3.7b DURATION=100 SLOW=1 MIXED=1 TMUX_BIN=/tmp/tether-meridian-501/tmux/3.7b/bin/tmux TETHER_TASK=/Users/jimmyyao/repos/tether SOCK=bp160m37 node /tmp/tether-meridian-501/bp-p160/start.mjs
# Natural catch-up check, without a client `resync` request:
ROOT=/tmp/tether-meridian-501/bp-p160/auto/manual34 V=3.4 DURATION=10 TMUX_BIN=/tmp/tether-meridian-501/tmux/3.4/bin/tmux TETHER_TASK=/Users/jimmyyao/repos/tether SOCK=bp160a34 node /tmp/tether-meridian-501/bp-p160/auto/run.mjs
ROOT=/tmp/tether-meridian-501/bp-p160/auto/manual37 V=3.7b DURATION=60 TMUX_BIN=/tmp/tether-meridian-501/tmux/3.7b/bin/tmux TETHER_TASK=/Users/jimmyyao/repos/tether SOCK=bp160a37 node /tmp/tether-meridian-501/bp-p160/auto/run.mjs
# SIGSTOP only the WS client process (separate bridge stays running), 10 s stop after 4 s of yes:
ROOT=/tmp/tether-meridian-501/bp-p160/manual37 V=3.7b DURATION=10 STOP_DELAY=4 STOP_FOR=10 TMUX_BIN=/tmp/tether-meridian-501/tmux/3.7b/bin/tmux TETHER_TASK=/Users/jimmyyao/repos/tether SOCK=bp160m37 node /tmp/tether-meridian-501/bp-p160/start.mjs
```

The producer script `/tmp/tether-meridian-501/bp-p160/mixed.py` writes exactly 1 MiB of printable text plus ANSI color/erase/cursor escapes per second. For each pause test, the client stopped reading its WebSocket TCP socket before starting the producer, and sent JSON pings every 8 s while its process remained live. The reader-resume cases explicitly sent `resync`; the 5-minute case exercised the reconnect path after the same socket closed. `ps -o rss=,etime=,time=,%cpu= -p <daemon-pid>` was sampled once per second; `ps` time deltas below are process CPU time, and `ps` RSS is KiB. This is a single native run per condition, not a benchmark comparison.

## Observations by requirement

| Scenario | Expected from spec | Observed runtime evidence |
|---|---|---|
| `yes`, no read 10 s: tmux 3.4 | Queue/credit bounded; stalled watch catches up by snapshot; other session stays live. | Watch stayed `OPEN`; before resume only 0 output frames reached the client, ~1.3 KiB of initial JSON/snapshot payload had been handled; client-side `socket.bytesRead` was 69–132 KiB including protocol/control traffic. `tmux list-clients -F '#{client_control_mode} #{client_session} #{client_flags}'` showed control clients with `pause-after=3`. Laptop pty sent Ctrl-C and the marker; after `resync`, 28 output frames and a 798-byte snapshot restore included `RESUMED_34_10`. Sampled daemon RSS 20,512–20,976 KiB in the initial `yes` run. |
| `yes`, no read 60 s: tmux 3.4 | Same; no growth with stall duration. | Still `OPEN`; 0 output frames during stall, 98,718 socket bytes read (handshake/control included). After resume, 27 output frames and a 798-byte snapshot included `RESUMED_34_60`. RSS samples 20,432–20,816 KiB; CPU time rose 0.59→34.43 s over the ~60 s flood interval (about 56% of one core). Second healthy watch stayed open and `s2` capture contained its `HEALTHY_…` marker. |
| `yes`, no read 5 min: tmux 3.4 | Bounded state; if the socket remains, fresh snapshot; if idle policy closes it, reconnect must repaint from current tmux screen. | By 5 min the original WebSocket was `CLOSED` (client observed 1006 after resuming; daemon log recorded `end=Close(Idle)`, close code 4000). It had stopped receiving pings after the 16-entry own-reply queue filled; the 25 s idle timeout then closed it at about 3 minutes (170–179 s in the daemon logs). Daemon RSS peaked at 20,544 KiB; sampled RSS subsequently fell as low as 8,784 KiB and was 10,688 KiB at 5:04. Reopening and watching the same window returned one fresh 798-byte snapshot containing `RESUMED_34_300`; recovery took ~0.87 s. Healthy `s2` remained available and its marker was present. |
| `yes`, no read 10 s: tmux 3.7b | Same as 3.4. | `OPEN`; 0 output frames before resume; after `resync`, 27 output frames and a 798-byte snapshot included `RESUMED_37b_10`. RSS samples were about 20,624–20,816 KiB in the first run (21,728 KiB max in the later SIGSTOP run). `s2` healthy marker and laptop Ctrl-C/printf worked. |
| `yes`, no read 60 s: tmux 3.7b | Same; no growth with stall duration. | `OPEN`; 0 output frames during stall, 98,823 socket bytes read including control. Resume delivered 26 output frames; fresh 798-byte snapshot contained `RESUMED_37b_60`. RSS max 20,544 KiB. CPU time 0.63→36.92 s over ~60 s (about 60% of one core). Healthy session remained open and marker present. |
| `yes`, no read 5 min: tmux 3.7b | Same reconnect fallback. | Original socket was `CLOSED` by the same `Close(Idle)` behavior; client read ~65 KiB total before closure despite the 5-minute wait. RSS max 20,672 KiB, then 14,688–15,344 KiB at the end. Reconnect/watch delivered a fresh 798-byte snapshot containing `RESUMED_37b_300` in ~0.86 s; healthy `s2` remained live. |
| 1 MiB/s mixed ANSI stream, 10 s: tmux 3.4 | No unbounded per-client queue; resume/reconnect is current. | Stalled watch had 0 output frames during the pause, then 34 output frames and a 692-byte fresh restore containing `RESUMED_34_10`; RSS sampled 13,520–15,216 KiB. The producer wrote 1 MiB/s by construction. Healthy session and laptop pty remained responsive. |
| Mixed ANSI + slow read, 100 s: tmux 3.7b | A ~10 KiB/s consumer should not grow memory without bound; it should receive current state after catching up. | Client payload counter before catch-up was 776,143 bytes over 100 s = **7.6 KiB/s average** (the throttle was intentionally bursty: 1 ms read window every 80 s, so this is an average, not a smooth shaped link). At that point it had 14 output frames; RSS peaked at 15,920 KiB. After unrestricted resume it had 37 output frames and a 692-byte snapshot containing `RESUMED_37b_100`; the healthy session remained live. |
| SIGSTOP WS client, 10 s: tmux 3.7b | TCP stall should be bounded and recover on the same live socket if shorter than the idle timeout. | The separate WS-client PID was SIGSTOPed at 4 s into `yes`, then SIGCONTed 10 s later; the Unix-socket bridge stayed running. The original WebSocket was still `OPEN` on return; after `resync`, the 771-byte fresh restore contained `RESUMED_37b_10`. `s2` and the attached pty stayed responsive. Daemon RSS samples maxed at 20,736 KiB. |

### tmux and laptop evidence

While the no-read case was active, `list-clients` returned (3.4 and 3.7b):

```text
1 s1 attached,focused,control-mode,pause-after=3,UTF-8
1 s2 attached,focused,control-mode,pause-after=3,UTF-8
0 s1 attached,focused,UTF-8
```

This confirms tether's control clients carried `pause-after=3`; it does not independently expose a `%pause` notification or capture the exact `refresh-client -A` command. The observed no-read stream stayed bounded, and the attached non-control tmux client still accepted Ctrl-C followed by `printf`, with the marker visible on `capture-pane` within 0.3–0.5 s. A separate healthy WS watch in `s2` stayed connected over the 5-minute cases and observed its marker.

**Automatic catch-up without `resync`:** Expected: a starved watch snapshots when reading resumes. Both sockets stayed open; the first post-resume snapshot arrived automatically in 289 ms on tmux 3.4 after a 10 s stall (825-byte restore) and 215 ms on 3.7b after a 60 s stall (798-byte restore). Each restore contained the marker entered during the stall. The client sent no `resync`.

### Interpreting the 5-minute case

This is expected design behavior, not a reproduced defect: the 16-entry queue of uncharged `pong` replies is full while the peer does not read, so the connection task stops reading its socket; with no accepted client message for 25 s it closes with `Close(Idle)`/4000. The phone must reconnect and re-watch, which it does in this wire client: both tmux versions supplied the correct current screen (marker present) in a fresh 798-byte snapshot. The main version/duration matrix sent explicit `resync` after reopening the reader; the separate no-`resync` runs above establish that normal backpressure catch-up also delivers a fresh marker-bearing snapshot automatically.

## Issues, limits, and cleanup

- **No reproduced tether defect.** No file:line fix proposed.
- **Unconfirmed instrumentation detail:** the real tmux client flags prove `pause-after=3` was in force; I did not trace the `%pause` control notification or observe the literal `refresh-client -A pause` command on the wire. Thus the exact tmux-side pause transition is inferred from the configured control mode and bounded runtime stream, not directly instrumented.
- **Coverage limits:** native macOS has no cgroup hard limit; RSS samples (1 s) do not prove the Linux unreclaimable-ceiling calculation or the exact 2 MiB hub credit occupancy. The slow-reader average was bursty, not continuously bandwidth-shaped. SIGSTOP was exercised on 3.7b only; the process was stopped during an active flood, but the exact TCP frame offset was not instrumented.
- No source files were edited. Daemon, Vite/bridge, tmux servers, and the client were stopped. Temporary client scripts, logs, token state, and sockets under `/tmp/tether-meridian-501/bp-p160/` were removed after this excerpt was saved.
