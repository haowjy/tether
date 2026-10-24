# Review: Mac front design, revised for Jimmy's answers (docs only, uncommitted)

Review the uncommitted design in the working tree of /Users/jimmyyao/repos/tether:
`docs/design/auth.md` (Overview, Threat model, Constants, "Reaching LocalAPI", "The Mac front",
CLI, Module shape, Crates, Mac gates M0–M8, Open risks), `docs/design/decisions.md` (Jimmy's
entries from "A Mac can host tether, behind a path secret" through "launchd's socket is taken by a
local module", and the "## The Mac front" section at the end), `docs/design/plan.md`,
`docs/running.md` ("Host on a Mac" and the troubleshooting rows), and
`.meridian/work/tether-mvp/mac-front-design.md` (build order) and `mac-front-probes.md`.
`git diff` shows everything against the last commit; nothing of the Mac design is committed.

Jimmy's answers (2026-10-24) that this revision must faithfully carry:
1. Only his account on the Mac, now and planned: the Mac host's stated precondition.
2. A LaunchAgent, no sudo, instead of p171's LaunchDaemon: starts at login, launchd holds
   127.0.0.1:7851 across crashes, stops at logout (phone can't reach the Mac then). With one account,
   defences that existed only for other accounts were to be deleted for simplicity. This revision
   deleted: unpublish on SIGTERM, `tether unpublish`, re-reading `ipnport` per request, reconnect on
   401/403, exit on a changed LocalAPI endpoint, gate M7's second-account checks.
3. Log upload off via `TS_NO_LOGS_NO_SUPPORT=true` in the macsys extension's tailscaled-env.txt; the
   revision concluded tether can't detect it (evidence in mac-front-probes.md) so it doesn't warn.
4. No `raunch` crate: a local `src/launchd.rs`, the one `unsafe` module, `deny(unsafe_code)` in lib.rs.
Linux must be unchanged.

Check: (a) each answer is carried consistently across all files, with no leftovers of the dropped
machinery or the LaunchDaemon; (b) the deletions are safe — in particular whether "tether never
removes its Serve entry" plus trusting macOS role accounts opens a hole the threat model doesn't
admit (port free after logout/bootout while Serve points at it; the iOS app's device token), and
whether dropping the LocalAPI endpoint defences is honestly stated; (c) whether anything else that
earned its place only through other accounts survived and should go, or something deleted was
actually load-bearing for a single-account Mac; (d) factual claims you can check (Tailscale source is
cloned at /tmp/tether-meridian-501/ts-src/tailscale at v1.104.2; launchd behaviour; the
`tailscale serve --https=443 off` stop command); (e) the build order matches the spec.
Read-only: edit nothing. Report findings with severity and file:line, most severe first.
