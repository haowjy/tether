# Review the resource-limits spec before it is built

Review `.meridian/work/tether-mvp/design/resource-limits.md` (default budget 72 MiB,
Jimmy's choice; a CPU cap in the systemd unit; a tier table that derives every count
cap from one budget). Read it against `docs/design/daemon-core.md` §6, `plan.md`
"Resource budget", `contrib/tether.service`, `docs/running.md`, and the code it
describes (`src/config.rs`, `src/http/`, `src/hub/`, `src/blocking.rs`).

Find what would make it wrong or hard to build: arithmetic in the ceilings, rows the
tier table misses, cgroup reading (v1/v2, nested, `max`, macOS where there is no
cgroup), the exit-78 refusal and restart policy, `CPUQuotaPeriodSec` support in the
systemd version, how a refused session shows on each client, and whether it is the
simplest model that meets "light on a busy host, capped where Jimmy chooses". Note
that browser auth is moving from a cookie to admitting enrolled tailnet nodes; the
accept-loop and static-shell rows stay. Write findings with severity to
`.meridian/work/tether-mvp/design/resource-limits-review-1.md` (or in your report if the
write is refused). No edits to the spec.
