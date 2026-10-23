# Revise the browser auth design: admit enrolled tailnet nodes, no cookie

Rewrite `.meridian/work/tether-mvp/design/browser-auth.md` as revision 4. You may edit that
file and write notes beside it in `design/`; edit nothing under `src/`, `web/`, `docs/`.

## Decision already made (by the tech lead, to whom Jimmy delegated auth)

A browser or installed PWA is admitted as an **enrolled tailnet node**, not by a cookie:
the daemon takes the peer address Tailscale Serve writes into `X-Forwarded-For`, resolves
it with LocalAPI `/localapi/v0/whois`, and admits the request when the returned node's
stable ID is in the enrolled-device list. Enrolment uses the existing `tether enroll`
code (typed into tether's first screen); the node becomes a device in `auth.toml`,
listed and revoked with `tether device`. Native iOS keeps its device token + Face ID.

Why: a cookie is a bearer secret that any other HTTPS server on the same hostname
receives (cookies ignore ports) and could replay; node identity gives a sibling server
nothing to replay. That removes rev 3's D1 (lifetime), D2 (sibling servers, revoke on
detection, spikes on plain HTTP, serve-config re-reads) and changes D3 (logout).

Evidence: `.meridian/work/tether-mvp/tailscale-serve-node-identity-research.md` (Serve
overwrites XFF and strips spoofed Tailscale-* headers; whois needs only LocalAPI read;
stable node IDs are never reused; tagged nodes carry no user headers; Funnel requests
are marked; no documented bound on removal propagation). Prior reviews:
`browser-auth-review-1.md`, `-2.md`, `-3.md`; keep every finding that still applies
(static-shell limits, accept loop, graceful shutdown M1, MiB units M2, stall deadline M3).

## Requirements to design against

1. Tailnet now: desktop browser, phone browser and PWA, native iOS.
2. Public HTTPS later (`docs/design/client/connection-roadmap.md`) without redesign: show
   where a portable credential (passkey) plugs in at `auth::admit`, build none of it.
3. Several Unix users per machine, each running their own tether on its own port: one
   user's daemon must never admit on the strength of another user's enrolment.
4. Several devices per user, each revocable. 5. Room for a scoped guest device later
   (read-only, one session, expiring); build nothing. 6. Unlocked-device risk accepted.
7. Resource limits: `design/resource-limits.md` (default budget 72 MiB, Jimmy's choice).

## Risks to settle in the text, not just name

- Node identity is ambient: any page open in a browser on an approved node can send
  requests. Keep exact Origin/Host/Sec-Fetch-Site rules; justify each.
- Local processes on the dev box can forge XFF to the loopback port; compare with today's
  `Tailscale-User-Login` trust and the enrolment-code gate.
- whois cost and failure: one LocalAPI call per request/connection? cache by IP or not
  (research says resolve current identity), fail-closed vs 503, live-socket re-check on
  revoke (the 10 s re-check already exists for native).
- A node shared into the tailnet, tagged nodes, Funnel requests, subnet routers.
- What "log out" means now; how the browser learns it isn't enrolled; what the
  pre-enrolment page may load.
- macOS: plan.md says the daemon runs on Linux only because macOS Tailscale has no
  LocalAPI socket; say what that means here.

Keep §2 as decisions with a recommendation; anything Jimmy must decide is only what
changes his workflow or risk. State the current rule only (no history of revisions in
the body; the disposition table can carry it). Write for a reader who has none of this
conversation. Report: what changed, open decisions, risks you couldn't close.
