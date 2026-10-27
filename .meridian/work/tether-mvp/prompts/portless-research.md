# Research: portless, and how it coexists with Tailscale Serve on port 443

Jimmy uses "portless" on his Linux dev box (pop-os). Identify the tool: most likely
vercel-labs/portless (a local dev proxy giving apps stable `*.localhost` URLs instead
of port numbers), but confirm from its README and source. Then answer, citing the
README, docs and source files (with versions/commits):

1. Which address and port does its proxy listen on by default (e.g. 1355? 80/443?), and
   with which options? Does it bind `0.0.0.0`, `127.0.0.1`, `::`, or all interfaces?
   Does it use HTTPS/TLS (its own CA, trusted certs), HTTP/2, and does it need sudo or
   `CAP_NET_BIND_SERVICE` for 443?
2. What else it changes on the machine: `/etc/hosts`, DNS resolver, system trust
   store, environment variables (`PORT`), a daemon/service, ports it hands out to apps
   (range), anything that might take over a port another service holds.
3. How it would interact with a process that already listens on `<tailscale IP>:443`
   (Tailscale Serve binds the tailnet interface addresses only): on Linux, does its
   bind conflict (wildcard vs specific address with SO_REUSEADDR/SO_REUSEPORT), or
   would it fail, fall back, or pick another port? Quote the code path that binds.
4. Known issues about port conflicts, Tailscale, or 443 in its issue tracker.

Write nothing in any repo. Report the facts with links, and mark inference as such.

Context from the lead: Jimmy's project `/Users/jimmyyao/repos/meridian-flow` drives
portless through `tools/dev/` (read `DEVELOPMENT.md` "Dev server",
`tools/dev/lib/tailscale-lifecycle.ts`, `lib/dev-share-ports.ts`,
`lib/tailscale-stale-routes.ts`, `portless-routes.ts`). It adds Tailscale Serve routes on
ports 47000-54999 (`--funnel`: 443, 8443) and prunes routes whose `127.0.0.1:<port>`
target is not listening. Confirm or correct that reading, and say how portless itself
(its proxy, its HTTPS on `*.localhost`) relates to those Serve routes.
