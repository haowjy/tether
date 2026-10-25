# Review: setup output trim and 401 message (commits 35df7dd, 57cba05 on main)

Review the code as it stands in /Users/jimmyyao/repos/tether. Two small commits:

1. 35df7dd trims `tether setup`'s success report (`src/setup/report.rs`) to: mode line,
   change lines, notes, link, QR (terminal only), "Enrolment code: <code> (one device,
   10 minutes)". `daemon::init_tracing` now takes a default level: `tether serve` INFO,
   foreground setup WARN (`src/setup/mod.rs`). `src/auth/mod.rs` logs an unenrolled node
   at debug when `allow_unenrolled` (the enrolment page), warn otherwise. Spec:
   `docs/design/setup.md` "Output"; decision "Setup's report prints only what Jimmy acts
   on" at the end of `docs/design/decisions.md`; `docs/running.md`.
2. 57cba05 rewrites the 401 (`PlanError::NotLocalAdmin`) message: tailscaled 1.104 runs
   `sudo --other-user=<u.Name> --list tailscale` where `u.Name` is the GECOS field
   (tailscale/tailscale#21204), so the fix offered is `sudo usermod -c $USER $USER`.

Risks to check, beside whatever else you find:
- Anything that still needs the dropped lines: docs, probe gates (setup.md S1–S13),
  web/iOS copy, `tether enroll` output consistency, tests asserting old text.
- Piped (non-terminal) output still reads correctly; blank-line layout around the QR.
- WARN default for the foreground run hiding something Jimmy needs to see (e.g. shutdown,
  errors logged at info).
- The debug/warn split in auth: is `allow_unenrolled` exactly the enrolment-page path?
- Is the 401 advice correct and safe (`usermod -c` sets the whole GECOS field; teardown
  variant `sudo tailscale serve --https=443 off` scope)?
- Docs stay accurate and state the current rule only.

Report findings with severity; edit nothing.
