# Mac-side Tailscale Serve probe (p125)

**Outcome:** The pushed artifact was built, Serve accepted a tailnet-only Unix-socket config, and the daemon/tmux are left running for Jimmy. The user-facing Serve URL currently returns HTTP 502. Direct daemon requests return `503 identity_unavailable` because this Mac's Tailscale app exposes neither expected LocalAPI socket. This blocks almost all auth/browser gates; no admission checks were weakened, and no repo files were edited.

## Setup and live state

- Exported `git archive 96216b1` to `/tmp/tether-meridian-501/serve-probe/src`; built from the archive, not the shared dirty checkout. `pnpm --dir web install`, `pnpm --dir web build`, then `cargo build --release` all succeeded. The first cargo attempt before dependencies were installed failed because build.rs could not find `tsc`; rerunning in the required install/build order succeeded. Evidence: `evidence/serve-mac/p125-build-excerpt.txt`.
- Dedicated config uses `tmux -L serveprobe-p125`, system tmux 3.8, and one isolated session named `one`. It does not touch the default tmux server.
- URL: <https://jimmys-macbook-air.tail852a76.ts.net/>. Tailscale Serve status shows only `/ proxy unix:/tmp/tether-meridian-501/serve-probe/runtime/tether/serve.sock` and labels it **tailnet only**. `tailscale funnel status` shows the same tailnet-only entry; no Funnel publication is active.
- The requested `tailscale serve --https=443 unix:<path>` form errored `Error: invalid argument format`. The accepted command was `tailscale serve --bg --yes unix:<path>` (Serve's default HTTPS port is 443). Config succeeded, but HTTPS requests all failed with 502. Curl confirmed the tailnet hostname resolved to `100.69.69.122`, TLS certificate verification passed, then HTTP/2 502. Chrome via agent-browser showed Chrome's “HTTP ERROR 502” page; screenshot: `evidence/serve-mac/p125-chrome-serve-error.png`.
- Daemon logs: `no tailscaled LocalAPI socket at /var/run/tailscale/tailscaled.sock or /var/run/tailscaled.socket`. Direct `serve.sock` requests with `Host: localhost` return JSON `503 {"error":"identity_unavailable"}`. `tether enroll` reports `Host: unknown` and `Browser: tailnet state is unavailable (...)`. Socket/runtime perms are `0700` directory and `0600` sockets/lock. Evidence: `evidence/serve-mac/p125-setup-and-config.txt`, `p125-direct-daemon-evidence.txt`, `p125-enroll-output.txt` (code redacted), `p125-tls-and-502.txt`.
- The process is apparently unable to complete a Unix-socket proxy request through the Mac Tailscale app; Tailscale's output gives no cause beyond the 502. A Tailscale TCP forward is not a faithful workaround: auth.md explicitly rejects it as canonical origin and its raw-header trust model is different, so none was configured.

## Gate results

| Gate | Result | Evidence / limit |
|---|---|---|
| G1 (Mac equivalent only) | **Partial / blocked** | Tailscale CLI accepted and displayed the Unix `serve.sock` target on HTTPS 443, but all proxied HTTPS requests returned 502. The requested exact `--https=443` form itself errored; accepted syntax/default port above. Runtime ownership/modes were observed. Linux sudo requirement, later root-only changes, and cross-Unix-user EACCES are out of scope. |
| G2 | **Blocked** | Tried GET `/`, `/auth/info`, `/auth/node/session`, POST `/auth/node/enroll` with forged `Tailscale-User-Login` and `X-Forwarded-For`, and a WebSocket upgrade to `/ws`; all returned Serve-generated 502. Since they never reached tether, neither forwarded headers nor forged-header refusal was tested. Exact statuses: `evidence/serve-mac/p125-serve-http-statuses.txt`. |
| G3 | **Blocked for actual whois; rule known** | `tailscale status --json` identifies self as `100.69.69.122`, StableID `nMM5jYAKHC11CNTRL`; iPhone is `100.124.108.79`. Daemon could not read Whois Node/UserProfile. auth.md says self StableID is refused; that expected rule matches the design, but its real-LocalAPI outcome is unverified. Evidence: `p125-self-status.txt`; daemon error excerpt in `p125-setup-and-config.txt`. |
| G4 | **Blocked for whois; failure-path timings only** | 200 fresh Unix-socket requests to `GET /auth/node/session`: p50 0.017 ms, p95 0.032 ms, max 2.560 ms; 200 on one keep-alive connection: 0.015/0.030/0.036 ms; 20 concurrent: 0.071/0.298/0.537 ms. All responses were 503, 32 bytes. These are error-path transport timings, **not whois latency**. No tailscaled CPU, response-size, status-read or successful Serve-config-read measurement. `p125-unix-request-latency.txt`. |
| G7 | **Blocked** | Serve status shows the intended single root Unix handler and no Funnel. Daemon cannot read `/localapi/v0/serve-config`, so canonical-origin classification is unavailable; `tether enroll` prints Host unknown and LocalAPI reason. Other config variants were not exercised. |
| G8 | **Blocked** | Tailnet raw `.svg`, `.html`, `.js` requests all hit 502. Direct socket equivalents hit 503 `identity_unavailable` before file delivery. No active-content sandbox/MIME/script refusal behavior was observable. |
| G11 | **Partial / blocked** | The Mac LocalAPI socket was already absent; there was no LocalAPI to stop for the 15/40 s outage experiment. Direct requests already show the unavailable error path, but no enrolled WebSocket existed to verify tolerance or close code 4503. |
| Browser acceptance / desktop checks | **Blocked** | Chrome cold navigation produced HTTP 502 (screenshot cited above). Could not reach shell, enrol, open terminal, or exercise the 3-WebSocket cap. Safari was not driven. Phone checks are prepared, not run. G6 native `URLSession` behavior also cannot be checked from this Mac-side browser probe. |

### Additional acceptance checks / scope

The acceptance checks for fresh browser/PWA enrollment and credential exposure, cross-origin/null-Origin/wrong-Host/duplicate-forwarded-header attacks, native token-origin bypass, same-host other-port isolation, install/offline/storage/lifecycle, active-session upgrade, unsaved drafts/IME, and three-WebSocket actionable over-cap UI remain unverified because the request path does not function and the actual iPhone is not being operated in this run. Phone steps for G5/G10 are in `serve-iphone-steps.md`; current prerequisite blocker is explicit there.

Out of scope as requested: Linux G1 root/SUDO/EACCES/other Unix-user checks, Linux systemd behavior, and CPU/memory cap/resource-limit gate (G12/R3). G9's cross-host attack matrix and actual on-iPhone G5/G10 also cannot be completed from this Mac run.

## Files and cleanup/state

No repository files were edited. Evidence excerpts/screenshots are under `evidence/serve-mac/`, with `p125` in generated evidence names. The requested iPhone checklist is `$MERIDIAN_ACTIVE_WORK_DIR/serve-iphone-steps.md`.

Left running by request: daemon PID `86849`, Tailscale Serve tailnet-only Unix handler, and isolated tmux server `serveprobe-p125` (session `one`). To stop/reset after Jimmy finishes:

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve reset
kill -TERM 86849
/opt/homebrew/bin/tmux -L serveprobe-p125 kill-server
```

The `/tmp/tether-meridian-501/serve-probe` archive/build/config/runtime data is retained because the requested daemon and isolated tmux are using it. Chrome session was closed. No Funnel config was created.
