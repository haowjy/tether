# Probe: gate S9 (tether setup --background on the real Mac) and S13

Repo /Users/jimmyyao/repos/tether at `main` (631133d or later). The Mac is Jimmy's own machine
(jimmys-macbook-air, Tailscale Standalone 1.104.2). Gate definitions: docs/design/setup.md
"Probe gates" S9 and S13. Earlier Mac gate evidence and conventions:
.meridian/work/tether-mvp/evidence/mac-gates/README.md.

Before anything: record the before-state (`tailscale serve status --json`, whether
~/Library/LaunchAgents/com.jimmyyao.tether.plist exists and its content hash, `launchctl print
gui/$(id -u)/com.jimmyyao.tether` exit, ~/.config/tether/config.toml hash if any, the state dir's
device list). Restore all of it at the end, and prove it (Serve back to its before-state exactly).

Then `cargo install --path . --locked` (the service runs ~/.cargo/bin/tether), and run what a
script can do:
- S13: plain `tether setup` refuses with the `--background` message, exit 1, nothing changed.
- Fresh `tether setup --background`: plist written, bootstrapped, published (Serve shows the
  tether-shaped handler), link/code printed, exit 0. `curl` the link from this Mac: expect the
  enrolment page or the device check's refusal, not a 502.
- Rerun: kickstart, new secret in Serve, verification waited for the new process (inode/pid
  changed), "Nothing else to change".
- Port 7851 held by another process (when tether isn't loaded): refuses before installing.
- A `PATH` containing `&` installs (plutil -lint passes on the installed plist).
- `tether teardown`: plist and entry gone; second teardown says "Nothing to remove".
- With the job booted out but plist present, setup brings it back.
Skip, and list as Jimmy's hand checks: the Background Items notification, Login Items toggling,
a second macOS account, an SSH session with no screen login, quitting the Tailscale app, the
phone. Don't quit or reconfigure the Tailscale app, don't touch other Serve entries, never touch
the default tmux server or Jimmy's tmux sessions, don't run `tailscale bugreport`. Don't paste the
path secret into the report or evidence (redact it).

Write evidence excerpts (no raw dumps, no secrets) to
.meridian/work/tether-mvp/evidence/setup-s9/README.md. Edit no source. Report each check
pass/fail with the evidence line, any bug found with repro, and proof of restore.
