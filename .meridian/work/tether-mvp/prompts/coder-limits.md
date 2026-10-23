# Implement the resource limits

Build `.meridian/work/tether-mvp/design/resource-limits.md` revision 2 (read its
disposition table too; review: `design/resource-limits-review-1.md`). Default budget
72 MiB; tier boundaries stay at the spec's round values. Do not commit; report which
files belong to the change (the lead commits).

Scope: `memory_budget_mib` in config; the effective budget from the cgroup (spec's
five-step read; no cgroup on macOS = no limit, with the spec's warnings); the tier
table driving `Caps` (control clients, sockets, completion); `welcome.daemon.completion`;
the `limit` refusal naming the sessions holding the slots; exit 78 for every config
error; refuse uploads to tmpfs/ramfs with `409 memory_backed`; the bounded accept
loop (§3.7) on today's TCP listener, with the parts marked † (browser-auth-dependent:
Unix socket, peer class, whois rows) left out; the systemd unit (`MemoryMax=72M`, no
`MemoryHigh`, `CPUQuota=50%`, `CPUQuotaPeriodSec=10ms`, `RestartPreventExitStatus=78`);
`docs/running.md`, `docs/design/daemon-core.md` §6, `plan.md`, `fs.md`, `decisions.md`
(the spec's entry), and a CHANGELOG bullet. The web client shows the `limit` message
and hides completion when off — but the web UI is being rebuilt, so touch `web/` only
for generated types; note the client behavior needed in your report.

You own `src/config.rs`, `src/main.rs`, `src/http/**`, `src/fs/**`, `src/complete/**`,
`contrib/`, the hub's cap counting, `DaemonInfo`/`welcome` and the `limit` reason in
`src/proto/`, and the docs above. Another coder is working at the same time on
tmux history/wrap and owns `src/tmux/**`, the hub's history path, `HistoryChunk`; don't
edit those. Regenerate TypeScript types; don't hand-edit them.

Verify: `scripts/preflight.sh full`-equivalent checks (`cargo fmt --check`, clippy -D
warnings, `cargo test`), the real-tmux suite on isolated sockets
(`TETHER_TMUX_TESTS=1 cargo test --test tmux_real --test hub_real -- --test-threads=1`),
and exercise each failure mode on the running daemon where this Mac allows (config
error → 78, budget below floor, the limit message at the cap with a low budget, tmpfs
refusal can be checked only on Linux — say so). Never touch existing tmux sessions or
the installed tether service. Report changes, failure modes exercised, verification.
