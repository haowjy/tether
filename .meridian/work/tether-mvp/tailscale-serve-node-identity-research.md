# Tailscale Serve node identity research cache

Checked 2026-10-23. These are the primary source pages consulted and the relevant source spans.

## Source files

- Current Serve implementation: https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go (raw: https://raw.githubusercontent.com/tailscale/tailscale/main/ipn/ipnlocal/serve.go)
  - `addProxyForwardedHeaders`, approx. L1014-L1021: sets X-Forwarded-Host; sets X-Forwarded-Proto to `https` only when incoming TLS is present; sets X-Forwarded-For from Serve request context source IP.
  - `addTailscaleIdentityHeaders`, L1023-L1051: removes incoming user/login/profile, funnel marker and headers-info; funnels get only `Tailscale-Funnel-Request: ?1`; normal source is resolved via `WhoIs("tcp", SrcAddr)`; tagged nodes get no identity headers; users get login/name/profile and headers-info.
  - `addAppCapabilitiesHeader`, L1066-L1095: removes inbound app-caps header and conditionally writes the configured capability subset; no header for Funnel.
  - reverse-proxy calls these hooks in that order (near end of file, around L1740+ in raw file): https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go#L1740
- Recent release implementation: https://github.com/tailscale/tailscale/blob/v1.104.2/ipn/ipnlocal/serve.go (raw: https://raw.githubusercontent.com/tailscale/tailscale/v1.104.2/ipn/ipnlocal/serve.go). Compared on the relevant header hooks: same behavior as main. Also compared v1.92.3: https://github.com/tailscale/tailscale/blob/v1.92.3/ipn/ipnlocal/serve.go.
- LocalAPI whois: https://github.com/tailscale/tailscale/blob/main/ipn/localapi/localapi.go (raw: https://raw.githubusercontent.com/tailscale/tailscale/main/ipn/localapi/localapi.go), `serveWhoIsWithBackend` around L3142-L3298: requires `PermitRead`; accepts `addr` IP, IP:port or `nodekey:`; calls WhoIs; returns Node and UserProfile plus peer capabilities. (Use the versioned and current file for comparison if needed.)
- Node fields: https://github.com/tailscale/tailscale/blob/main/tailcfg/tailcfg.go (raw: https://raw.githubusercontent.com/tailscale/tailscale/main/tailcfg/tailcfg.go). Node has ID, StableID, Name, User, Sharer, Addresses, Tags, KeyExpiry; ID comment says control-plane-global and never reused after deletion as of 2025-01-06.
- LocalAPI permissions: https://github.com/tailscale/tailscale/blob/main/ipn/ipnserver/server.go and https://github.com/tailscale/tailscale/blob/main/ipn/ipnserver/actor.go. `actor.Permissions` grants read permission for Unix-socket clients; write is withheld on readonly/non-admin callers. LocalAPI whois itself rejects when `PermitRead` is false.

## Official documentation

- Serve identity headers, spoof-copy stripping, tagged-device omissions, shared-node identity, localhost recommendation, Funnel no identity headers, and v1.92 app-cap support: https://tailscale.com/docs/features/tailscale-serve
- LocalAPI identity lookup and distinction between user identity headers and tagged devices: https://tailscale.com/docs/concepts/tailscale-identity
- App capability semantics and LocalAPI/Serve forwarding: https://tailscale.com/docs/features/access-control/grants/grants-app-capabilities
- Serve CLI `--accept-app-caps` example and version: https://tailscale.com/docs/reference/examples/serve
- Grants source selectors and IP/host options: https://tailscale.com/docs/reference/syntax/grants
- Device posture scope/limitations, including shared devices and subnet router exclusions: https://tailscale.com/docs/features/device-posture/postures-and-attributes
- Device deletion immediately revokes access: https://tailscale.com/kb/1260/device-remove
- Node key default expiry (180 days), auth key expiry distinction: https://tailscale.com/docs/features/access-control/auth-keys
- Tailscale IPs stable while registered, but change when node rejoins after removal/reset: https://tailscale.com/kb/1033/ip-and-dns-addresses/
- `tsidp` is OIDC/OAuth provider for Tailscale user identity, not a node-identity source: https://tailscale.com/docs/concepts/tailscale-identity

## Caveat from code reading

Go ReverseProxy's outbound request starts as a copy of inbound headers. Tailscale explicitly replaces XFH and (for TLS) XFP and XFF when a Serve context exists; it doesn't explicitly delete XFP on plaintext HTTP, nor XFF if context is absent. The configured use case (`--https` reverse proxy) has context and TLS, so the source-IP XFF and `https` XFP are overwritten. Tailscale explicitly deletes all the listed Tailscale trust headers (including `Tailscale-App-Capabilities`) before setting any trusted values.
