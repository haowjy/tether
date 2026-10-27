# Does tether assume HTTPS port 443?

Repo `/Users/jimmyyao/repos/tether` (Rust daemon `src/`, web `web/`, iOS `ios/`, specs
`docs/design/`). `tether setup` publishes the daemon through Tailscale Serve, today on
the default HTTPS port 443. Find every place that assumes or hard-codes that port, or
would break if Serve published tether on another HTTPS port (e.g. `--https=8443`, origin
`https://pop-os.tail….ts.net:8443`):

- `tether setup` / `teardown` (how they call `tailscale serve`, what they check/print)
- the daemon's Origin / Host / `Sec-Fetch-Site` checks, `/auth/info` `browserOrigin`,
  cookie (`__Host-` prefix rules allow a port? check), node identity checks
- the iOS host registry and URL handling (`tether://add?host=…`), the proxy's
  `/auth/info` check, the web `platform/browser` origin binding
- docs: `docs/design/setup.md`, `auth.md`, `docs/running.md`, decisions.md entries on
  ports or Serve

Also: does setup refuse or clobber an existing Serve config on 443 owned by something
else? Report each finding with path:line and whether a non-443 port would work as is,
need a small change, or break. Edit nothing.

Context: another tool on the same nodes (meridian-flow's `pnpm dev`, see
`/Users/jimmyyao/repos/meridian-flow/tools/dev/lib/tailscale-lifecycle.ts`) adds and
removes Serve routes with `tailscale serve|funnel --https=<port> ... off`, uses 443/8443
in funnel mode, and prunes routes whose `http://127.0.0.1:<port>` target is dead. Say
whether tether's setup/teardown/serve would delete or overwrite another tool's routes
(e.g. `tailscale serve reset`, writing the whole config), and whether tether running
behind a localhost-port proxy (the Mac front, `--publish`) is exposed to that pruning.
