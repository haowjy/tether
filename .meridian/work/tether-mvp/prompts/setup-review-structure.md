# Review the `tether setup` design: structure and correctness

Review a design, not code. Nothing is built yet. Find what's wrong before it is built.

## What changed (uncommitted, in /Users/jimmyyao/repos/tether)
- New spec: `docs/design/setup.md` (`tether setup` / `tether teardown`)
- `docs/design/decisions.md`: new section "## tether setup" at the end, plus "(superseded)"/"Changed" bullets on "`tether serve` is Linux-only for now" and "tether never removes its Serve entry"
- Touch-ups in `docs/design/auth.md` and `docs/design/plan.md` (Linux refusal text now names `tether setup`; CLI table; G1; module shape)
- `docs/running.md` restructured (reviewed separately for readability; check it here only for contradictions with the spec)

`git diff` shows the edits. Read `AGENTS.md` and `docs/design/plan.md` "Code structure and standards" first.

## Context
Jimmy asked for one command that installs tether as a background service, publishes on his tailnet and prints the link. Settled before design: setup installs the `contrib/` files (embedded), the unit's resource limits stay as they are, single-user only. Code the design builds on: `src/main.rs`, `src/auth/publish.rs` (Mac plan/judge/CAS), `src/auth/identity.rs` (`ServeTarget`, `canonical_origin`), `src/auth/localapi.rs`, `contrib/tether.service`, `contrib/com.jimmyyao.tether.plist`. Tailscale permission facts: `.meridian/work/tether-mvp/setup-operator-research.md` (designer also verified the `IsServingUnixAny` local-admin check first appears in tag v1.100.0).

## Risks to check (plus anything else you find)
- Linux publication via the operator grant + LocalAPI write: is the 403/401 handling right; is the order start → publish → restart sound; does generalising `plan_publish` to `ServeTarget::Unix` (matching tether's handlers by path or inode, plus the legacy `http://127.0.0.1:7850`) risk removing someone else's handler?
- The decision that the Linux daemon never writes Serve: does anything in auth.md still assume otherwise?
- Restart-on-every-run: acceptable, or does it break something (Mac path secret rotation, live sockets, the `Type=notify` start)?
- Checks: missing preconditions, wrong mechanisms (e.g. `systemctl --user show-environment`, `loginctl`, polkit, `dscl`, binding 7851 while launchd may hold it), messages that mislead.
- Teardown: order (stop, then withdraw) on both platforms; withdrawal matching without a live socket; idempotency.
- XDG mismatch reasoning; `current_exe` vs `~/.cargo/bin/tether` on Linux (resolves symlinks) and macOS.
- Structure: module split in `src/setup/`, sans-IO boundaries, whether the pure cores are the right ones, whether anything is over-built. Look for a simpler shape.
- Specs must state the current rule only; decisions carry the alternatives. Flag drift between setup.md, auth.md, plan.md, decisions.md and running.md.

Don't edit files. Report findings with severity (blocker / major / minor), each with the location and a concrete fix.
