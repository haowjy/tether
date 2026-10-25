# Connection roadmap and server settings

Status: product direction recorded on 2026-10-22. Tailscale is the first delivery
scope; public HTTPS is the intended next phase, subject to security design. Neither
this roadmap nor the browser research enables public access to the current daemon.

## Delivery order

1. **Tailscale first:** desktop browser, installable phone PWA, and native iPhone
   shell use the private tailnet deployment. Finish the approved minimal client and
   platform verification before adding another access mode.
2. **Public HTTPS next:** allow access to multiple machines, including machines
   outside Tailscale, through individually reachable and authenticated HTTPS
   endpoints. This is the preferred follow-up, not SSH-key support.
3. **Unified multi-server browser workspace if needed:** evaluate after the
   per-server browser deployment. It is not implied by supporting multiple native
   server profiles.

SSH/password options were discussed, but no SSH transport, password login, public
listener, relay, or credential scheme is approved for implementation by this roadmap.
Prefer evaluating passkeys for public authentication; exact enrolment, recovery,
revocation, session lifetime and reauthentication remain design decisions.

## Settings and client behavior

Use **Server** for a saved Tether endpoint, not “Tailscale connection.” A server
profile has a display name, HTTPS URL, and connection/authentication status. Keep
terminal state and saved drafts scoped to stable server/session identity; names and
URLs alone are not durable identity. Credentials belong to that server, never to
whichever profile happens to be active when a request completes.

- **Native:** provide Add server and a saved-server picker. Enter name and URL,
  validate/connect, then remember the profile. Multiple profiles need not mean
  simultaneous live connections: retain current resource caps and connect only as
  needed. The active machine must be clear before terminal input or file insertion.
- **Browser/PWA first phase:** the page's URL selects its server. No duplicate server
  URL setting is required. Multiple machines can initially be opened through their
  own URLs/installations, not through cross-origin requests from a central app.
- **Later unified browser picker:** requires explicit cross-origin authentication,
  origin policy, storage isolation and connectivity design. Do not enable wildcard
  CORS or forward one machine's credentials to another to make switching work.
- **Tailscale account/tailnet:** selected in the operating system's Tailscale app,
  not controlled by Tether's server picker. Report an unreachable endpoint without
  claiming to know whether the cause is Tailscale, DNS, the server, or a firewall.

## Authentication versus reachability

The first-phase trust model is settled in [auth.md](../auth.md): native clients use a
per-device bearer token behind the iOS Keychain/Face ID flow; browsers and PWAs are
admitted as enrolled Tailscale nodes, with the node trusted whole until removal.
Node admission exists only on `serve.sock` at the canonical HTTPS Serve origin and
requires the exact browser Origin, forwarded host and fetch-metadata checks. Whois is
read for each node-lane request; browser identity alone is not enough. The cookie
proposal in older browser research is rejected. This is not a public HTTPS contract.

Public HTTPS needs both **reachability** and **authentication**. A password or key
does not traverse NAT/firewalls. Each machine needs a reachable TLS endpoint, or a
separately designed tunnel/relay if inbound access is unavailable. No relay provider,
public domain or port-forwarding arrangement has been chosen.

The public phase must explicitly revise the tailnet-only trust model: authorization
without Serve identity, strong authentication, TLS termination, request/Origin/CSRF
controls, credential recovery/revocation, abuse/resource bounds, and browser/native
parity. Do not simply expose the existing loopback service or disable identity checks.
The current no-Funnel and tailnet-only deployment rules remain in force. Public
hosting is future work, not permission to change running service exposure. The node
lane does not extend to a public origin; passkeys remain the planned public-phase
seam, judged by `auth::admit` on their own socket, with a public hostname as RP ID.

## Implementation boundary

Share terminal UI, tmux protocol and reconnect state across clients. Keep endpoint
selection, transport and credential handling outside the terminal components so
public HTTPS can be added without another terminal implementation. Do not build
speculative transport/plugin infrastructure before the first browser adapter works.

Read [browser setup](browser-setup.md) for the PWA behavior and delivery contract,
[interaction behavior](browser-behaviors.md) for client UX, and
[auth.md](../auth.md) for current security invariants. Future public work must update
those subsystem specs and the decision log before changing production behavior.
