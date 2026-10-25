# Setup: final cleanup from review round 3

Repo /Users/jimmyyao/repos/tether, `main` at 631133d (unpushed setup stack). Read the round-3
report in full: /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p203/report.md.

Implement S1 and D1–D6 and the three nits, as that report describes:
- S1: Store/Auth built in `daemon::open`; `Opened` gets Linux-only `auth()`/`serve_target()`;
  `run(self)` takes no hook; delete `Ready`, the generics and the no-op closure; foreground setup
  reads open → grant → publish → refresh → finish → init_tracing → run. Signals stay installed in
  `run`. `tether serve` behaviour must not change (systemd Ready after bind, Stopping on signal,
  Mac withdraw_unbound, exit 78 only for serve). Update src/setup/AGENTS.md's hook sentence.
- D1: the operator fact moves to Linux-only facts; both impossible branches go.
- D2: plain sequential checks; delete the enum/const and the tautological assertion; keep the
  runtime-dir cases in the test.
- D3–D6 and nits as written.

One commit on top: "Collapse setup's foreground daemon seam". No rebase, no push. Keep docs
accurate in the same commit. Verify: `cargo +1.85 check --locked --all-targets`, the same with
`--target x86_64-unknown-linux-gnu`, `cargo clippy --target x86_64-unknown-linux-gnu
--all-targets -- -D warnings`, `scripts/preflight.sh full`, and an isolated `-L` `tether serve`
(second instance exit 1, SIGINT/SIGTERM exit 0, `memory_budget_mib = 10` exit 78). Never run
`tether setup --background` or `tether teardown`; never touch launchd, Tailscale Serve or the
default tmux server; plain `tether setup` on this Mac only to see the refusal. Don't edit
generated agent dirs. Report per item.
