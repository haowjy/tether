# Review: tether setup, round 3 (final)

Repo /Users/jimmyyao/repos/tether, `main`. Unpushed setup stack: f86c943, 5adb000, d548423,
ef6fb08, d1a6f7b, 37ff6ad "Simplify setup's structure", 631133d "Order foreground setup's
refusals before its changes". Spec docs/design/setup.md; decisions docs/design/decisions.md.

Round 2 asked for changes in p200 (correctness) and p201 (strict structure):
/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p200/report.md and p201/report.md;
p202's report says all were fixed: .../spawns/p202/report.md. Review the code as it now stands,
both lenses: (1) were round 2's findings actually fixed, without regressions (`tether serve`
behaviour: systemd Ready ordering, signal handling, Mac withdraw_unbound; the flock probe across
modes; every refusal before any grant/install/write; exit statuses); (2) is src/setup/ +
src/daemon.rs now the simple shape, or did the restructure leave parallel paths, cfg braiding,
or impossible states. Also any new defect. Docs (setup.md, running.md, CHANGELOG, src/setup/AGENTS.md)
must match.

This is the last review round for this target: rank findings, and mark which must be fixed
before shipping versus can be deferred. Don't run `tether setup`/`teardown` for real or touch
launchd, Tailscale Serve, or the default tmux server; cargo builds/tests and an isolated `-L`
`tether serve` are fine. Edit nothing.
