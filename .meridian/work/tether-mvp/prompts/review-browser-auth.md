# Security review: tether's browser/PWA authentication draft

Review `.meridian/work/tether-mvp/design/browser-auth.md` before Jimmy (the owner) approves it. It specifies how desktop browsers and an installed phone PWA authenticate to tether's daemon. The daemon is effectively remote code execution for whoever holds a valid credential: its WebSocket drives Jimmy's tmux. Nothing in the draft is built yet. Edit nothing; report findings.

## Fixed inputs (don't re-litigate)
Jimmy chose Option A, built so Option C can be added later:
- A: the enrolment code yields an `HttpOnly` cookie, which is a typed browser device credential. Jimmy accepts that during the Tailscale-only phase, anyone holding his unlocked device can use the browser client.
- C (later): passkey unlock.
- Rejected: a token kept in JS storage; Tailscale identity alone.
Native iOS auth (`docs/design/auth.md`) stays as it is.

## Check against
- The current spec, `docs/design/auth.md`, and the code it governs: `src/auth/`, `src/http/` (middleware, `ws.rs`, routes), and `src/fs/` raw serving.
- `docs/design/client/browser-setup.md` (its "Required controls", "Deployment trap" and "Acceptance checks", plus the two gates an earlier review set: browser protection relative to native biometrics, and bounded static HTTP).
- `docs/design/daemon-core.md` §5.2 and §6.

## Risks to examine
Weigh these alongside whatever else you find:
- Cross-origin and same-site attacks from other tailnet machines; the draft claims `ts.net` is on the Public Suffix List. CSRF, and WebSocket hijacking.
- Cookie scoping and the port trap.
- Confusion between credential kinds: a cookie replayed as a bearer token and the reverse; requests carrying mixed or duplicate credentials.
- Null or missing Origin; reliance on `Sec-Fetch-Site`, including older browsers and WebKit; Host validation behind tailscale serve.
- What the public pre-enrolment shell exposes. Whether static serving is bounded.
- Enrolment brute force when two kinds share one pending code.
- Revocation and expiry on live sockets. Logout semantics.
- Whether the C seam is real or would force a rework.
- Whether the probe gates are the right ones.

Also check that the draft's claims about current code and about external facts (the PSL entry, the WebKit bugs, RFC 6265) are accurate where they matter. Check whether the proposed spec text is something a coder could build from without guessing.

## Output
Findings ranked by severity (blocker / high / medium / low). Each finding: the problem, a concrete attack or failure scenario, the section of the draft, and the fix. End with a verdict: approve, approve with changes, or redesign.
