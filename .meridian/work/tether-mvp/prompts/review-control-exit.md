# Review: control-client %exit and tmux version mismatch (uncommitted, on main)

Review the uncommitted working-tree change in /Users/jimmyyao/repos/tether (`git diff`;
source in src/hub/*, src/tmux/*, src/daemon.rs; docs in docs/design/daemon-core.md,
decisions.md, docs/running.md, CHANGELOG.md). Edit nothing; report findings with severity.

## What it is for

On Jimmy's dev box the daemon ran tmux 3.7b (first on PATH) against a 3.4 server. The
3.7b control client (`tmux -u -N -S <sock> -C attach-session -t '$S' -f pause-after=3`)
stays silent while stdin is open and prints `%exit` only after stdin closes / a signal;
one-shots work across the mismatch. The hub hit its 10 s reply timeout, respawned, and the
app showed "Connecting..." forever. Facts: .meridian/work/tether-mvp/pop-os-connecting-forever.md,
.meridian/work/tether-mvp/control-client-mismatch-live-verification.md. Brief that produced
the change: .meridian/work/tether-mvp/prompts/fix-control-exit-and-version.md.

Intended behaviour: `%exit` after Ready closes the client at once (detach path); `%exit`
before Ready is a startup failure counted as a crash (CRASH_WINDOW: respawn once, then end
the watch with Error); a version mismatch between `tmux.program -V` and the server's
`#{version}` is warned once per server instance and named in the watchEnded message; a
2 s startup deadline applies when a mismatch is known.

## Risks to check (plus anything else you find)

- The change also moves a freshly spawned owner's view from `Checking` to
  `Locating { owner }` (owners.rs ~133) and filters `Orphaned` views out of reconcile's
  Locate pass (reconcile.rs ~156). Are these correct and necessary, or do they change
  behaviour for healthy clients (respawn after a real crash, a session killed while its
  client starts, server restart)?
- Is the mismatch-conditional 2 s timeout the right shape? Alternatives to weigh: one
  startup deadline for every client; or no special timeout. Note a version mismatch is not
  always fatal (e.g. after `brew upgrade` the client may be newer than a still-running
  server and still work), so refusing to attach on mismatch is not acceptable.
- State added to EndpointState (server_version, program_version, mismatch_warned): is
  there a smaller model? Is server_gone cleanup right?
- `program_version` reading `-V` at startup: bounded, can't stall startup, correct parse.
- Sans-IO cores stay sans-IO (plan.md "Code structure and standards"); MSRV 1.85.
- Docs state current rules only and match the code; decisions entry lists rejected options.
