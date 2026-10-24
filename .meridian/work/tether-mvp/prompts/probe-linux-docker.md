# Probe: tether on Linux, in Docker on this Mac (no source edits)

Docker now runs here (29.6.2, linux/arm64). The Linux dev box (pop-os) is still unreachable, so prove in a container what doesn't need the real tailnet. You may write throwaway files under /tmp/tether-meridian-501/linux-<your spawn id>/ and evidence excerpts under `$MERIDIAN_ACTIVE_WORK_DIR/evidence/linux-docker/` (a short README.md with commands and results; no raw dumps). Do not edit the repo's source; report defects with file:line and a proposed fix. Remove containers and images you create when done (name them with your spawn id).

Read first: `docs/running.md` (install, systemd unit, CPU/memory caps), `docs/design/plan.md` (resource budget, principles), `docs/design/daemon-core.md`, and the repo's AGENTS.md.

Establish, on a Debian/Ubuntu container with Rust ≥ the pinned toolchain:
1. `cargo test --locked` and a release build pass on Linux (copy a clean `git archive HEAD` export in; don't bind-mount the checkout read-write).
2. Real tmux 3.4 and 3.7b built from source in the container (isolated `-L` sockets): the daemon serves a session; drive the web e2e's real-daemon terminal spec from Linux if practical (`web/e2e/shared/stack.ts` has an untested Linux `script -qfec` branch at ~line 208 — verify it works or report exactly how it fails). pnpm, never npm.
3. The systemd unit from `docs/running.md` in a systemd-enabled container: it starts, its caps (CPUQuota/MemoryMax or whatever the doc sets) are applied in the cgroup, restart behaviour, and tmux survives the daemon stopping (tmux is never the daemon's child — check the cgroup/KillMode so `systemctl stop` doesn't kill tmux).
4. Resource budget: idle RSS and CPU of the daemon with 0, 1 and 4 watching clients, and under a flood (`yes` in a watched pane) — compare to the budget the docs state. Use `/probe`'s measurement guidance (rule out errors, skipped work, noise).
What can't be checked without Tailscale (auth G1–G12), say so; don't fake LocalAPI beyond what the existing tests already do.
Report: per item pass/fail with the evidence excerpt, numbers vs budget, defects found.
