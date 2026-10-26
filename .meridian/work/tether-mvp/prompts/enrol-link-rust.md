# Put the enrolment code in the setup link (Rust + docs)

Repo: `/Users/jimmyyao/repos/tether` (Rust daemon). Work in the primary checkout. **Do not
commit, do not push, do not run any git write command.** Two other agents are editing
`web/` and `ios/` at the same time: touch nothing outside the paths listed below.

## Why

Jimmy, using tether on his iPhone today: "u should include the code in the link". Today the
setup report prints the origin and a QR of the origin, and the code on a separate line, so
enrolling means transcribing eight characters on a phone keyboard.

## The decision (settled; do not redesign it)

Link format: `<origin>/#code=<CODE>`, with the code exactly as printed, e.g.
`https://jimmys-macbook-air.tail852a76.ts.net/#code=7KQ4-XM2P`.

- **Fragment, not query string**: it never reaches the daemon and is never sent as `Referer`.
  Do not add server-side parsing of the code; the web app reads it from the fragment.
- The setup report's printed link line and its QR code both carry the code, so scanning the
  QR enrols. There is exactly one link on screen, not a plain one plus a coded one.
- `tether enroll` prints a plain `Host:` line (the iOS app wants the bare MagicDNS name) and
  puts the code in its `Browser:` link.

## Files

- `src/setup/report.rs`: `render_success` builds the link and the QR. Watch the OSC 52
  clipboard write in `print_success`, which currently encodes `report.origin` — it should
  carry the same link the report shows, so a copied link is the one with the code.
- `src/main.rs`: `enroll` / `enroll_on_mac` / `enroll_on_linux` print `Host:` and `Browser:`.
- Existing tests that assert the report text, the QR input or the enroll output. Update them;
  **add no new permanent test** (Jimmy's standing instruction). If a case is worth keeping
  only to try the feature, run it and delete it.
- Docs: `docs/design/setup.md` (the format, the report section around the sample output, and
  the "Not in setup → A code in the QR" entry that this supersedes), `docs/design/running.md`
  where it tells the reader how to enrol, `docs/design/decisions.md` (new entry: what
  changed, why the earlier rejection is now overridden, alternatives rejected — query
  string instead of fragment, deep link into the iOS app, keeping the plain link), and
  `CHANGELOG.md` under `[Unreleased]`.

Design context worth reading first: `docs/design/setup.md` (report and CLI sections),
`src/auth/token.rs::normalize_code` (codes are already case- and dash-insensitive, so the
code in the link needs no extra validation), `src/auth/store.rs::set_pending`.

## Constraints

- **Do not run `tether setup` or `tether enroll` against the live state.** A running
  LaunchAgent serves Jimmy's real tailnet right now, and `tether enroll` replaces the pending
  one-shot code he is about to use. Verify rendering with `cargo test` and, if you want the
  real CLI output, run the built binary with `XDG_STATE_HOME` and `XDG_CONFIG_HOME` pointed
  at a scratch directory. Never restart the LaunchAgent (`launchctl`).
- Minimum Rust is 1.85 (`rust-version`); the pinned toolchain is newer, so syntax stabilised
  later passes `cargo check` and fails the MSRV gate. Keep to 1.85-compatible syntax.
- Follow the surrounding code style; no new dependencies.

## Done means

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` pass, and
  `cargo +1.85 check --locked --all-targets` passes.
- The printed example (from your scratch run) shows one link carrying `#code=`, and the QR
  is built from that string.
- Report back: the exact new output as it reads on screen, the files you changed, what you
  rejected, and anything you found that the decision above did not cover.
