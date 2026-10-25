# Fix setup review round 2

Repo /Users/jimmyyao/repos/tether, `main`, unpushed: f86c943, 5adb000, d548423, ef6fb08, d1a6f7b
(tether setup/teardown, background and foreground). Read both round-2 reports in full:
- /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p200/report.md (correctness)
- /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p201/report.md (strict structure)
Spec: docs/design/setup.md; rules in AGENTS.md and src/setup/AGENTS.md.

Fix every finding in both. The lead's calls where they overlap or leave a choice:

- **Daemon seam:** split into `daemon::open(...) -> Result<Opened>` (budget, runtime dir, flock,
  binds) and `Opened::run(hook)`; register SIGINT/SIGTERM in `run` after the hook, so Ctrl-C
  during publication just ends the process. `tether serve` behaviour stays identical (systemd
  Ready ordering, Mac `withdraw_unbound` on an unbound front). Foreground setup opens before the
  operator grant, so "already running", budget and runtime-dir refusals come before any change.
  `serve_with_hook`'s unused parameters go with it.
- **Single instance across modes:** expose a non-blocking probe of the runtime flock from
  runtime.rs (the flock stays the only mechanism). Background setup refuses before any grant or
  install when a terminal run holds it ("tether is running in a terminal; Ctrl-C it, then rerun
  `tether setup --background`."). Teardown adds "A tether still runs in a terminal; Ctrl-C it."
  when it does. Add both to setup.md and gate S12.
- **Runtime dir:** foreground check that `config::runtime_dir()` is `/run/user/<uid>/tether`,
  message naming `XDG_RUNTIME_DIR`. Keep the matcher exact.
- **Exit 78:** the mapping moves into the `Command::Serve` arm of main.rs; delete the stringly
  `SetupError` wrapping it made necessary, where that falls out cleanly.
- **Structure:** the three moves in p201 (platform module behind an alias with one surface;
  checks return a validated tailnet value; one shared tail with `enum Mode`), plus its L1–L3 and
  the duplication/wrapper list (one runtime builder, per-platform install plans with no
  `unreachable!` or blanket dead_code allows, `FileState::Different(Vec<u8>)`, test-only wrappers).
  `PlanError` flattened as p201 L1 says.
- **Linger:** teardown prints the linger line only when `loginctl` says `Linger=yes`; running.md
  says so conditionally.
- **Device guide** (.meridian/work/tether-mvp/device-guide.md): an agent over SSH runs
  `--background`; the foreground is Jimmy's own terminal.
- **Tests:** keep the existing table tests passing; add a table test that the foreground check
  set excludes the service-only rows and includes the runtime-dir row (the lead wants this one).

Commits, on top (no rebase, no push): 1. "Simplify setup's structure" (behaviour-preserving:
platform alias, validated tailnet, shared tail, PlanError, wrappers); 2. "Order foreground setup's
refusals before its changes" (daemon open/run split, flock probe across modes, runtime-dir check,
exit 78, linger, docs, gate text). Keep setup.md/decisions.md/running.md/CHANGELOG accurate in
the commit whose code they describe.

Verify: `cargo +1.85 check --locked --all-targets`, the same with `--target
x86_64-unknown-linux-gnu`, `cargo clippy --target x86_64-unknown-linux-gnu --all-targets -- -D
warnings`, `scripts/preflight.sh full`. Exercise `tether serve` on an isolated `-L` tmux server
with isolated XDG dirs (SIGINT/SIGTERM exit 0, second instance refuses). Never run `tether setup
--background` or `tether teardown` for real; never touch launchd, Tailscale Serve config or the
default tmux server; plain `tether setup` on this Mac only to see the refusal. Don't edit
generated agent dirs. Report per finding: fixed, or declined with the reason.
