# Mac-host investigation: evidence and options

**Result:** the macOS Tailscale LocalAPI is reachable, but not through the Linux Unix-socket paths tether currently supports. A throwaway client successfully read real `whois`, `status`, and `serve-config` responses from this machine's Tailscale 1.104.2 macsys/system-extension install using its same-user-proof localhost TCP endpoint. The Tailscale Serve extension accepted Unix socket targets but did not connect to any tested target: all tailnet requests returned 502 and dummy backends logged zero accepts. The app-group container could not be accessed from this shell. So LocalAPI transport support looks implementable; the Serve front's viable macOS transport remains unproven. No repo edits were made.

## LocalAPI evidence

Installed CLI: `/Applications/Tailscale.app/Contents/MacOS/Tailscale`, `1.104.2`, Tailscale commit `c3430f0d2b8a1d646ad3ae867e3470bac07f1fe0` (reported by CLI). This installation is the **macsys/system-extension** variant: the live extension is under `/Library/SystemExtensions/.../io.tailscale.ipn.macsys.network-extension.systemextension`, not the Mac App Store `IPNExtension` process. Thus the matching discovery mechanism here is the macsys proof files, not the requested MAS `lsof` discovery path.

The throwaway client read `/Library/Tailscale/ipnport` (symlink target `55844`) and `/Library/Tailscale/sameuserproof-55844` (mode `0640`, owner `root:admin`, 21 bytes). Current uid 501 belongs to `admin`, so it could read the token. Requests to `http://127.0.0.1:55844/localapi/v0/{whois?addr=100.69.69.122,status,serve-config}` using HTTP Basic auth with the proof token all returned 200: whois identified the local node (`StableID nMM5jYAKHC11CNTRL`); status returned real Tailscale status JSON; serve-config returned `{}`. The same status request without auth returned 401 `auth required`.

Matching upstream implementation: [Tailscale v1.104.2 `safesocket/safesocket_darwin.go`](https://github.com/tailscale/tailscale/blob/v1.104.2/safesocket/safesocket_darwin.go). `InitListenerDarwin` binds `127.0.0.1:0`, creates a random token, writes `ipnport` and `sameuserproof-<port>` into `/Library/Tailscale`; macsys proof file is `0640` and chowned `root:admin`. Client reads the symlink/token and tests that the localhost port is live. The same file's App Store branch scans `lsof -n -a -u<uid> -c IPNExtension -F` for an open `sameuserproof-<port>-<token>` descriptor, then falls back to the macsys proof file and finally Unix socket. CLI's matching HTTP auth is [v1.104.2 `client/local/local.go`](https://github.com/tailscale/tailscale/blob/v1.104.2/client/local/local.go) (Basic auth token).

**Trust properties:** the endpoint binds IPv4 loopback and authenticates possession of the bearer token. The implementation does not check connecting process uid on each request. The macsys proof is readable by `admin`, so trust is admin-group-wide on this host, not strictly same-user; root can of course read it. The MAS `lsof` branch constrains discovery to files open by same-uid `IPNExtension`, but a token holder's HTTP access is still token-based rather than a per-request uid check. No MAS `IPNExtension` `lsof` row was present on this machine.

## Serve Unix target evidence

From a clean `git archive HEAD` export at `/tmp/tether-meridian-501/machost-mac_probe` (HEAD `43fab3872fe2129551064af5828774be8a0bf425`), the throwaway release build passed:

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
cargo build --release
```

All exited 0; Cargo reported `Finished release profile [optimized]`. It ran with isolated `tmux -L machost-macprobe` and a `tmux.socket_name` override, using only an isolated session. Daemon log reports no LocalAPI socket at `/var/run/tailscale/tailscaled.sock` or `/var/run/tailscaled.socket`.

With no pre-existing Serve config, `tailscale serve --bg --yes unix:/tmp/tether-meridian-501/machost-mac_probe/run/tether/serve.sock` was accepted and shown as tailnet-only HTTPS root proxy. Tailnet GET `/` and `/auth/info` each returned HTTP 502 with empty body. I then tested dummy Unix HTTP servers (socket mode 0666, user-owned parent dirs) with Serve targets under: `/tmp/tether-meridian-501/...`, `$HOME/Library/Caches/tether-serve-probe/...`, the spawn `TMPDIR` (`/tmp/tether-meridian-501/...`), and `/private/var/folders/ry/cf9zfx995857kyd13pk8_qcw0000gn/T/...`. Every path was accepted as a Serve config, every request returned 502, and no dummy server accepted a connection. Creating a target under `~/Library/Group Containers/group.W5364U7YZB.io.tailscale.shared` failed `Operation not permitted` (even listing the group container root from this shell was denied), so that path was not tested. `tailscale serve reset` was run after each config; final status: `No serve config`.

This confirms no tested Unix target worked, but does **not** prove sandbox denial as the cause: 502 plus zero backend accepts localizes failure before the backend, but extension logs / access to the app-group target are absent. Since no target succeeded, identity-header forwarding (the G2 question) could not be inspected on this Mac. Linux behavior must not be inferred from these 502s.

## What code and design would change

- `src/auth/identity.rs:24-27,314-349,543-558`: replace the fixed two-socket-only LocalAPI transport/discovery with a transport that can select macOS same-user-proof TCP (read port/token, authenticate requests) while preserving the existing Unix socket path and connection pools. `tailnet_state` at `351-397` and bounded/uncached whois at `400-454` already define the needed endpoints and semantics. Do not make LocalAPI availability a startup gate (`src/auth/AGENTS.md`).
- `src/runtime.rs:32-70`: currently binds `serve.sock` and `local.sock` under the private runtime directory. If an app-extension-accessible Unix path is found, its selection/configuration belongs here/config; ownership and `0700` parent boundary must remain explicit. Current evidence has not found such a path.
- If TCP Serve is considered, it is not just a target string change: `src/http/server.rs:66-70,114-120` accepts Unix listeners and classifies them as trusted `Front::Serve`/`Front::Local`; `src/http/mod.rs:97-138` trusts Serve-supplied identity headers and localhost Host; `src/auth/mod.rs:214-227,262-275` trusts Serve login/forwarded address then whois; `src/auth/node.rs` applies browser-origin rules. The TCP front would need a new trustworthy identity boundary and explicit distinction from native/local front.
- `docs/design/auth.md:238-280` canonical-origin rule currently requires the one root HTTPS Web handler to point exactly at `serve.sock` and rejects TCP forwards because they relay raw client-controlled `Host`, `X-Forwarded-For`, `X-Forwarded-Host`, and `Tailscale-User-Login`. Preserve that rejection unless a replacement provenance mechanism is designed and proven. Merely doing a LocalAPI whois lookup for the claimed XFF on each request does not restore trust: the client can forge that address too. A viable alternative must bind a verified peer to the accepted request independently (e.g., a transport that exposes authenticated per-connection peer identity or a signed/capability protocol); ordinary TCP Serve to loopback does not expose that in the current architecture. Rework auth.md's threat model, canonical origin, trust rules, and policy if that invariant changes.
- Relevant probe gates after any design change: G1 (publication/runtime boundary), G2 (headers and forgery), G3 (real whois/node admission), G4 (LocalAPI costs), G7 (TCP/Unix Serve-config classification), G9 (cross-origin), G11 (outage/revocation), G12 (resource caps), in `docs/design/auth.md:673-701`. Existing host Mac evidence does not discharge the specified Linux 3.4/3.7b and real-device gates.

## Options and recommendation

| Option | Cost | Trust / consequences | Auth design impact |
|---|---|---|---|
| **A. Add macOS proof-token LocalAPI client; keep Unix Serve front** | Moderate: OS-specific discovery, secure token handling and authenticated localhost HTTP in `identity.rs`; add tests/probes without changing auth callers. Need identify a working Serve target path first. | Trusts proof-token readers: currently admin group for this macsys setup; no peer-uid check. Existing Serve header trust remains unchanged. | Smallest auth.md change if a Unix path works: document macOS LocalAPI transport and test Mac variant. If no usable Serve path, this alone is insufficient. |
| **B. Require standalone `tailscaled` with accessible standard Unix LocalAPI socket and working Serve Unix target** | Low code cost, higher operator/setup cost: install/manage another daemon and avoid conflict with app-managed daemon. | Continues Unix socket access control; local socket's filesystem perms and Serve proxy remain security boundary. | Auth architecture mostly unchanged; document supported host setup. |
| **C. Switch Serve to raw loopback TCP and trust copied headers** | Low implementation cost, unacceptable security cost. | Clients can forge the request headers that currently prove node/login/origin; contradicts stated threat model. | Not acceptable under current auth.md; don't implement. |
| **D. Design authenticated per-request peer provenance for TCP front** | High: establish what identity TCP Serve exposes (if anything), create distinct front handling, alter node/native checks and admission order, bound additional lookups, prove revocation/outage/resource behavior. | Trusts a verified peer identity, not client-supplied forwarding headers. LocalAPI `whois` on arbitrary claimed XFF alone is not sufficient. | Major auth.md redesign and G1/G2/G4/G7/G9/G11/G12 re-probes; no evidence yet that plain loopback TCP offers required peer binding. |

**Recommendation:** pursue A only if a subsequent probe finds an app-accessible Unix socket path (or a documented/secure Serve proxy option) that actually works; otherwise B is the conservative route. Do not relax header trust or accept TCP forwarding on the basis of LocalAPI connectivity alone. The macOS LocalAPI problem is understood and transport-level; the macOS Serve-forwarding problem is still unconfirmed at root cause.

## Cleanup / scope

No repository files were created or modified. The throwaway archive/build and dummy proxy harness are under `/tmp/tether-meridian-501/machost-mac_probe`; daemon, dummy servers, isolated tmux server and Serve configs were stopped/reset. Existing unrelated processes were not used. No Funnel config was enabled.

## Lead follow-up: Serve to loopback TCP works (2026-10-24 18:47)

`tailscale serve --bg --yes http://127.0.0.1:18431` in front of a throwaway `python3 -m http.server` returned 200 over the tailnet (`https://jimmys-macbook-air.tail852a76.ts.net/index.html`) and the backend logged the request; `tailscale serve reset` after. So the app's Serve forwards to loopback TCP but to no Unix socket we tried: the 502s are the app extension failing to reach Unix sockets (consistent with its sandbox), not Serve failing generally. With the Tailscale app, a Mac host means a TCP front, which auth.md's trust model rejects as it stands.
