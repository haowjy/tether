# setup

`mod.rs` owns the setup/teardown sequence and exit behavior. `checks.rs` and
`install.rs` are pure policy: gather external facts in the platform executors, then
make findings/actions from those values. `systemd.rs` and `launch_agent.rs` own all
platform commands and file discovery; neither may bypass the preflight checks in
`mod.rs`. `report.rs` owns only success rendering, QR output, and OSC 52.

Setup must not mutate a unit, plist, Tailscale Serve config, or grants until every
check has run and no error finding remains. Teardown stops before removing a running
service file, withdraws only a matcher-recognized Serve handler, and retains auth
state, config, and service drop-ins. Keep the shared Serve planner in
`auth::publish`; do not add a second setup-specific config rewrite path. This path
must remain safe Rust.

The rules and probe limits are in `docs/design/setup.md`; user-facing behavior is in
`docs/running.md`. Update both with behavior changes. Build the pure modules on Linux
and macOS; executor probe gates require real hosts and are not simulated by unit tests.
