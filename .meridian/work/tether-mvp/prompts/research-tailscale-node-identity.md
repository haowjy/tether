# Can a backend behind `tailscale serve` tell which tailnet device sent a request?

tether is a daemon on loopback, published with `tailscale serve --https=443 http://127.0.0.1:PORT` (tailnet only, never Funnel). Today it authenticates browsers by the `Tailscale-User-Login` header that Serve adds, plus a per-device secret. We are weighing a design where the **tailnet device (node) itself** is the browser credential: tether keeps an allowlist of approved node IDs, and a request is admitted when Serve proves it came from an approved node. Answer from primary sources: tailscale's source code (`ipn/ipnlocal/serve.go` and nearby, on main and on a recent release tag), tailscale docs, and the LocalAPI client. Cite file:line or URLs.

## Questions
1. Exactly which request headers does Serve set or strip when proxying to an HTTP backend? We need `Tailscale-User-Login`, `Tailscale-User-Name`, `Tailscale-User-Profile-Pic`, `Tailscale-Headers-Info`, `Tailscale-App-Capabilities`, `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`. Does it strip client-supplied copies of each one, so they can't be spoofed by the remote peer? Is there any header carrying the peer's node identity: node name, node ID, stable ID, or tailnet IP?
2. If `X-Forwarded-For` (or similar) carries the peer's tailnet IP, can the backend call LocalAPI `whois` (`/localapi/v0/whois?addr=`) to get the node's stable ID, name, user, tags and key expiry? What does whois need: socket permissions, and does an unprivileged user's process get access to tailscaled's LocalAPI socket on Linux? tether already reads `/localapi/v0/status` and the serve config, so assume it has access.
3. What happens for tagged nodes, shared-in nodes (shared from another tailnet), and Funnel traffic (never used, but for completeness)?
4. Does a Tailscale feature already give per-device app authorization? Candidates: app capabilities / grants (`Tailscale-App-Capabilities`), `tsidp`, or device posture. Would it let the tailnet policy say "only these devices may reach tether"? Assess whether that's practical for a one-person tailnet.
5. Node key expiry and device removal: how they surface, and how fast a removed or expired node stops being able to connect.
6. Any version history: since when are the relevant headers set, and has the behaviour changed recently?

Also note anything that would make node identity unsafe as an auth factor for a remote shell. Examples: IP reuse after a node is removed, NAT or subnet routers making many devices share one tailnet IP, exit nodes, or `tailscale serve` on a different machine proxying in.

## Output
Answers per question with citations, then a short verdict: can a loopback backend behind Serve reliably and unforgeably identify the requesting node, and how? Mark anything you couldn't confirm from source.
