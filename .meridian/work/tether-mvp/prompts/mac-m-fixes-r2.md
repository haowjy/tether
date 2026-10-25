# Mac front: round-2 review fixes

Fix the findings from the round-2 review of commit a40b526 (the Mac Tailscale Serve front). The full review is in `meridian spawn show p186`; read it first. You wrote a40b526 (p185), so `--from p185` gives you that context.

## Must fix
- **R1:** `plan_publish` (`src/auth/publish.rs` ~192) refuses a `null` serve-config. Tailscale returns `null` for a profile that has never had Serve configured, so a first start on a fresh Mac never publishes. Treat `null` as an empty object. The tailnet-state read in `identity.rs` already does this. Look for a single parse both paths can share, so `null` handling lives in one place. Give the fake LocalAPI in the harness a way to start from `null`, and cover that in one case.
- **R2:** `canonical_origin` returns only *where* it refused, so the refusal messages lost their cause: Funnel, a TCP entry on 443, or the real sibling `/` handler (not the invented `/_`). Make it return a typed refusal reason, and render it per target (Mac and Linux). The messages must name the real cause and how to clear it, as `docs/running.md` (~129-130, troubleshooting ~331) and `docs/design/auth.md` promise. Update those docs if the wording changes.

## Also do (the review's non-blocking items)
- L1: log the canonical origin once from `run` after `publish()`, then delete the compensating watcher task, or make auth.md step 4 match the code. Prefer the code change.
- L2: `Publication` should hold the `MacFront`. Delete `ServeTarget::mac_front` and the dead refusal branch.
- L3: add `MacFront::generate(port)` to own the secret format, and drop main.rs's `path_secret()`.
- L4: one handler remover shared by `plan_publish` and `plan_withdraw`.

## Constraints
- Linux behaviour stays the same, apart from the clearer refusal messages.
- MSRV 1.85: no let chains.
- Keep `docs/design/` accurate.

## Verification
- `scripts/preflight.sh full`
- `cargo +1.85 check --locked --all-targets` on macOS, and again with `--target x86_64-unknown-linux-gnu`
- Run the plan probe on: null, {}, Funnel on, TCP on 443, another app's `/` handler, and an old tether handler on a different port. Paste each resulting message into your report.
- Real tmux tests: `TMUX_BIN` set to `/tmp/tether-meridian-501/tmux/3.4/bin/tmux`, then `3.7b`.

## Commits
Do not push. Commit your work as ONE new commit on top of a40b526 with subject "fixup! Add Mac Tailscale Serve front". The lead squashes it.
