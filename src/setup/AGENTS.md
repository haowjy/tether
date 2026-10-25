# setup

`mod.rs` owns the foreground/background setup and teardown sequences and exit behavior.
The `platform` alias selects `systemd.rs` or `launch_agent.rs`; each owns its `Host` and
`TeardownHost`, platform commands and file discovery. Keep OS-specific branches inside
those modules, not in the shared setup sequence. Neither executor may bypass the
preflight checks in `mod.rs`. `checks.rs` and `install.rs` are pure policy: gathered
facts produce either a validated tailnet and warnings or check failures; per-platform
plans produce only that executor's actions. `mod.rs` shares the success-report tail.
`report.rs` owns success rendering, QR output, and OSC 52.

Foreground Linux setup runs the daemon in this process; after its sockets bind, its hook
publishes Serve, refreshes the daemon's tailnet-state cache, issues the code and prints
before daemon logs start. `daemon.rs` owns daemon assembly; keep the single-instance
flock there rather than adding a setup-specific lock.

Setup must not mutate a unit, plist, Tailscale Serve config, or grants until every
check has run and no error finding remains. Foreground setup never installs a service
or enables linger; stopping its process leaves Serve published. On a Mac, plain setup
refuses before changes and only `--background` installs the LaunchAgent. Teardown stops
before removing a running service file, withdraws only a matcher-recognized Serve
handler (also when no service is installed), and retains auth state, config, and service
drop-ins. Keep the shared Serve planner in `auth::publish`; do not add a second
setup-specific config rewrite path. This path must remain safe Rust.

The rules and probe limits are in `docs/design/setup.md`; user-facing behavior is in
`docs/running.md`. Update both with behavior changes. Build the pure modules on Linux
and macOS; executor and foreground runtime probe gates require real hosts and are not
simulated by unit tests.
