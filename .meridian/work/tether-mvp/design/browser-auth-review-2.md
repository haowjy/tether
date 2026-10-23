# Report

I recommend **request changes**, not frame-rot. Rev 2 fixes most of the first-round findings, but three of the new pieces need rework: H2's limits, how strong the D2(a) claim is, and the D2(a) workflow. I edited nothing.

I reviewed `.meridian/work/tether-mvp/design/browser-auth.md`, revision 2 (uncommitted, on top of `e47dd74`). I checked it against `docs/design/daemon-core.md` §6, `fs.md`, `client/browser-setup.md` and the current `src/http/mod.rs`. I also read the axum 0.8.9 and hyper 1.12 source in the cargo registry and the upstream tailscale source (`ipn/backend.go`, `ipn/ipnlocal/serve.go`). Nothing has been built, so there were no runtime probes.

## Round-1 findings

| Finding | Verdict |
|---|---|
| H1 | Fixed in principle: revoke, not refuse, and page vs server separated. But the "makes any copy worthless" claim is overstated (N1) and the workflow it relies on isn't feasible (N2). |
| H2 | Bounded now, but the design starves its own traffic and its accounting is inconsistent (N3, N4, N5). |
| M1, M2, M5, L1, L2, L3, L6 | Resolved. The text matches each fix, and the acceptance checks cover them. |
| M3 | Resolved, apart from two loose ends (N6, N7). |
| M4 | Resolved. One wording gap (N9). |
| L4, L5 | Soundly accepted, with reasons given. |
| Round-1 hypothesis: does Serve preserve `Host`? | **Settled: yes.** In `serve.go`'s `Rewrite`, a TCP backend gets `r.Out.Host = r.In.Host` (only Unix-socket backends get the proxy URL's host). The Host rule can hold. |

## High

**N1. D2(a)'s protection depends on luck, and the draft claims more than it delivers (§2 D2, §3.6 "Why revoke", §1, §4).**
- **What it does:** browser state is refreshed only at startup, enrolment, a WebSocket upgrade and `GET /auth/browser/session`. The 10 s re-check of a live socket doesn't read the serve config.
- **Why that misses:** tailscaled can't tell the daemon when the serve config changes. The IPN bus `Notify` struct has no serve-config field and no matching watch option (checked upstream `ipn/backend.go`). So the only events are tether's own browser events.
- **Scenario (the review's own case):** Jimmy publishes something on `:8443` on Monday and visits it from desktop Chrome, which sends the cookie. tether is open in another tab on a live socket, so no refresh happens. He runs `serve off` that evening and opens tether on Tuesday. The sibling is never seen and the leaked cookie stays valid for up to 30 days.
- **How wide the gap really is:** it is "any sibling whose whole life fell between two browser boots or upgrades", not "between two checks". Visiting the sibling is exactly when tether is least likely to be booting.
- **Fix, pick one and write it into D2:**
  - Refresh the cached state on the existing 10 s re-check while at least one browser socket is live. This rides a timer that already exists, and the LocalAPI read is one loopback JSON call. But it is polling in all but name, so it needs Jimmy's sign-off against "no polling".
  - Or keep the events and restate the residual honestly: "a sibling that lives entirely between browser boots goes unseen". Then (a)'s advantage over (c) becomes "catches siblings still up when tether next boots". Jimmy should weigh that against N2's cost.
- **Either way:** replace "Revoking makes any copy worthless" with what is true.

**N2. D2(a) moves the spike workflow to "another hostname", which needs the very setup D2 rejected (b) for (§2 "Why (a) over (b)", §5 plan.md "Running the phone spikes").**
- **The contradiction:** (b) is turned down because a dedicated name needs a Tailscale Service or a second `tailscaled`. Yet the plan.md change tells Jimmy to publish spikes "under another hostname" on the same box, which needs exactly that setup.
- **What else trips revocation:** any `tailscale serve --tcp` forward (SSH, a database) or a second HTTPS app on the dev box revokes every browser and blocks enrolment for as long as it stays. On a dev box that is likely a standing state, not a mistake.
- **Plain HTTP is counted too,** "to keep the rule simple". That removes the one cheap way out: the cookie is `Secure` and never goes to a plain-HTTP port. The worst such a port can do is toss a cookie, and the ambiguity rule already limits that to denial of service.
- **Fix:**
  - Don't count plain-HTTP `Web` entries as siblings, nor `TCPForward` entries without `TerminateTLS`. A raw TCP forward can only receive the cookie if its backend presents a valid certificate for the hostname, and that needs operator rights, which the draft already puts out of scope.
  - Say concretely where spikes go: plain `--http` if the spikes tolerate a non-secure context, Jimmy's laptop, or (b).
  - If none of those works for the keyboard spikes, that is evidence for (b) or (c), and Jimmy should see it in D2's cost column.

**N3. The 24-permit accept cap blocks the native socket behind ordinary browser bursts (daemon-core "Static shell").**
- **Why it blocks:**
  - Every connection comes from tailscaled.
  - Its proxy transport sets no `MaxConnsPerHost` (checked `serve.go`), and the browser talks HTTP/2 to Serve. So one page load becomes as many backend connections as it has requests in flight.
  - At accept time the daemon can't tell a native upgrade from a shell fetch. When the permits run out, the native app's reconnect sits in the kernel backlog behind them.
- **Scenario:** two browser profiles cold-load (about 10 requests each), the service worker update precaches, and a video range is open. All 24 permits are held, the shell waiters for up to 10 s each, and a phone reconnecting from a train waits.
- **Arithmetic:** the "6 for JSON and the shell's waiting requests" budget is exceeded by one cold load: about 10 requests, 4 being served and 6 waiting.
- **The draft's cover doesn't apply:** its acceptance ("such a client can deny service… accepted") covers an adversary. This happens in normal use.
- **Fix:** make the accept cap a backstop that normal bursts never reach. Size it above the sum of the per-route caps plus headroom (for example 48–64). Then let each route's own cap answer 503 quickly. The memory row grows by roughly 1 MB, and N4's fix pays for it.
- **Simpler mechanism:** the cap alone doesn't need an owned accept loop. axum 0.8.9 exposes `Listener` (already used through `tap_io`), so a wrapper whose `accept()` first awaits an `OwnedSemaphorePermit` and stores it in the returned I/O object does the job. It is about 30 lines and keeps `axum::serve` and today's shutdown path.
- **What still needs the loop:** the header timeout, `max_buf_size` and `max_header_size`. I confirmed that axum 0.8.9 builds hyper-util's `auto::Builder` with defaults and no timer, and offers no hook for it (`serve/mod.rs:391`).
  - The header timeout is nearly moot behind Serve: tailscaled forwards complete headers instantly, so a slow-header attack only comes from a local loopback process.
  - `max_buf_size` is the real memory win: about 1 MB in the fs rows.
  - Owning the loop is therefore defensible. Specify it as hyper-util's `auto::Builder` plus `server::graceful::GracefulShutdown`. Say explicitly that it must insert `ConnectInfo<SocketAddr>` into request extensions, because `tailscale_check` needs the peer address, and keep `small_buffers` and the 4004 / 2 s shutdown semantics. A side benefit: owning the loop can force-close stalled connections at shutdown, so fs.md's `HubHandle::stop` workaround could be deleted.

## Medium

**N4. The 10 s shell-slot wait turns a slow link into a deterministic failure.**
- **Scenario:** precaching about 3 MiB (two 1 MiB fonts and the 552 KiB entry chunk) at 2 Mbit/s keeps all 4 slots busy for over 10 s. The requests queued behind them get 503.
- **Consequences:**
  - An update install fails as a whole and retries in the same order, so on a weak cellular link it may never succeed.
  - A first load has no service worker to fall back on, so trailing assets 503 and the page breaks.
- **The pattern differs from fs's:** fs bounds waiters by count (8, then 503 at once), not by a timer.
- **Fix:** use a shell waiter count with an immediate 503, and no wait deadline. The connection permits already bound the waiters. The 30 s stall and 60 s whole-response deadlines are fine.
- **Also:** embed precompressed gzip or brotli for JS and CSS. The draft measured 5.0 MiB raw against 2.6 MB gzipped. That halves transfer time on slow links and halves N5's file-backed pages.

**N5. The embedded shell's pages are left out of the ceiling, which contradicts §6's own measurement rule (daemon-core §6 note).**
- **The conflict:** §6 says the budget check reads `memory.peak`, "which counts kernel buffers and page cache". The draft excludes up to 8 MiB of touched shell pages (about 5 MiB today) as reclaimable, yet G12 decides "what gives" from `memory.peak`.
- **Precedent:** §6 *includes* the reclaimable 2.4 MB slab in its ceiling and notes it is reclaimable.
- **Consequence:** include the pages and the ceiling becomes about 71 MB. Dropping the third control client then leaves about 66 MB, still over `MemoryMax=64M`. So the "drop a client and it fits" story only holds under an accounting rule the draft doesn't state.
- **Fix:** add a row for the shell pages, marked reclaimable as the slab is. Write G12's pass rule explicitly, for example: anonymous plus kernel memory from `memory.stat` ≤ `MemoryMax`, and `memory.peak` recorded. Note that warm pages push toward `MemoryHigh` throttling. Compression (N4) shrinks the row.

**N6. An enrolment can race a revocation (§3.5 step 4b, §3.6).**
- **Sequence:** an enrolment refreshes and sees *admitted*. A concurrent refresh then detects a sibling and queues the revocation write. Both writes run on the auth lane in either order. If the enrol write lands second, a fresh browser device exists while the sibling is up, and the browser will send its cookie to that sibling.
- **Fix:** the enrol write re-checks the browser state inside the same auth-lane step, or carries a generation number that the revocation bumps. Add an acceptance check for that interleaving.

**N7. What a refresh event covers, and in what order, is ambiguous (§3.6, §3.7).**
- **Native upgrades:** "a WebSocket upgrade" refreshes state, but it doesn't say whether native upgrades do. They shouldn't: that would add up to 2 s of LocalAPI latency to native, and a failed read must never touch native.
- **Ordering:**
  - The refresh should run *after* the pure admission checks. Otherwise a cross-origin flood triggers LocalAPI calls. The calls are coalesced, but this breaks the "costs nothing" claim.
  - The upgrade's admit should use the refreshed result.
- **Fix:** state "browser lane only, after admission" for each of the three triggers.

## Low

- **N8. The 10 s idle keep-alive close races tailscaled's connection pool.** tailscaled keeps idle backend connections for 90 s (`IdleConnTimeout: 90 * time.Second` in `serve.go`). Go doesn't retry a non-replayable POST if the server closes the connection after the request was written. The result is a rare 502 on enrol or upload after an idle pause. Fix: accept it in the spec, or keep the timeout for the first request only and let idle connections live longer, bounded by the permits.
- **N9. Sliding the unlock window on "socket activity" needs a definition (§4, C seam).** Pings every 10 s are socket activity, so an open tab would never lock. Fix: slide only on user input messages (input, paste, insert), never on ping, pong or output.
- **N10. The "HTTP connections" memory row assumes a ≤ 32 KiB read buffer.** hyper's adaptive read buffer can grow to `max_buf_size` (64 KiB) when body bytes arrive with the headers. The worst case is 21 × 64 KiB ≈ 1.4 MB, not 1. Fix: use 64 KiB in the row; it is a rounding change.

## Checked and found sound

- **Ceiling arithmetic is internally coherent:** +1 +0.3 −1 +1 = +1.3, which reaches the ~66 MB the draft states. "~2 MB over" and "61 MB after dropping a client" also follow. N5 is about the accounting rule, not the arithmetic.
- **The kernel row is consistent with fs.md:** 64 KiB `SO_SNDBUF`, doubled by Linux, times two directions gives the 256 KiB per socket the draft uses.
- **hyper claims are accurate:**
  - `header_read_timeout` arms at every `poll_read_head`, so it does cover idle keep-alive (`proto/h1/conn.rs:224`).
  - It needs a timer, which axum sets none of.
  - The default `max_buf_size` is 8192 + 409600 bytes.
- **RP ID choice is correct.** The full hostname is right, and since `ts.net` is a public suffix the registrable domain would expose the passkey to every tailnet machine. A sibling on another port shares the RP ID, but the daemon's exact-origin check on the client data, port included, rejects its assertions.
- **The in-memory `unlocked_until` is sound.**

## Verdict: request changes

N1 and N2 together decide whether D2(a) is still the right recommendation. Jimmy should see the honest residual and the real workflow cost before choosing between (a), (b) and (c). N3–N5 are a contained rework of daemon-core "Static shell". The direction is to size the accept cap as a backstop, bound shell waiters by count, compress the shell and state the accounting rule. That is a single redesign of the bounding scheme rather than three separate patches, and N3 and N4 are one class: time-based waits stacked on an accept-level cap. Everything else is small text fixes.

## Hypotheses (unverified)

- **Which spikes tolerate plain HTTP:** whether the iOS keyboard spikes need a secure context, which decides if `--http` is a workable spike path under N2, is unchecked.
- **tailscaled's real backend fan-out:** I didn't measure how many backend connections a Safari cold load opens through Serve over HTTP/2. G12 should record it, because N3's numbers depend on it.
- **N8's frequency:** the race in N8 is inferred from Go's transport retry rules, not reproduced.

Sources: [tailscale ipn/backend.go](https://github.com/tailscale/tailscale/blob/main/ipn/backend.go), [tailscale ipn/ipnlocal/serve.go](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go)
