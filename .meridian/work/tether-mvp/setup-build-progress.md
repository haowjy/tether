# Setup build progress

## Pre-dev checkpoint

- Task directory is the primary checkout at `/Users/jimmyyao/repos/tether`, on `main` as required by the repository's initial-build workflow. Head is the settled setup design commit `f86c943`.
- The only pre-existing working-tree item is the untracked input prompt `.meridian/work/tether-mvp/prompts/setup-build.md`; preserve it.
- No source edits have started. The requested two-commit sequence is retained: publication enabling refactor first, then setup/teardown and docs.
- No PR is involved under this repository's workflow.

## Implementation plan

1. Make publication target-aware at the existing `ServeTarget` boundary. Share the pure matcher/plans and a three-attempt `If-Match` helper across Mac publish, Linux setup publish, and both teardown paths. Preserve Mac task behavior and redact all proxy URLs.
2. Extend LocalAPI with parsed status/prefs and typed 403/401 errors; make the existing `local.sock` auth-info reader platform-neutral and add the pending bit through Rust and Swift.
3. Add `src/setup` pure `Facts -> Findings` and install-action cores with only the spec's table tests; implement systemd and LaunchAgent executors, reporting, QR and OSC 52.
4. Wire subcommands before normal config loading so `--config` is reported by setup's own check. Update running/auth/setup/module docs, service comment and changelog in the setup commit.
5. Run focused tests first, then the requested full gate, both 1.85 checks, and real-tmux integration tests against the two provided binaries. Never invoke setup/teardown against this host's live user state.

## Evidence and risks to verify

- Linux publication requires `serve.sock` to exist because `ServeTarget::unix` captures device/inode at bind; setup must install/restart before planning publication.
- Teardown's Mac safety ordering is security-sensitive: read Serve before bootout, stop the listener before deleting its path-based handler, retain the plist if withdrawal fails.
- The current auth-info reader is Mac-only and fetches a Tailscale login header from LocalAPI; Linux setup can reuse it after making the Unix-socket HTTP path cross-platform.
- Avoid touching generated agent directories and Jimmy's live LaunchAgents, Serve config, and tmux as instructed.

## Review notes applied during the enabling refactor

- The Mac `/auth/info` origin/refusal and `browserPending` must come from one watch snapshot; separate reads could race publication completion and falsely make setup stop waiting. `Auth::browser_origin` now returns both values together.
- Swift defaults a missing `browserPending` to false so the unchanged protocol range still lets the new iOS app decode older daemons.
- Management-only `ServeTarget` constructors are distinct from canonical identity: a path-only Unix target cannot match by inode, and a port-only Mac target has no secret. Canonical-origin checks still require the live target.

## Implementation and verification outcome

- The publication refactor is committed as `9343b6a`. Setup/teardown, CLI wiring, service comment, and changelog are ready for the second requested commit.
- Setup checks and install action planning are sans-IO; the systemd and LaunchAgent executors consume those plans. Teardown has minimal platform inspectors so it does not depend on setup-only probes, and on Linux it can still stop/remove an active service if its unit file has already disappeared.
- The setup reviewer found four issues (root detection could fail open, Linux could leave an active service if the unit file was gone, Mac teardown used setup-only probes, and systemd bypassed the shared install planner); all were fixed and the follow-up review found no remaining P1/P2 issue.
- `scripts/preflight.sh full` passed, including Rust fmt/clippy/tests/release build and web checks (372 web tests).
- `cargo +1.85 check --locked --all-targets` and the same check for `x86_64-unknown-linux-gnu` passed.
- `cargo test --test tmux_real --locked` passed 18/18 with each provided tmux binary, 3.4 and 3.7b.
- `cargo run --quiet -- setup --help` and `teardown --help` passed. No live setup or teardown was run on this Mac. The report renderer was previewed with fake values; it printed the service status, published URL, QR, enrolment code and next-step instructions.
- No spec divergence was needed. The setup/running/auth docs match the implementation and the only remaining real-system verification is the design's S1-S11 probe gate, which the lead must run on safe targets.
