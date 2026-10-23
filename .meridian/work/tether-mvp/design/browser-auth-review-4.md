# Review 4: browser auth revision 4 (enrolled tailnet nodes)

**Reviewed:** `design/browser-auth.md` revision 4 and `design/browser-auth-rev4-notes.md`
at `6798ad4` (rev 4 landed in `71c07a0`). Checked against Tailscale source, cloned
at `main` `f8ad538` (2026-10-22) and at tags `v1.92.3`, `v1.94.0`, `v1.96.0`,
`v1.98.0`, `v1.100.0`, `v1.102.0` and `v1.104.2`. Also checked against the current
`src/auth/`, `src/http/mod.rs`, `src/main.rs`, `src/config.rs` and
`contrib/tether.service`. I ran one local probe (H3). I had no Linux box with
tailscaled, so no gate was run.

## Overall

The model is right, and it is simpler than revisions 1–3. A node carries no secret,
so sibling detection is gone, and with it the whole class of findings from rounds 1
and 2. The Unix socket is the right way to make `X-Forwarded-For` trustworthy. I
looked for a simpler model that still meets the requirements and found none:

- **Serve's own headers:** they carry no node identity.
- **App capabilities:** node-wide, managed in the admin console.
- **A token for browsers:** this is the cookie problem again.

The draft is still wrong in three places that would ship broken or open:

- **H1. The Host rule refuses every browser request.** Through a `unix:` target,
  Serve rewrites `Host` to `localhost`.
- **H2. Any other app published on tether's host and port is same-origin with tether.**
  That app gets the whole shell through the node's ambient identity.
- **H3. The socket's directory is the paste directory, and binding the socket no longer
  locks out a second daemon.** Startup deletes the socket it just bound, or a second
  daemon steals the first one's socket.

D1's cost is also understated (M1). Since Tailscale 1.100, every serve-config write
that contains a `unix:` target needs root. That cost is also a security gain, and the
draft should claim it.

## The simpler shape

Collapse §3.6 to one rule:

> The canonical origin is the one HTTPS `Web` entry whose `Handlers` hold exactly one
> handler, `/` → `unix:<this daemon's socket>`. Anything else (none, several, a
> co-resident handler, a non-root mount, plain HTTP) refuses browsers with one reason
> that names the entry.

This deletes:

- the `browser_origin` config key;
- `ambiguous_origin`, `browser_origin_unpublished` and `not_at_root` as separate
  reasons;
- the G7 rows for `browser_origin`.

It also closes H2. Several publications of one tether is a state Jimmy can fix with
one `serve off`. It isn't worth a config key and two error codes.

Keep the rest of the shape: node lane and native lane, `auth::admit` as the one
policy, whois on every request, and the node rules.

## High

### H1. Through a `unix:` target, `Host` is always `localhost`, so the Host rule refuses every node-lane request (§3.7, G2)

- **Source:** `ipn/ipnlocal/serve.go` `reverseProxy.ServeHTTP`, identical in `v1.94.0`
  (line 917) and `main`:

  ```go
  // For Unix sockets, use the URL's host (localhost) instead of the incoming host
  if rp.socketPath != "" { r.Out.Host = rp.url.Host } else { r.Out.Host = r.In.Host }
  ```

  `rp.url` is `http://localhost` for every `unix:` target (`proxyHandlerForBackend`).
  The browser's host reaches the backend only in `X-Forwarded-Host`.
  `addProxyForwardedHeaders` sets that header from `r.In.Host`. Go's `ReverseProxy` in
  `Rewrite` mode deletes any inbound `X-Forwarded-Host` before `Rewrite` runs.
- **Failure:** §3.7 requires that `Host` equal the canonical authority. Built as
  written, every `/ws`, `/fs/*`, `/complete` and `/auth/node/*` request from a browser
  gets `403 bad_origin`, and the browser client never connects.
- **Why it was missed:** the 2026-10-21 probe in §3.4 ("forwards … unchanged") ran
  against a TCP target, where Serve does copy `Host`. G2 asserts the same for the
  socket, which is false. This is the Host-forwarding hypothesis from review 1, still
  open: it was settled for TCP, and D1 then changed the transport.
- **The rationale is also wrong:** "refuses DNS rebinding … before TLS would". Serve
  terminates TLS with a certificate for the tailnet name only, so a rebinding page
  never gets a request through. The Host check guards against a request addressed to
  another name the same entry answers. That reason stands.
- **Fix:**
  - Compare `X-Forwarded-Host` with the canonical authority, and require exactly one
    such field.
  - For a tailscaled peer, `Host` must be `localhost`. Anything else means the request
    didn't come through Serve's `unix:` proxy.
  - Correct G2, and add an acceptance check that sends `Host: localhost` with the real
    host in `X-Forwarded-Host`.
- **Kind:** one instance.

### H2. An app on another mount path of tether's host and port is same-origin, and gets the shell (§3.6, §3.7)

- **Source:** a Serve `WebServerConfig` maps mount paths to handlers (`Handlers
  map[string]*HTTPHandler`; `ipn/serve.go` `HasPathHandler` loops over them). So
  `tailscale serve --https=443 --set-path /grafana 3000`, or a `Path` handler serving a
  directory, adds a second app at `https://box.ts.net/grafana`. §3.6 makes an entry
  canonical when it "puts a proxy to this daemon's socket path at mount path `/`". It
  doesn't require tether to be the only handler.
- **Failure:** any page that app serves has tether's origin. Its own code, an XSS in
  it, or an HTML file in a served directory can:
  - open `/ws` (`Origin` is exact);
  - `fetch` `/fs/*` (`Sec-Fetch-Site: same-origin`);
  - post to `/complete`.

  All three are admitted under the node's identity. No header can tell these pages
  apart: same-origin is the boundary §3.7 relies on. On a dev box, mounting a second
  tool on `:443` is ordinary use, not an attack.
- **Drift:** the config is re-read only at startup and on `GET /auth/node/session`,
  which runs at shell boot. If a handler is added while tether is open, nothing notices
  until the next boot. Checked: the IPN bus `Notify` has no serve-config field
  (`ipn/backend.go`). So the daemon must read the config when it uses it.
- **Recurring:** round 1 M3 ("when does it refresh") and round 2 N1 ("browser state is
  refreshed only at … boot"). The class is security state derived from the serve
  config at events, not at use. The cookie is gone, but the class survives in the
  canonical origin.
- **Fix:** the rule in "The simpler shape" above: tether must be the only handler in
  its entry. Read the serve config at use:
  - on node-lane requests, sharing one cached answer up to 10 s old, single-flight;
  - in the 10 s socket re-check, closing with 4401 when the origin is no longer valid.

  The cost is one LocalAPI read per 10 s, and only while browsers are active. A failed
  read keeps the last result, as §3.6 says. Add G7 and acceptance rows for a co-resident
  `--set-path` proxy, a `Path` handler and a `Text` handler.
- **Kind:** the class move, if reads move to use time.

### H3. The socket lives in the paste directory, and unlinking it before bind removes the singleton lock (§3.3, §3.4)

- **Code:** `config::runtime_dir()` is `$XDG_RUNTIME_DIR/tether`. `main.rs:148-152`
  `empty_dir`s it, with `remove_dir_all` then `create_dir_all`, to make the paste
  directory. That runs *after* the listener binds, because `main.rs:145` says "Only
  once the port is ours: a second daemon started by mistake must not delete the running
  one's pastes". The TCP bind is today's singleton lock (`start_file_api` relies on it
  too).
- **Failure, either order:**
  - **Bind first, as today:** startup deletes `tether/http.sock` a moment after binding
    it. The daemon runs but can't be reached, and Serve answers 502.
  - **Empty first:** the draft's "removes a stale socket, and binds" takes no lock. A
    second `tether serve`, run by hand while the unit runs, unlinks the live socket and
    binds its own. It empties the running daemon's pastes and part files, and steals
    every new connection.
- **Probe:** in `/tmp/tether-rev4-probe/p.py`, a listener bound, then unlinked and
  rebound by a second listener: a new client went to the second ("first got nothing /
  second got the connection").
- **Also:** §3.4 refuses to start "if the directory exists with other permissions", but
  `empty_dir` recreates and chmods it, so the two rules fight. And `runtime_dir()`
  falls back to `/tmp/tether-<uid>` without `XDG_RUNTIME_DIR`. That is a predictable
  path another user can create first. The ownership check catches it; the published
  serve path `/run/user/<uid>` won't match it.
- **Fix:**
  1. Create and verify `$XDG_RUNTIME_DIR/tether/` (`0700`, ours).
  2. Take a non-blocking `flock` on `tether/lock` for the daemon's life. If it is
     held, exit with "already running".
  3. Only then unlink a stale `http.sock` and bind.
  4. Then empty `tether/paste/`, a subdirectory, not the whole directory.

  Refuse to start without `XDG_RUNTIME_DIR` rather than fall back. Update the
  "only once the port is ours" comments to "once the lock is ours".
- **Kind:** one instance, a broken invariant the draft didn't see.

## Medium

### M1. Since Tailscale 1.100, any serve config with a `unix:` target can be written only by root, so D1 costs more than "the serve command changes once" (§2 D1, §1, §3.3)

- **Source:** `ipn/localapi/serve.go` `authorizeServeConfigForGOOSAndUserContext`
  requires `IsLocalAdmin` when `configIn.HasPathHandler() || configIn.IsServingUnixAny()`.
  `IsLocalAdmin` means root, or the operator who can also run `sudo tailscale`
  (`ipn/ipnserver/actor.go` `connIsLocalAdmin`). `IsServingUnixAny` is absent in
  `v1.94.0`–`v1.98.0` and present from `v1.100.0` through `v1.104.2` and `main`. The CLI
  always posts the whole config (`serve_v2.go`: `GetServeConfig` → edit →
  `SetServeConfig`).
- **Consequences on the dev box (1.104.1 is current):**
  - Publishing tether needs `sudo tailscale serve …`.
  - Every later serve change on the box needs sudo, because the posted config still
    holds tether's `unix:` handler. That covers a spike on `:8443`, a foreground
    `tailscale serve 3000`, or `serve off` on another port.
  - Another Unix user can't publish their own tether. Root has to do it. The
    requirement "several Unix users, each with their own tether" holds only with root
    as the publisher.
- **The upside, unclaimed:**
  - From 1.100 on, only root can change where Serve sends traffic, or add a
    co-resident handler (H2), on a box that publishes a `unix:` target.
  - On 1.94–1.98, the operator can do both without sudo. On a box where the operator
    isn't Jimmy, that operator can re-point Jimmy's origin at their own server. Their
    server can then plant a service worker on tether's origin and survive the re-point
    back.
  - The threat model names neither the operator nor who may write the serve config.
- **Fix:**
  - Set the minimum to **1.100**, and say why: serve-config writes become
    admin-only once tether is published.
  - In D1's cost cell, add: "every `tailscale serve` change on the box needs sudo
    afterwards; root publishes each user's tether".
  - In §3.2, list root and the Tailscale operator as trusted (out of scope).
  - `running.md` uses `sudo tailscale serve`, and G1 records it.
  - Jimmy should decide D1 with the sudo cost in view.

### M2. The public-HTTPS seam's claim "such a connection isn't a tailscaled peer" is false for a front end running as root (§3.16, §3.4)

- **Problem:** a tailscaled peer is defined by uid, and tailscaled's uid is 0. A public
  reverse proxy (Caddy or nginx run as root, or anything root runs) that connects to
  the socket is therefore a tailscaled peer. A proxy that passes client headers
  through then lets an internet client:
  - send `X-Forwarded-For: <an enrolled node's 100.x>`;
  - send `Tailscale-User-Login: jimmy@…`, which passes the Tailscale check.

  That client is admitted on the node lane. The draft does say a public origin "must
  revise this section first", but §3.16 asserts the safety as if it were structural.
  The requirement says public HTTPS should arrive "without redesign".
- **Also:** within today's threat model, the uid check guards against little. Root and
  Jimmy are out of scope, and they are the only other uids that can connect. Its real
  value is confused-deputy protection: a forwarder Jimmy runs that relays tailnet
  traffic with Serve's headers intact. That is worth keeping, and §3.4 should say that
  is what it buys.
- **Fix:** tie the lane to the socket, not the uid alone.
  - **This phase:** Serve's socket is `serve.sock`. The node lane exists only on
    connections accepted there from tailscaled's uid.
  - **The public phase:** add its own socket, `public.sock`, whose connections never
    reach the node lane and ignore every `Tailscale-*` and `X-Forwarded-*` header.
  - **The listener:** the accept loop already inserts a `Peer` class; it becomes
    `Front::Serve | Front::Local`, where `Local` is the dev proxy and tests.

  This costs one more listener later and nothing now, and makes the seam claim true by
  construction.

## Low

- **L1. Waiters that join a single-flight call may count against the 16 (§3.5).**
  Built literally, one page loading 20 `/fs/raw` thumbnails would 503 itself. State
  that requests joining an in-flight call for the same address don't take a waiter
  slot, so the cap counts distinct addresses. Add an acceptance row.
- **L2. The upgrade from loopback TCP has no guided path (§5 running.md).**
  - **The daemon:** at startup it already reads the serve config. When the config still
    proxies to `127.0.0.1:<port>` and nothing to the socket, it should log the exact
    `sudo tailscale serve --bg --https=443 unix:…` command (and `tether enroll` print
    it). Until Jimmy runs it, the iOS app gets 502 with no hint.
  - **Code left behind:** `Config.port`, `DEFAULT_PORT`, `ServeConfig::reaches`, the
    `url_for(port)` and `funnels_to(port)` signatures, `small_buffers(&TcpStream)`, and
    `TETHER_PORT` in `web/vite.config.ts`. Delete them in the same change; config's
    "unknown keys are ignored" keeps old files parsing. §3.15 should list the
    deletions.
- **L3. whois opens a new LocalAPI connection per call.** Today's `identity::fetch`
  connects and handshakes for each call, which costs tailscaled an accept and a
  goroutine for every node-lane request. Keep one keep-alive client connection to
  LocalAPI, and have G4 measure both.
- **L4. Exactness nits in §3.5 and §3.6:**
  - Serve Q-encodes a non-ASCII login (`encTailscaleHeaderValue`), so compare the
    whois `LoginName` with the decoded header.
  - "Stable IDs are never reused" is documented for Tailscale's control plane only
    (`tailcfg.NodeID`: "global within a control plane URL … as of 2025-01-06"). Say so;
    a Headscale server makes no promise.
  - Match the socket path in the serve config by `stat` identity, as tailscaled's own
    `isTailscaledSocket` does, not by string, so `$XDG_RUNTIME_DIR` spelled through a
    symlink still matches.
- **L5. "Only tailscaled and Jimmy's own processes can connect" (§3.2) understates who
  can hold connections.** tailscaled opens one backend connection for each in-flight
  request from any tailnet node the ACLs let reach the box. That includes nodes the
  Tailscale check later refuses. The 64-permit DoS bound is "whoever the ACLs let
  reach port 443", as it was over TCP. Reword it.

## Checked and holding

- **Serve overwrites `X-Forwarded-For`** with `c.SrcAddr.Addr()` and deletes the
  inbound identity headers, Funnel's included. `Rewrite` mode strips inbound `X-Forwarded-*` first, and hop-by-hop
  removal comes before `Rewrite`, so a single, Serve-written value is guaranteed. Both
  hooks run for `unix:` targets in 1.94 and `main`.
- **`unix:` targets first appear in v1.94.0**: CLI scheme list and proxy handler;
  absent in v1.92.3.
- **whois** needs `PermitRead`, which every Unix-socket client has. It accepts a bare
  IP, answers 404 "no match" for an unknown one, and normalises 4-in-6 addresses.
  `nodeByAddr` includes the self node, so the self rule works for local users:
  tailscaled's kernel-mode `localListener` exists only for the box's own connections,
  and their source is the box's own address.
- **`serve-config` GET** needs only `PermitRead`, so a non-operator user's tether can
  derive its origin.
- **tailscaled's systemd unit** (`cmd/tailscaled/tailscaled.service`) sets no
  `ProtectHome` or capability limits, so root reaches `/run/user/<uid>`.
- **The native lane** is unchanged and unaffected by the uid. Lanes, CSRF,
  WebSocket-hijack and `<img>`/`<video>` defences are sound once H1 and H2 are fixed.
  The raw-file sandbox keeps raw HTML at an opaque origin, so its requests send
  `Origin: null`.
- **Revocation:** `device remove` acts at once for requests and within 10 s for
  sockets, and admin-console removal arrives through whois "no match".
- **Sibling drafts:** `client-architecture.md` already uses `/auth/node/*`,
  `browserOrigin` and `not_enrolled` consistently.

## Verdict

**Request changes.** The model stands. Fix H1–H3 before Jimmy decides D1–D3, and put
M1 into D1's cost cell, because it changes what D1 asks of him.

## Hypotheses (not checked)

- **Safari's HTTP/2 WebSocket (extended CONNECT) through Serve:** whether tailscaled's
  Go HTTP server advertises extended CONNECT, and whether `ReverseProxy` turns it into
  an HTTP/1.1 upgrade on the socket. Not traced; G2 covers it.
- **A local user forging another node's source address** (`IP_FREEBIND`) toward the
  `localListener`: I believe the SYN-ACK leaves on `tailscale0` and the handshake never
  completes, so whois sees only self. I had no Linux box to probe it.
- **HA subnet routers:** whether whois `AllowedIPs` of a secondary router omits its
  routes. If it does, a secondary router passes the routes rule until it becomes
  primary. Not traced in control-plane behaviour.
- **macOS:** whether a sandboxed Tailscale (App Store or standalone) can connect to a
  socket in a user's directory. It matters only if the daemon ever runs on a Mac.
