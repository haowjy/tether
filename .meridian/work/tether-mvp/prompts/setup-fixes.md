# Fix the setup review findings

Repo /Users/jimmyyao/repos/tether, `main`. Two unpushed commits implement `tether setup` /
`tether teardown`: 9343b6a (shared Serve publication plan) and ae13307 (setup and teardown).
Spec: `docs/design/setup.md`; publication rules: `docs/design/auth.md`. Two reviews found
defects; read both reports in full first:
- /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p196/report.md (correctness)
- /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p197/report.md (spec alignment)

Fix every finding in both, except the two listed under "Hypotheses" (decide yourself whether the
bootout/bootstrap poll is cheap enough to add; if you add it, keep it small). The lead's calls:

- **HTTPS on Web entries (p196 #1):** tailscaled's `WebServerConfig` has only `Handlers`
  (`~/.meridian/ref/tailscale/ipn/serve.go`). Stop writing it, drop `WebServer.https`, keep the
  judge's `TCP[port].HTTPS` reading, fix setup.md/auth.md wording. A handler the plan re-adds
  unchanged at the same mount isn't "removed". Make planner/judge fixtures use the shape tailscaled
  stores; add one test that a rerun plan over the stored shape of its own output equals it (the
  idempotence the bug broke). That test earns its place; keep it.
- **Refusal text on Linux (p196 #4):** the Unix target's fix text names `tether setup`.
- **Teardown messages (p197 #8):** teardown's say "rerun tether teardown"; update the spec line.
- **Notes vs changes (p197 #4):** drop-in notices and "No tmux server yet" are notes, printed
  apart; "Nothing else to change." depends on changes only.
- **install.rs IO (p197 #9):** move the read into the executors so install.rs stays sans-IO.
- **Directory comparison (p197 #10):** move it into checks.rs with a table test; add the
  null-config publish case.
- **Code with no spec (p197):** add those behaviours to setup.md.
- **Decision log (p197 #3):** in `docs/design/decisions.md` under `## tether setup`, add entries
  with rejected alternatives for: Linux setup writes Serve as the operator through LocalAPI
  (rejected: root `tailscale serve` by hand each time; the daemon writing it); the Linux daemon
  never writes Serve (rejected: daemon publishes like the Mac — it has no grant at boot before
  setup, and two writers race); every run restarts (rejected: restart only on change — a rerun
  is how Jimmy applies config and upgrades); only `~/.cargo/bin/tether` (rejected: templating
  ExecStart — deferred, see "Not in setup"); systemd only (rejected: OpenRC/runit — no target
  host uses them); Mac refuses with a second account (rejected: warn — the Mac front's loopback
  defences assume one account); `browserPending` (rejected: setup inferring pending from error
  text). Fix the dangling "Teardown removes tether's Serve handlers" reference (add that entry or
  repoint it) and mark the `decisions.md` ~2570 "Costs" line as changed by the operator entry.
- **AGENTS.md wording** p197 flagged: fix it.

Commits: make each fix a `git commit --fixup=<sha>` onto the commit it belongs to (9343b6a for
publish/identity/localapi/auth.md/Swift; ae13307 for src/setup, setup.md, decisions, CHANGELOG).
Do not rebase, do not push. Rules: AGENTS.md at the repo root (MSRV 1.85: run
`cargo +1.85 check --locked --all-targets` and again with `--target x86_64-unknown-linux-gnu`;
`cargo clippy --target x86_64-unknown-linux-gnu --all-targets -- -D warnings` too, since the Linux
executors don't build on this Mac otherwise). Run `scripts/preflight.sh full` at the end.

Never run `tether setup` or `tether teardown` for real, never touch launchd, Tailscale Serve
config, or the default tmux server (`launchctl print-disabled` and other read-only queries are
fine). Don't edit `.claude/`, `.codex/` or other generated agent dirs. Report what you fixed per
finding, anything you declined and why, and verification.
