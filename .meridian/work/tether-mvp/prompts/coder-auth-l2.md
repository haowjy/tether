# L2: build browser admission (enrolled tailnet nodes) and static shell serving

Implement `.meridian/work/tether-mvp/design/browser-auth.md` revision 6, settled after
five review rounds (`browser-auth-review-1.md` … `-5.md`; read 4 and 5 for the traps).
Companion: `browser-auth-rev4-notes.md`. The accept loop and its limits live in
`design/resource-limits.md` §3.7 and are already built (`src/http/server.rs`,
`src/budget.rs`); extend them, don't duplicate them.

Scope, in coherent commits (each passing `scripts/preflight.sh full` on a clean export
of the commit: `git archive <sha> | tar -x -C /tmp/tether-l2-<n>`, `npm ci` in `web/`;
delete it after):
1. **Land the spec text** (§3 into `docs/design/auth.md`, §4 into `decisions.md`, §5 into
   plan.md, daemon-core.md, fs.md, ios-shell.md, client/browser-setup.md,
   client/connection-roadmap.md, running.md) — in the same commits as the code each part
   describes, not separately, so docs and code never disagree on `main`.
2. **Sockets and startup** (§3.5, H3 order): runtime dir checks (exit 78), `flock`, unlink
   + bind `serve.sock` and `local.sock`, `paste/` subdirectory; delete what §3.16 lists
   (`Config.port`, `DEFAULT_PORT`, `reaches`, `url_for`, `funnels_to`, the loopback
   check, the `/tmp` fallback); the upgrade message matching only the old
   `127.0.0.1:7850` target.
3. **Tailnet-state cell and whois** (§3.3, §3.6): one cell, 10 s age, 30 s hold, shared
   in-flight reads, one keep-alive LocalAPI connection; whois per node-lane request,
   never cached, waiting cap by distinct address. One deviation from rev 6, the tech
   lead's call: the background retry backs off (2 s doubling to 30 s) instead of a fixed
   2 s, per the "light on a busy host" principle; note it in the spec text.
4. **Canonical origin and browser admission** (§3.7, §3.8, §3.9): `serve.sock` named
   exactly once in the whole serve config as the only handler of one HTTPS entry with
   Funnel off; `Host: localhost`; exact `X-Forwarded-Host`, `Origin`, `Sec-Fetch-Site`
   rules; Funnel header refused; node rules (tagged, shared-in, subnet routers, the box's
   own node, login match after decoding); lanes by socket; `auth::admit` returning a
   grant (§3.17 seams; build no passkey or guest code).
5. **Enrolment, removal, live sockets** (§3.10–§3.15): one code for both kinds; node
   devices in `auth.toml` (unknown fields refuse that row); `/auth/info`,
   `/auth/node/session`, `/auth/node/enroll`, `/auth/node/remove`; the re-check closing
   sockets on revoke; `tether device` listing node devices.
6. **Static shell**: serve the built web UI from the daemon per the spec's static-shell
   rules (embedded, gzipped, per-route caps that refuse at once, 30 s stall deadline,
   the manifest name "tether <host>"). The web client is being rebuilt now by another
   agent (lane W0, editing `web/`, `scripts/preflight.sh`, `.githooks/`); embed whatever
   `web/dist` the build produces, and don't edit those paths. If embedding needs a build
   step change, describe it in your report instead of editing W0's files.

Risks to verify on the running daemon, not just in tests: forged `X-Forwarded-For` on
`local.sock`; a request whose whois fails (503, never "not enrolled"); a TCP forward or
second handler naming `serve.sock` (refused); revocation closing a live socket within
the re-check; two daemons racing for the lock; a stale socket from a crashed daemon.
LocalAPI on this Mac isn't a Unix socket: build a fake LocalAPI for the acceptance
checks in `tests/http_auth.rs` (§6), and say which probe gates (G1–G12) need the Linux
dev box. Keep existing native-token behavior working. Never touch the installed tether
service, Tailscale's serve config, or real tmux sessions. Add tests the spec's acceptance
table lists only where a socket suffices; no others. Commit messages end
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.
Report commits, what each verifies, failure modes exercised, gates left for Linux.
