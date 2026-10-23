# Review 5: browser auth revision 5

**Reviewed:** `design/browser-auth.md` revision 5 (landed in `5a4e0c6`) and
`design/browser-auth-rev4-notes.md`, checked against `browser-auth-review-4.md`.
Tailscale claims were checked against the source at `/tmp/tsrc/main` (`main` `f8ad538`,
2026-10-22, `VERSION.txt` 1.105.0) and its tags `v1.94.0`, `v1.98.0`, `v1.100.0`,
`v1.102.0` and `v1.104.2`. Also checked against today's `src/auth/identity.rs`,
`src/main.rs`, `src/config.rs`, `contrib/tether.service`, `resource-limits.md` and
`client-architecture.md`. No gate was run; there is no Linux box with tailscaled here.

## Overall

Every review-4 fix holds as written. The origin rule is now one rule, the startup order
is right, and the socket now decides the lane, so the public-HTTPS seam holds by
construction. Rev 5 also added three moving parts, and the source shows that none of
them carries the weight the draft gives it:

- **The uid rule on `serve.sock`** is meant to keep anything that isn't Serve's HTTP
  proxy off the node lane. It misses the one real case: a Serve **TCP** forward to
  `serve.sock` (new in 1.102). That forward arrives with tailscaled's uid and passes on
  headers the client wrote itself (M1).
- **The version gate (≥ 1.100)** guards against the Tailscale operator, whom §3.2
  declares trusted. It doesn't stop the operator anyway: from 1.100 on, the
  operator can still re-point tether's origin without sudo (M2).
- **Two tailnet-state cells**, where one would do (L1).

The result is a little more complicated than it needs to be. The fix is to delete
mechanisms, not add them.

## The simpler shape

Let the serve config prove where `serve.sock` connections come from, and delete
the uid rule:

> `serve.sock` is named in exactly one place in the whole serve config (every `TCP`,
> `Web`, `Foreground` and `Services` entry, matched by `stat` identity): as the sole
> handler, `/`, of one HTTPS `Web` entry with Funnel off. Otherwise there is no
> canonical origin, and no node-lane request is admitted.

What it deletes:

- the `SO_PEERCRED` uid rule;
- the "tailscaled's uid" row in §3.3 and its failure policy;
- the accept-time close;
- the test fiction that the test's uid is tailscaled's;
- the untestable acceptance row "a connection whose uid isn't the fake LocalAPI's";
- the version gate, its rule row, the `Version` parse and its G7/acceptance cases (M2).

Then merge the two cells into one (L1). The §3.3 table drops from six rows to three:
`auth.toml`, whois, and one tailnet-state cell.

What survives unchanged: the two fronts, `Host: localhost` on `serve.sock`, exact
`X-Forwarded-Host`/`Origin`/`Sec-Fetch-Site`, the node rules, whois per request, D5
itself, and the flock startup.

## Did review 4's fixes hold?

| Review 4 | Rev 5 | Verdict |
|---|---|---|
| H1 `Host` is `localhost` | `X-Forwarded-Host` exact, `Host: localhost` on `serve.sock`, G2 and an acceptance row | **Holds.** One overclaim: "any other `Host` means the request didn't come through Serve's proxy" is a misconfiguration guard, not proof (M1) |
| H2 co-resident handler | sole handler; read at use within 10 s; re-check closes 4401; G7/G9 rows | **Holds for `Web` entries.** The scan misses `TCP` forwards to the socket (M1) |
| H3 socket in paste dir, no lock | directory → `flock` → unlink+bind → empty `paste/`; no `/tmp` fallback | **Holds.** Upgrade from today's directory is fine: `empty_dir` already leaves it `0700` and owned (`main.rs:236`) |
| M1 sudo from 1.100 | stated in §1, D1, running.md, G1 | **Cost holds; claimed gain is half false** (M2) |
| M2 uid isn't a lane | `serve.sock` / `local.sock` / later `public.sock` | **Holds.** The leftover uid rule is now redundant (M1) |
| L1 joined waiters | distinct addresses; acceptance row | **Holds** |
| L2 upgrade path, dead code | refusal message, logs, deletions listed | **Holds, but the detection misfires** (L2) |
| L3 keep-alive LocalAPI | 2 whois + 1 cells | **Holds.** tailscaled's LocalAPI server is a default `http.Server` (`ipnserver/server.go:532`), so keep-alive works |
| L4 Q-encoding, IDs, stat match | all three | **Holds** |
| L5 who holds connections | reworded | **Holds** |

The line references in `browser-auth-rev4-notes.md` for `resource-limits.md` (101, 201,
236, 267, 634, 655, 680, 696, 709–710, 906, "Still open") all point at the right text.

## Medium

### M1. A Serve TCP forward to `serve.sock` passes every node-lane check with headers the client wrote; the uid rule and the `Host` rule don't catch it (§3.5, §3.7)

- **Source:** from v1.102.0, a Serve `TCP` handler can forward to a Unix socket:
  - `cmd/tailscale/cli/serve_v2.go`: `ExpandProxyTargetValue(target, []string{"tcp",
    "unix"}, "tcp")`, then "For unix: targets, store the full "unix:/path" string as
    the forward address".
  - `ipn/ipnlocal/serve.go`: `CutPrefix(backDst, "unix:")` → `DialContext(ctx, "unix",
    socketPath)`.
  - Neither is in 1.94.0, 1.98.0 or 1.100.0. Both are in 1.102.0, 1.104.2 and `main`.
    The dev box runs 1.104.1.
  - `IsServingUnixAny` (`ipn/serve.go:274`) lists `TCP[*].TCPForward` and
    `Services[*].TCP`, so the feature is real and is gated like the HTTP one.
- **Failure:** take `sudo tailscale serve --bg --tcp=2222 unix:/run/user/<uid>/tether/serve.sock`,
  or the TLS-terminated variant, run beside tether's normal 443 publication. Serve
  then relays raw bytes, and the connection reaches `serve.sock` from tailscaled's uid.
  A tailnet client that the ACLs let reach port 2222 sends, by hand:
  - `Host: localhost`;
  - `X-Forwarded-Host: box.ts.net`;
  - `X-Forwarded-For: <the laptop's 100.x>`, which `tailscale status` lists;
  - `Tailscale-User-Login: jimmy@github`;
  - the canonical `Origin` and `Sec-Fetch-Site: same-origin`.

  Each check then passes:
  - the front rule: the uid is tailscaled's;
  - the `Host` rule;
  - the Tailscale check;
  - the canonical origin, which scans only `Web` entries, and the 443 entry is still
    valid;
  - admission;
  - whois for the laptop's address;
  - the node rules and the device lookup.

  That client gets a shell as Jimmy. Writing the forward needs root, and root is
  trusted. But §3.5 says the uid rule exists for exactly this kind of mistake, "a
  forwarder … that relays tailnet traffic with Serve's headers intact". The rule
  misses the forwarder that tailscaled itself provides, and a root-run public proxy
  pointed at the wrong socket passes it too.
- **Kind:** a class: "trust that a `serve.sock` connection is Serve's HTTP proxy". The
  uid and the `Host` value can't establish that, because both are equally true of any
  other path tailscaled or root opens to the socket. Only the serve config can.
- **Fix:** the rule in "The simpler shape" above. Count every reference to `serve.sock`
  across `TCP`, `Web`, `Foreground` and `Services`. Anything but the one sole-handler
  `Web` entry means no canonical origin, with one message naming the stray reference.
  - Delete the uid rule and everything it carries (listed above).
  - Keep `Host: localhost`, worded as a cheap misconfiguration check, not proof.
  - Add G7 and acceptance rows for a `--tcp` and a `--tls-terminated-tcp` forward to
    `serve.sock`, each refused.

  It costs no new read: the config is already in the cell.

### M2. The version gate guards against a trusted actor, and the 1.100 gain the draft claims is half false (§1, §2 D1 and "Why … 1.100", §3.7, §4)

- **Source:** `ipn/localapi/serve.go` `authorizeServeConfigForGOOSAndUserContext`
  inspects only `configIn`, the config being posted:
  `if !configIn.HasPathHandler() && !configIn.IsServingUnixAny() { return nil }`. A
  post that drops tether's `unix:` handler therefore needs only `PermitWrite`, which the
  operator holds. `tailscale serve reset` posts `new(ipn.ServeConfig)`
  (`serve_legacy.go:759-764`).
- **Failure:** on 1.104, a non-sudo operator runs `tailscale serve reset`, then
  `tailscale serve --bg --https=443 3000`. That re-points tether's origin at their
  own server with no sudo, which is exactly the service-worker attack §2 says 1.100
  prevents. So these claims are false:
  - §1 "only root can re-point tether's origin";
  - D1's gain "only root can re-point Serve";
  - the §2 paragraph on why the minimum is 1.100;
  - §4 "from Tailscale 1.100 only root can re-point it".

  Only "only root can add a handler *beside* tether" holds.
- **Contradiction:** §3.2 lists "root and the Tailscale operator" as trusted and out
  of scope. The gate's only stated purpose (the §3.7 row "Below it, the Tailscale
  operator can rewrite the config") is to defend against the operator. Non-operator
  users have no `PermitWrite` on any version. So within the threat model, the gate
  blocks nothing. Outside it, it doesn't stop the re-point. It still costs:
  - parsing `version.Long()` strings such as `1.104.1-t…-g…`;
  - a canonical-origin rule and refusal case;
  - a G7 case and an acceptance case;
  - the reason `/status` is needed on the node lane at all, beyond the self rule.
- **Kind:** one instance. It wears a "read security state when used" row, which
  makes it look load-bearing.
- **Fix:**
  - Delete the gate. State the floor as Tailscale 1.94, where `unix:` targets first
    appear.
  - State the sudo cost as a fact of tailscaled ≥ 1.100, which the dev box runs, not
    as a tether choice.
  - Correct the four claims to "from 1.100, adding a handler beside tether needs
    root; the operator, trusted, can still replace tether's publication".
  - If Jimmy wants the operator out of the trusted set, the honest control is "set no
    operator, or make Jimmy the operator". It belongs in running.md, not in a version
    check.

### M3. The dev proxy's stated fix doesn't keep other Unix users out, the threat D1 exists for (§2 "Next to D1")

- **Problem:** the Vite proxy listens on TCP and injects Jimmy's native token. The
  planned fix, "forwards the incoming `Tailscale-User-Login` … refuses requests
  without it", is a header any local process can write: any Unix user on the box
  connects to Vite's port and sends `Tailscale-User-Login: jimmy@github`. The proxy
  then relays that to `local.sock` with Jimmy's token, and it is admitted. The same
  rule as `client-architecture.md` §5.11 ("refuses callers that did not come
  through Serve") fails the same way. It is the D1(c) hole, re-opened whenever a dev
  server runs on a multi-user box. That box is the stated requirement.
- **Fix:**
  - The proxy listens on a Unix socket in a `0700` directory. Node's
    `server.listen(path)` works; Vite can run in middleware mode behind it.
  - Publish it with `sudo tailscale serve --https=8443 unix:…`.
  - The proxy then relies on the same `Host: localhost`, Serve-written headers.
  - Or it keeps TCP but injects no token, so a dev token never sits behind a port
    other users can reach.

  It's dev-only, so it can stay a follow-up, but the follow-up must state this fix.
- **Kind:** one instance. Older than rev 5, but rev 5's multi-user claims depend on it.

## Low

- **L1. Two cells where one does (§3.3).** The vocabulary already defines "tailnet
  state" as one thing. The table splits it into a serve-config cell and a `/status`
  cell, with separate triggers ("one `/status` read per 10 s while only native is").
  - **Fix:** one cell holding both answers, refreshed together, with one age, one
    30 s hold and one test. Native-only traffic then also reads about 2 KB of serve
    config per 10 s, which is noise.
  - **Also:** after a failed read, every request that finds the cell stale starts
    another read and waits up to 2 s. Serve the held value, if under 30 s, while one
    background read retries, so an outage costs no latency until the hold expires.
- **L2. The upgrade detection misfires on any loopback app (§3.7 "Upgrading").**
  "Some entry proxies to a loopback TCP address" matches Grafana on
  `127.0.0.1:3000` at `:8443`, and the message would tell Jimmy to `serve off` that
  entry. Since `Config.port` is deleted, the daemon can't know tether's old port.
  - **Fix:** match the old default target `127.0.0.1:7850` only.
  - **Or:** drop the branch, and make the no-origin message always give the publish
    command plus `tailscale serve status`. The `off` step isn't needed: `serve_v2`'s
    `applyWebServe` sets the `/` handler of the entry it's given.
- **L3. Startup with LocalAPI down is unspecified (§3.5).** Today `main.rs:121-126`
  exits when `Node::read` or `ServeConfig::read` fails, and the unit restarts it.
  With the cells, nothing needs LocalAPI at startup. Say that the daemon starts
  anyway and logs the origin once the cell first fills, so a boot before tailscaled
  costs no restart loop.
- **L4. D5 overclaims "every check".** A native socket's re-check reads `auth.toml`
  only. It never re-applies the allowlist, even though the allowlist is in the cell.
  Either re-check the login on native sockets too (it's free once the cell exists),
  or scope D5's sentence to what it covers.
- **L5. Drift in `client-architecture.md` that the notes file doesn't list.**
  - Line 325 maps `browserRefused` to reason codes (`ambiguous_origin`, `not_https`)
    "with the `tether` command that fixes it". Rev 5 makes it one message carrying
    `sudo tailscale serve` commands.
  - §5.11 has the proxy connect "as a local peer"; it now connects to `local.sock`.
  - Add both to `browser-auth-rev4-notes.md`.

## Checked and holding

- **The `unix:` sudo cost:** `IsServingUnixAny` in the authorization check, and
  `IsLocalAdmin` = root, or the operator who can run `sudo tailscale`
  (`ipnserver/actor.go:210-268`). The CLI posts the whole config, so every later
  change needs sudo, apart from `serve reset` (M2).
- **No serve-config change notification:** `ipn.Notify` has no serve field, so D5's
  premise holds.
- **`ServeConfig` fields:** `TCP`, `Web`, `Services`, `AllowFunnel` and `Foreground`
  (`ipn/serve.go:56-76`), as §3.16 parses them, plus `TCP` forwards (M1).
- **`/status?peers=false`:** `StatusWithoutPeers` (`localapi.go:851-854`) still fills
  `Self.UserID`, `Version` (`version.Long()`) and the self user, which is what
  `Node::read` uses today.
- **The startup order:** `flock` before unlink closes review 4's H3 in both orders.
  The lock dies with its holder. The second daemon exits 1, and the unit restarts it
  with backoff, which is acceptable.
- **The two fronts:** `local.sock` keeps the Tailscale check. That's right: if Jimmy
  ever publishes `local.sock` through Serve, the native lane still needs a token
  there.

## Verdict

**Approve with notes.** The model is right, and review 4's fixes hold. Before the specs
land:

- Fix M1 by deleting the uid rule and scanning the whole config.
- Fix M2 by deleting the version gate and correcting the four claims.
- Write M3's real fix into the follow-up.

All three are deletions or corrections. None changes D1–D5.

## Hypotheses (not checked)

- **A service worker the operator plants** (M2, only if the operator is untrusted):
  when tether's origin returns and the browser's update check fetches the planted
  script URL from tether, it gets a 404. Whether each browser then unregisters the
  worker or keeps the old one is not traced. If it keeps it, a `Clear-Site-Data:
  "storage"` header on `/` or `/sw.js` would evict it.
- **Services:** whether a Tailscale Service's `Web` handler with a `unix:` target
  gets the same `Host` rewrite and `X-Forwarded-*` hooks as a node entry. It is the
  same `reverseProxy`, but the Service path isn't traced. G7's Service case covers it.
- **Review 4's open hypotheses:** Safari's extended CONNECT, `IP_FREEBIND`, HA subnet
  routers and macOS sandboxing are still unprobed. They are carried in G2 and G3.
