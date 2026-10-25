# Setup foreground default: the spec delta

Jimmy's call (2026-10-25): plain `tether setup` runs tether in the terminal; `tether setup
--background` installs the service. `docs/design/setup.md` at f86c943 describes only the
background path. This file is the lead's settled delta; the lane that builds it folds it into
setup.md and decisions.md.

## The rule

- `tether setup` (Linux): checks, grants the operator if missing, starts the daemon in this
  process, publishes the Serve entry, issues an enrolment code, prints the link, QR, clipboard
  copy and code, then keeps serving in the foreground until SIGINT/SIGTERM. Exit 0 on Ctrl-C.
  First line: "tether <v> is running in this terminal; Ctrl-C stops it." Daemon logs follow the
  report on stderr.
- `tether setup --background`: everything setup.md says today, unchanged.
- `tether setup` on a Mac refuses before changing anything: "On a Mac, phones reach tether only
  through its LaunchAgent, which holds its port; run `tether setup --background`." Exit 1.

## Checks in the foreground

Same process, so the service-environment rows don't apply. Keep: not root, tmux on setup's own
`PATH` (or `[tmux] program`), tailscaled reachable, logged in, version, MagicDNS and certs,
operator, `TMUX_TMPDIR` needs no warning (the daemon sees it). Drop: the binary-path check
(`cargo run -- setup` works in the foreground), the service-environment comparison, systemd,
user manager, systemd version, cgroup controllers. `--config` is allowed in the foreground; it
is still refused with `--background`.

Grants: no linger (nothing outlives the terminal). The operator grant is the same as the
background path's.

## Already running

If tether's service is active, or any daemon answers on `local.sock` / holds its lock, the
foreground refuses before publishing: "tether is already running as your service. `tether setup
--background` restarts it and prints a new code; `systemctl --user stop tether` frees this
terminal's run." (Wording for a non-service daemon: "Another tether is already running (pid
<n> if known); stop it first.") Use whatever single-instance mechanism the daemon already has;
don't add a second.

## Publication and verification

The same plan, judge and compare-and-swap over `ServeTarget::Unix`, after the in-process daemon
has bound `serve.sock` (the judge identifies it by inode). The daemon's tailnet-state cache must
see the new entry at once, so the report's state is true when printed: refresh it in-process
rather than restarting. Verification is in-process (no `local.sock` polling), but the printed
link must be the origin the daemon itself reports.

## After Ctrl-C

The Serve entry stays. The phone gets `502` while tether is stopped and reconnects when it runs
again. The banner says so: "The Serve entry stays when you stop tether; `tether teardown` removes
it." `tether teardown` with no unit installed withdraws the entry only; it must not require one.

## Decision log entry (decisions.md)

"Setup runs in the foreground by default." Alternatives rejected: background by default
(Jimmy's choice was foreground); a foreground run on a Mac over loopback TCP (phones can't reach
it without launchd's socket, and a loopback port without the path secret is the Mac front's
known hole); clearing the Serve entry on Ctrl-C (a crash would leave it anyway, and a rerun
would churn the config).

## Gates

Add to setup.md's probe gates: S12 (pop-os): `tether setup` in a terminal publishes and the
phone enrols; Ctrl-C exits 0 and the phone shows the 502 then reconnects on a rerun; with the
service running, foreground setup refuses; `cargo run -- setup` works. S13 (the Mac): plain
`tether setup` refuses with the `--background` message and changes nothing.

## Code notes (lead, from reading main.rs at ae13307)

- The single instance is `runtime::Runtime::open`'s `flock` ("tether is already running",
  src/runtime.rs:20,65). The foreground's "already running" check is that error, refined with
  whether the systemd unit is active for the message. No second mechanism.
- The daemon's assembly (`serve`, `daemon`, `open_runtime`, `assemble_serve_front`,
  `start_file_api` in src/main.rs) lives in the binary, so `src/setup/` can't call it. Enabling
  refactor first, as its own commit: move it into the library (e.g. `src/daemon.rs`) with a hook
  for "sockets bound" so setup can publish then, and main.rs keeps only CLI dispatch.
