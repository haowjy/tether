# Can a Linux operator write Tailscale's Serve config without root?

tether is a Rust daemon (repo `/Users/jimmyyao/repos/tether`). On Linux it runs as a systemd user unit, as the login user. It is reached through Tailscale Serve, which proxies `https://<node>.ts.net` to `unix:/run/user/<uid>/tether/serve.sock`. Today the user publishes it by hand with `sudo tailscale serve --bg --https=443 unix:…`. We want a `tether setup` command that publishes with no sudo.

On the Mac, tether already writes the Serve config itself: `GET`, then `POST /localapi/v0/serve-config` with `If-Match`. See `src/auth/publish.rs` and `src/auth/localapi.rs`.

Answer from Tailscale's source, tag v1.94.0 and current main. Give file:line for each:
1. When a user has been made operator (`tailscale set --operator=$USER`), does LocalAPI let that uid `POST serve-config` over `/var/run/tailscale/tailscaled.sock`? Trace the permission check, PermitWrite or the newer ipnauth actor model, and say what grants write to the operator.
2. Does that write accept a `unix:` proxy target from a non-root caller, or is `unix:` restricted to root? Check every validation step on the serve-config POST path.
3. Can the operator read `serve-config` and `status` without root? tether already reads these today. Confirm.
4. Does `tailscale serve` (the CLI) work without sudo for an operator, and does it print a hint about `--operator`?
5. Anything that would make the write fail for a non-root operator: Funnel node attributes, cert provisioning, or the HTTPS-certificates tailnet setting. How does a client detect "HTTPS certificates not enabled in the tailnet"?
6. If the user is not operator, what error does the POST return (status code and body)? tether needs to recognise it to print the one-time `sudo tailscale set --operator=$USER` hint.

Also note anything relevant to a non-root `tether setup` on Linux that we haven't asked about.

Write the findings to `.meridian/work/tether-mvp/setup-operator-research.md`, with source links. Edit nothing else.
