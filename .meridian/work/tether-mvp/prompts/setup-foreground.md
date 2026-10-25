# Build: `tether setup` runs in the foreground by default

Repo /Users/jimmyyao/repos/tether, `main`. Unpushed commits f86c943 (setup design), 5adb000
(shared Serve publication plan), d548423 (`tether setup` / `tether teardown`, background service
only) implement `docs/design/setup.md`. Jimmy has decided plain `tether setup` runs tether in the
terminal and `tether setup --background` installs the service. The settled delta, rule and code
notes, is `.meridian/work/tether-mvp/setup-foreground-spec.md`: read it first, then setup.md,
`src/setup/`, `src/main.rs`, `src/runtime.rs`, and `src/setup/AGENTS.md`.

Two commits, in order:
1. **"Move the daemon's assembly into the library"**: an enabling refactor with no behaviour
   change. `serve`/`daemon`/`open_runtime`/`assemble_serve_front`/`start_file_api` move out of
   main.rs into a library module, with whatever seam setup needs to act once the sockets are
   bound (publish, refresh the daemon's tailnet-state cache, issue the code, print) before
   serving. main.rs keeps CLI dispatch. Keep the systemd `Ready` notify semantics exactly.
2. **"Run tether setup in the foreground by default"**: the `--background` flag, the foreground
   path on Linux, the Mac refusal, the reduced checks, the already-running refusal via the
   runtime flock, teardown working with no unit installed, plus the docs in the same commit:
   fold the delta into setup.md (current rule only, incl. gates S12/S13), the decisions.md entry
   it names, running.md and the device guide if they describe setup, CHANGELOG `[Unreleased]`,
   `src/setup/AGENTS.md`.

Judgement left to you: how the report and daemon logs share the terminal; how the in-process
code issue and verification work without `local.sock` polling, provided the printed link is the
origin the daemon reports. If something in the delta is wrong against the code, record it in
`.meridian/work/tether-mvp/setup-foreground-divergence.md` with the reason and do the right thing.

Verification: `cargo +1.85 check --locked --all-targets`, the same with
`--target x86_64-unknown-linux-gnu`, `cargo clippy --target x86_64-unknown-linux-gnu
--all-targets -- -D warnings`, then `scripts/preflight.sh full`. You may run the foreground path
on this Mac only to see the Mac refusal (it must change nothing). You may run the daemon only on
an isolated tmux `-L` server with an isolated `XDG_STATE_HOME`/`XDG_RUNTIME_DIR`/config; never the
default tmux server. Never run `tether setup --background` or `tether teardown`, never touch
launchd or Tailscale Serve config. Don't edit generated agent dirs. Commit both; do not push or
rebase. Report what changed, divergences, verification.
