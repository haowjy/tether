# Review: tether setup, round 2 (correctness)

Repo /Users/jimmyyao/repos/tether, `main`, unpushed: f86c943 (setup design), 5adb000 (shared
Serve publication plan), d548423 (setup/teardown, background service), ef6fb08 (move daemon
assembly from main.rs into src/daemon.rs, no behaviour change), d1a6f7b (plain `tether setup`
runs tether in the foreground on Linux; `--background` installs the service; Mac refuses the
foreground). Spec: docs/design/setup.md, docs/design/auth.md, decisions in docs/design/decisions.md.
The settled delta for the foreground is .meridian/work/tether-mvp/setup-foreground-spec.md.

Earlier round-1 reports (fixed since; tell a recurring concern from a new one):
/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p196/report.md and p197/report.md.

Focus on ef6fb08 and d1a6f7b, and how they interact with the rest. Risks: the refactor changing daemon behaviour (systemd Ready ordering, signal handling, shutdown, the Mac front's bind/withdraw path); the foreground's post-bind hook (publish before the daemon's cached tailnet state, the printed origin being the one the daemon reports, a failure in the hook leaving a half-started daemon); the already-running refusal via the runtime flock; Ctrl-C exit status and the Serve entry staying; teardown with no unit; the report and logs sharing the terminal; the reduced foreground checks (nothing service-only, nothing missing); docs (running.md, device guide, CHANGELOG) telling the truth about both modes.

Do not run `tether setup` (either mode) or `tether teardown` for real, and don't touch launchd,
Tailscale Serve config or the default tmux server. You may run cargo builds/tests and the daemon
on an isolated `-L` tmux server with isolated XDG dirs. Edit nothing. Report findings with
severity, file:line, a concrete failure scenario, and the fix.
