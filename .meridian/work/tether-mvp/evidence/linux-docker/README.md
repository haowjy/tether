# Linux Docker probe (spawn p139)

**Scope:** clean `git archive HEAD` export (`70e1fee`) copied into Debian 12 / aarch64 Docker container; Rust 1.94.1 (pinned). No repo source edited. This demonstrates Linux behavior in Docker Desktop, not Pop!_OS or tailnet behavior.

## Build and real tmux

Commands in the container:

```sh
pnpm --dir web install --frozen-lockfile
cargo test --locked
cargo build --locked --release
# tmux 3.4 and 3.7b release tarballs; ./configure --prefix=... && make -j2 && make install
/root/.cache/tether-tmux/3.4/bin/tmux -V
/root/.cache/tether-tmux/3.7b/bin/tmux -V
```

Results: `cargo test --locked` passed (169 tests across unit/integration suites; 0 failed); `cargo build --locked --release` succeeded; source builds reported `tmux 3.4` and `tmux 3.7b`.

Linux terminal path exercised with existing `web/e2e/shared/stack.ts` and the Chromium real-daemon spec (the stack's Linux `script -qfec ... /dev/null` path):

```sh
TETHER_E2E_REAL=1 TETHER_E2E_TMUX=3.4 TETHER_E2E_PORT=51240 \
  pnpm --dir web exec playwright test e2e/terminal/terminal.real.ts --project=chromium --grep 'types into the pane'
# 1 passed (3.5s)
TETHER_E2E_REAL=1 TETHER_E2E_TMUX=3.7b TETHER_E2E_PORT=51241 \
  pnpm --dir web exec playwright test e2e/terminal/terminal.real.ts --project=chromium --grep 'types into the pane'
# 1 passed (2.6s)
```

The real terminal rendered the `$ ` prompt, accepted `echo typed-ok`, and the spec confirmed it in `tmux capture-pane`. The existing helper's Linux `script -qfec` branch worked. Screenshot: [`terminal-connected-p139.png`](terminal-connected-p139.png) (1440×900, Chromium).

## systemd user unit

Ran the checked-in `contrib/tether.service` under a systemd-enabled Debian 12 container as a user unit. It became active and logged `effective_mib=72 tier="72+" control_clients=3 sockets=3 completion=true`; it also correctly warned that the Tailscale LocalAPI socket was absent. `KillMode=mixed`; `MemoryHigh=infinity`; `MemoryMax=75497472` (72 MiB); `CPUQuotaPerSecUSec=500ms`, period `10ms`; cgroup `cpu.max=5000 10000`, `memory.max=75497472`, and `cgroup.controllers=cpu memory pids`. The daemon's cgroup ended in `.../app.slice/tether.service`; the tmux server's was `.../init.scope` (tmux PID 131, daemon PID 140), confirming tmux was outside the unit.

Adversarial lifecycle: `systemctl --user kill --signal=SIGKILL tether` changed `MainPID=140` to `615`, `NRestarts=1`, `ActiveState=active`; `tmux -L p139sys has-session -t baseline` still succeeded. `systemctl --user stop tether` left the unit `inactive`, and that tmux session still succeeded.

**Compatibility finding:** this container's systemd 252 emitted `Unknown key 'RestartSteps'` and `Unknown key 'RestartMaxDelaySec'` for `contrib/tether.service:23-24`. Restart-on-failure itself worked, but the progressive restart backoff is ignored here. Suggested fix: document/check the minimum systemd version for these directives, or provide a compatible fallback for older systemd.

## Resource observations

Single-run measurements (release daemon; `/proc/<pid>/status` `VmRSS`, `/proc/<pid>/stat` CPU ticks, `CLK_TCK=100`, 6 s intervals; no A/B performance claim):

| Load | RSS | CPU | Work verification |
|---|---:|---:|---|
| 0 watchers | 5,848 KiB (5.71 MiB) | 0.000% | daemon idle, no control client |
| 1 confirmed watcher | 6,412 KiB (6.26 MiB) | 0.167% | page connected; control client ready |
| `yes` in watched pane | 14,160 KiB (13.83 MiB) | 8.167% | `capture-pane` returned repeated `y` lines (38 visible rows) |

The plan's idle RSS target is “under ~5 MB”; this one idle sample is slightly above it. Idle CPU was effectively zero. The unit's idle cgroup sample was `memory.current=794624` bytes, `memory.peak=1064960`, `oom_kill=0`; note this is cgroup-accounted memory, not process RSS. No client/flood measurements were collected inside that systemd cgroup.

Four simultaneously watching sockets cannot be measured with the documented defaults: `daemon-core.md §6.2` caps sockets at 3. An attempted fourth browser client hit the daemon's `over the connection cap` warning; maximum of three is policy, not a defect. In that attempt three WS handshakes were admitted, but the additional page did not complete a verified terminal watch, so no “3/4 watchers” resource figure is claimed.

## Boundary / not checked

Auth G1–G12, actual LocalAPI whois/status/Serve/Funnel behavior, real tailnet reachability, and real Pop!_OS systemd/cgroup configuration remain unverified without tailscaled and the unreachable Linux dev box. The only stand-in used was the repository's existing real-daemon e2e stack; no new LocalAPI mock was created. No iPhone checks were possible.
