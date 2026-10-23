# Security and structure review: browser auth revision 4 (enrolled tailnet nodes)

Review `.meridian/work/tether-mvp/design/browser-auth.md` (revision 4) and its notes
`design/browser-auth-rev4-notes.md`. Revision 4 replaces the cookie of revisions 1–3
with admission of enrolled tailnet nodes (Serve's X-Forwarded-For → LocalAPI whois →
stable node ID), and moves the daemon from 127.0.0.1:PORT to a Unix socket in a 0700
directory with SO_PEERCRED so only tailscaled may present node identity. Earlier
reviews of the cookie design: `browser-auth-review-1.md`, `-2.md`, `-3.md`; read them
to tell a recurring concern from a new one. Research:
`tailscale-serve-node-identity-research.md`. Code it lands in: `src/auth/`, `src/http/`,
`src/main.rs`, `contrib/tether.service`; specs `docs/design/auth.md`, `plan.md` Security.

This is a new mechanism, so review it whole: is there a simpler model that meets the
requirements (tailnet now; public HTTPS later without redesign; several Unix users per
machine, each with their own tether; several revocable devices; room for scoped
guests; unlocked-device risk accepted)? Then attack it: forging node identity from the
box, another Unix user, another tailnet node, a shared-in node, a browser page on an
enrolled node (CSRF, DNS rebinding, WebSocket hijack), Serve config drift, whois
failure and latency, revocation timing, the native token path, upgrade from today's
loopback TCP deployment, and Tailscale version requirements (unix: targets ≥ 1.94).
Check claims against Tailscale source where they matter. Severity per finding; write
to `.meridian/work/tether-mvp/design/browser-auth-review-4.md` (or in your report if the
write is refused). Edit nothing else.
