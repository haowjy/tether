# Review: tether setup, round 2 (strict maintainability)

Repo /Users/jimmyyao/repos/tether, `main`, unpushed: f86c943 (setup design), 5adb000 (shared
Serve publication plan), d548423 (setup/teardown, background service), ef6fb08 (move daemon
assembly from main.rs into src/daemon.rs, no behaviour change), d1a6f7b (plain `tether setup`
runs tether in the foreground on Linux; `--background` installs the service; Mac refuses the
foreground). Spec: docs/design/setup.md, docs/design/auth.md, decisions in docs/design/decisions.md.
The settled delta for the foreground is .meridian/work/tether-mvp/setup-foreground-spec.md.

Earlier round-1 reports (fixed since; tell a recurring concern from a new one):
/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p196/report.md and p197/report.md.

Review the whole setup change (5adb000..d1a6f7b) as the code now stands, for structure: src/setup/ (mod.rs is large: is the step sequence, foreground vs background split and platform cfg-gating the simplest shape?), src/daemon.rs's hook seam, src/auth/publish.rs's shared plan, and whether the code is something you'd recommend building on. Look for parallel mechanisms between the two setup modes, duplicated error mapping, cfg braiding, dead code, and the move that makes it dramatically simpler.

Do not run `tether setup` (either mode) or `tether teardown` for real, and don't touch launchd,
Tailscale Serve config or the default tmux server. You may run cargo builds/tests and the daemon
on an isolated `-L` tmux server with isolated XDG dirs. Edit nothing. Report findings with
severity, file:line, a concrete failure scenario, and the fix.
