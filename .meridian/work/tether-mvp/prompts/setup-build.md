# Build `tether setup` and `tether teardown`

Implement the spec in `docs/design/setup.md` (commit f86c943), exactly as written. Read these first:
- `AGENTS.md`
- `docs/design/plan.md`, "Code structure and standards"
- `src/auth/AGENTS.md` and `src/http/AGENTS.md`
- `docs/design/auth.md`, the "Mac front" and "Canonical origin" sections
- the setup entries in `docs/design/decisions.md`

If the spec turns out wrong or impossible somewhere, follow the code's reality and record the divergence in `.meridian/work/tether-mvp/setup-build-divergence.md`: what you did instead, and why. Then fix the spec to state the new rule.

## Order
1. **Enabling refactor first.** Generalise `plan_publish` and `plan_withdraw` and the CAS loop in `src/auth/publish.rs` over `ServeTarget` (Unix and Loopback), so the Mac task, setup and teardown all share them. Add the LocalAPI pieces the spec lists: Status `Version`, `BackendState` and `CertDomains`; `prefs()`; and the typed 403 and 401 write errors. Add `browserPending` to `AuthInfo`, and mirror it in Swift (`ios/`), since Swift mirrors AuthInfo by hand. Keep the Mac behaviour identical apart from `browserPending`.
2. **`src/setup/`**, as in the spec's "Code structure": sans-IO `checks` and `install` with table tests; the `systemd` and `launch_agent` executors; `report` with the QR (`qrcode` 0.14, `default-features = false`) and OSC 52.
3. **Wiring.** The `Setup` and `Teardown` subcommands in `src/main.rs`. Change `contrib/tether.service`'s header comment, which says it isn't installed for you. Add a CHANGELOG `[Unreleased]` bullet.

## Constraints
- MSRV 1.85: no let chains. Check with `cargo +1.85 check --locked --all-targets` on macOS, and again with `--target x86_64-unknown-linux-gnu`.
- No `unsafe` outside `src/launchd.rs`.
- Platform code is cfg-gated; the pure modules build and test on both platforms.
- Keep the spec, `running.md`, `auth.md` and `src/setup/AGENTS.md` accurate in the same change.
- Keep no tests beyond what the spec names: the table tests and the fake-LocalAPI 403/401/412 cases.
- **Don't run `tether setup` or `tether teardown` for real on this Mac**: it is Jimmy's live machine, and the lead runs gate S9 with a prober afterwards. Don't touch `~/Library/LaunchAgents`, the Serve config, or Jimmy's tmux.
- To try the Linux side, the Docker images in `.meridian/work/tether-mvp/evidence/linux-docker/` may help. Cap any container with `--cpus 1`; Jimmy's box is busy.

## Verification
- `scripts/preflight.sh full`
- the MSRV checks above
- `TMUX_BIN` set to `/tmp/tether-meridian-501/tmux/3.4/bin/tmux`, then to `3.7b`, for `cargo test --test tmux_real`
- Print the setup and teardown output from a dry path if you build one, or the report renderer's output, in your report.

## Commits
Two commits:
1. "Share the Serve publication plan between the Mac front and setup" (the refactor)
2. "Add tether setup and tether teardown"

Don't push.
