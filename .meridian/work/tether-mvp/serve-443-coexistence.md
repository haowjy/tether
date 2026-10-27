# Port 443 on pop-os: tether's Serve entry and Meridian Flow's portless (2026-10-27)

## What happened

A Meridian Flow session removed tether's Tailscale Serve entry on pop-os at about
14:23 EDT, taking it for a leftover. Its note, on homebox:
`~/.meridian/git/haowjy-meridian-flow-docs/work/agent-definition-design/handoffs/for-tether-session-443.md`.
Cause: portless 0.15.0 (`portless.service`, `proxy start --port 443 --https`) binds 443
on every address. tailscaled's Serve listener holds 443 on the tailnet address
(100.95.150.35), and Linux refuses a wildcard bind beside a specific-address listener,
so whichever starts second fails. tailscaled starts first at boot. portless 0.15.12
binds loopback only; it lands with meridian-flow#1167 (open as of this note).

State checked from c312, read-only, 2026-10-27: `tailscale serve status` shows
`No serve config`; portless 0.15.0 is on `*:443`; tether is not running
(`/run/user/1000/tether/` absent, no user unit).

## Restore order (needs Jimmy: the merge, then sudo on pop-os)

1. Merge meridian-flow#1167.
2. On pop-os, in `~/gitrepos/meridian-flow`: `pnpm install`, then
   `sudo systemctl restart portless`. Check `ss -ltn | grep :443` shows loopback only.
3. `sudo tailscale serve --bg --https=443 unix:/run/user/1000/tether/serve.sock`
4. `tether setup --background` (installs the user service, so tether survives reboots).

## tether's own exposure (explorer p328, source read)

- tether's setup and teardown edit the Serve config through LocalAPI with If-Match
  compare-and-swap. They preserve other tools' entries and remove only handlers that
  tether's ownership matcher recognizes (`src/auth/publish.rs:216-227, 229-268,
  390-505`). The manual fallbacks in `docs/design/setup.md:366-367` and
  `docs/running.md:430-431, 453-457` (`tailscale serve --https=443 off`) remove the
  whole 443 entry, including other tools' handlers.
- tether is built around 443: `publish_target` returns `<name>:443`
  (`src/auth/publish.rs:190-213`), and background setup expects the origin
  `https://<name>` (`src/setup/mod.rs:122-126, 452-479`). The daemon's origin checks,
  iOS URL handling and the web origin already carry a non-443 port. Publishing on
  another port would need setup, publish and spec changes, not new security rules.
- On this Mac, tether's Serve route proxies to `http://127.0.0.1:7851/tether-…`.
  Meridian Flow's `pnpm dev` prunes Serve routes whose `127.0.0.1:<port>` target isn't
  listening (`meridian-flow/tools/dev/lib/tailscale-stale-routes.ts`,
  `lib/tailscale-lifecycle.ts:118-140`). So a Flow dev start while tether is stopped
  would delete tether's 443 route here. pop-os's unix-socket target isn't matched.
- Flow's `pnpm dev --funnel` publishes on 443 and 8443
  (`meridian-flow/tools/dev/lib/dev-share-ports.ts:19`), on the same node as tether.
