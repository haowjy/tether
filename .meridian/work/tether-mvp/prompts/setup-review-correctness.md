# Review: tether setup and teardown (correctness)

Review commits 9343b6a "Share the Serve publication plan between the Mac front and setup" and
ae13307 "Add tether setup and tether teardown" on `main` of /Users/jimmyyao/repos/tether, as the
code stands. The spec is `docs/design/setup.md` (committed in f86c943); the shared publication
rules are in `docs/design/auth.md`; decisions are in `docs/design/decisions.md`.

What the change does: `tether setup` checks tmux and Tailscale, grants linger and the Tailscale
operator on Linux (via sudo), installs the embedded systemd unit or LaunchAgent plist, writes the
Tailscale Serve entry via LocalAPI on Linux (the Mac daemon publishes its own), restarts tether,
waits for the new daemon, and prints the link, a QR and an enrolment code. `tether teardown`
reverses the service and Serve entry but keeps devices, config and grants.

Risks to check, beside whatever else you find:
- Serve config writes: compare-and-swap with ETag, refusal classification (401 not-admin vs 403
  non-operator vs 412 conflict), never clobbering a non-tether handler, idempotent reruns.
- The Mac front regression risk from 9343b6a: the daemon's own publication path must behave
  as before (earlier reviews p186 fixed null serve-config, refusal causes).
- Service install: backup of a differing unit/plist, @HOME@/@PATH@ substitution and escaping,
  restart sequencing, waiting for the *new* daemon by local.sock inode (stale socket, timeouts).
- Teardown leaving the system consistent when a step fails midway; exit statuses vs the spec.
- Sudo invocations: argument construction, what happens without a TTY.
- `browserPending` mirrored in Swift (ios/TetherKit) and the fixture.
- LocalAPI status field names: Self's stable ID is `ID` in status (ipnstate.PeerStatus),
  `StableID` only in whois. A prior bug came from this; check new fields read the right names.

Do not run `tether setup` or `tether teardown` for real, do not touch the user's tmux default
server, launchd or Tailscale Serve config. You may run `cargo test` and read anything. Edit
nothing. Report findings with severity, file:line, and a concrete failure scenario.
