# Report

# Review of browser-auth.md, revision 3 (third and final round)

**Verdict: ready for Jimmy's decision, once four medium text fixes land.** There are no blockers and no high findings. N1–N10 are resolved, and the recommendations in D2 and D6 hold. The medium findings are all text fixes. One of them (M2) changes how the case for D6 should be put: "at the limit" rather than "over". I edited nothing.

I reviewed `.meridian/work/tether-mvp/design/browser-auth.md` revision 3 (uncommitted, on top of `c492e22`). I checked it against:
- `docs/design/daemon-core.md` §6, `plan.md` "Running the phone spikes", `ios-shell.md` "Dev mode", and the latest `decisions.md` entry;
- the library source in the cargo registry: hyper 1.12.0, hyper-util 0.1.21, axum 0.8.9, mio 1.2.4 and tokio 1.54.1;
- the real `web/dist` build.

Nothing has been built, so no runtime probes were possible.

## Round-2 findings

| Finding | Verdict | Evidence |
|---|---|---|
| N1 | Resolved | §3.2, §3.6 and D2 now claim only that revocation makes a *detected* sibling's copies unknown. The residual for each option is stated, and it matches the four refresh triggers. |
| N2 | Resolved | Plain HTTP and `TCPForward` without `TerminateTLS` are excluded, with sound reasons. `plan.md:746` confirms spikes 3–8 run inside the app at `tether-app://ui`, so plain HTTP costs them no secure-context APIs. Whether HMR over `ws:` works is honestly left to G13. |
| N3 | Resolved | The route caps sum to about 39–40. The 64-connection backstop sits above that plus tailscaled's ≤ 2 idle connections. |
| N4 | Partly resolved | See M3: the 60 s whole-response deadline brings back the same class of slow-link failure. |
| N5 | Resolved in structure | The accounting rule and the G12 pass rule are written down. The formula has gaps (M2). |
| N6 | Resolved | Enrolment re-reads browser state under the write lock, and *revoking* is set before the revocation write is queued. Both orders end with no browser device. |
| N7, N9 | Resolved | — |
| N8 | Resolved | hyper 1.12 `conn.rs:223-238` arms the header timer at every `poll_read_head`, idle keep-alive included. `conn.rs:281` clears it once a head is parsed, so long uploads aren't cut. 100 s against tailscaled's 90 s pool timeout holds. |
| N10 | Resolved | hyper 1.12 `io.rs:86-92`: `set_max_buf_size` sets the read and write maximum alike, with a floor of 8 KiB. `io.rs:60` selects the queue strategy when the I/O supports vectored writes, so forwarding `is_write_vectored` is required, as the draft says. |

Other library claims I confirmed:
- axum 0.8.9 builds its connection builder with defaults and no hook (`serve/mod.rs:391`), so the draft's case for owning the loop holds.
- The gzipped build is exactly 2,623,604 bytes in 52 files.
- 3 MiB is about 3.1 MB.
- A 1.5 MiB file takes about 12.6 s at 1 Mbit/s.
- 2.3 MB takes about 9.2 s at 2 Mbit/s.
- The HTTP row works out: 61 × 36 KiB ≈ 2.2 MB.

## Medium

**M1. The specified shutdown doesn't compile: hyper-util has no graceful-shutdown support for hyper's `http1` upgradeable connection.**
- **Where:** daemon-core "Static shell", the accept-loop and Shutdown paragraphs.
- **What the draft specifies:** each connection is served with hyper's `http1::Builder` plus `with_upgrades()` and watched by hyper-util's `GracefulShutdown`.
- **What the source shows:** `GracefulShutdown::watch` requires the `GracefulConnection` trait. hyper-util 0.1.21 `graceful.rs:167-233` implements it only for:
  - `http1::Connection`
  - `http2::Connection`
  - `auto::Connection`
  - `auto::UpgradeableConnection`
- **Why the obvious workarounds fail:** the `/ws` route needs the upgradeable type, and it isn't on that list. The auto types sit behind hyper-util's `server-auto` feature, which pulls in `http2` (Cargo.toml lines 104-108). That adds h2 to a daemon that has only ever spoken HTTP/1.1.
- **Scenario:** the implementer follows the text, it fails to compile, and they either add h2 or improvise.
- **Fix:** specify what axum itself does (`serve/mod.rs:388-410`): a per-connection `tokio::select!` between the connection future and a shutdown watch receiver, calling `UpgradeableConnection::graceful_shutdown()` (hyper `http1.rs:547`). Keep the `JoinSet` and abort at 2 s. Correct the Sources line that says "hyper-util 0.1.21 has `server::graceful`" as if that settled it.

**M2. G12's pass rule mixes units and leaves out memory that the kernel can't reclaim. Both matter at D6's margin.**
- **Units:**
  - `MemoryMax=64M` in systemd is 64 MiB, which is 67.1 MB (`decisions.md:815`, `probe-tmux.md:244`).
  - The ceiling rows mix units. The payload row's 6.5 is decimal MB (6.19 MiB). Most other rows (2, 3, 1, 2) are MiB values labelled MB. The new HTTP and shell rows (2.2, 3.1) are decimal.
  - Put into MiB throughout, the three-client unreclaimable figure is about 63.9 MiB against 64 MiB: at the limit, not over.
  - G12's "at most 64 MB" is therefore ambiguous by about 3 MB, which is far larger than the margin D6 turns on.
- **Missing memory:** the formula `anon + kernel + sock − slab_reclaimable` drops all of `file`. But two ceiling rows are file pages the kernel can't drop:
  - the 1 MiB of paste files on tmpfs, counted as `shmem`;
  - the upload's 2 MiB of dirty pages, counted as `file_dirty` and `file_writeback`.
  
  So G12 under-measures by up to 3 MiB in exactly the run that decides D6.
- **Arithmetic:** the two-client column subtracts 5.3 from a three-client total that uses 16. Rounded consistently it is about 64.8 and 59.3, not 64.5 and 59.0. The difference is small.
- **Fix:**
  1. State the ceiling in MiB throughout, or convert `MemoryMax` once.
  2. Make the pass rule `anon + shmem + file_dirty + file_writeback + kernel + sock − slab_reclaimable ≤ 67,108,864 bytes`.
  3. Present D6 as "no margin with three clients", not "over".
  
  Dropping to two clients is still a reasonable recommendation, but Jimmy should see that the case for it rests on having no margin, not on a measured overflow.

**M3. The 60 s whole-response deadline turns a slow link into a deterministic failure again (N4's class), and it contradicts the draft's own claims.**
- **The contradiction:**
  - The "Serving" paragraph says "no request fails for being on a slow link".
  - G12 throttles readers to 64 kbit/s and requires "no shell request gets 503 … however slow its link".
  - Yet a 1,062,428-byte font takes 60 s at about 142 kbit/s. Below that rate, the daemon aborts it on every attempt.
- **What follows:** the service-worker precache includes both fonts, so it fails as a whole and fails again at every update check. That cuts against the principle of being "usable on spotty, barely-there connections".
- **What the deadline buys:** the 30 s stall deadline already guarantees progress, at a floor of about 17 kbit/s per 64 KiB slice. All the 60 s deadline adds is protection against a reader trickling one slice every 29 s. That reader can only be Jimmy's own device, and the threat model already accepts denial of service from it.
- **The waiter sizing is just as tight:** under the same model (the daemon paced at the client's link rate), two cold loads of about 10 requests each fill the 4 slots plus 16 waiters exactly, and a precache that overlaps them goes over.
- **The model itself is unmeasured.** Through Serve, the browser leg is HTTP/2 with large per-stream windows, so tailscaled may absorb whole responses at loopback speed. In that case slots free in milliseconds and none of this matters.
- **Fix:**
  1. Drop the whole-response deadline and keep the stall deadline.
  2. Have G12 record whether daemon-side transfer time tracks the throttled client or tailscaled's buffering.
  3. Size the shell waiters from that measurement. If pacing is real, use about 32 and recompute the backstop.

**M4. Under D5, a failed or slow LocalAPI read on the 10 s re-check drops every live browser session.**
- **What the text says:** §3.6 says "A read that fails or times out sets *refused* … browser sockets close with 4503 at their re-check". Trigger 4 now makes that read every 10 s while a browser is connected.
- **Scenario:** on the busy dev box, tailscaled takes more than 2 s to answer once. Every browser socket closes, and each reconnect costs a hello and snapshots over the network. Before D5 that cost was confined to boots and upgrades. This conflicts with "reconnecting must be cheap" and "spotty connections".
- **What failing open on a re-check would cost:** very little. The read exists only to spot a new sibling, and serve-config changes also go through tailscaled. A sibling that appears and vanishes inside the failure gap is the same residual the draft already accepts.
- **Fix:** on trigger 4 only, keep the last known state when a read fails, either until the next successful read or for a bounded grace such as 3 consecutive failures. Fail closed on the enrolment, upgrade and session triggers, and on any read that shows a sibling. Add an acceptance check for it.

## D2 and D6 accuracy

- **D2 is honest.** The sibling definition, each option's residual, workflow cost and build cost, and the question that would flip the recommendation to (b) all match the mechanism. The spike move is grounded in `plan.md:746` and `ios-shell.md:156-165`. The open parts, the ATS exception and `ws:` HMR from the custom scheme, are flagged as G13 rather than asserted.
- **D6's arithmetic** checks out against daemon-core §6 (a 64.5 base, then +2.2 −1 +1 +3.1 gives 69.8). Its comparison against `MemoryMax` is off by the MiB/MB mix (M2).

## Low

- The listen backlog is 128, not 32. mio 1.2.4 `listener.rs:85-94` uses std's value, and tokio's `bind` goes through it. Fix the "listen backlog of 32" sentence.
- The section opens "Waiters are bounded by count, never by a timer", but its own auth-lane row is uncapped and time-bounded (10 s). Narrow the sentence to "every route but the auth lane".
- The 3-socket cap is shared by browser tabs, the PWA and native. Three open browser tabs lock the native app out with 4005. The text notes this but no decision row raises it, and Jimmy should see it.
- The pass rule and the ceiling use different names for the reclaimable slab ("completion slab" in one, `slab_reclaimable` in the other). They should cite the same row.
- hyper's read buffer `reserve(next)` can briefly exceed 16 KiB. The ~4 KiB-per-connection slack in the HTTP row covers it.
- The draft never notes that the dependencies must change: hyper needs `server`, and hyper-util needs `server`, `http1` and `service`. One line in §3.12 would do.

## Hypotheses (not verified)

- **Whether tailscaled buffers whole shell responses** (HTTP/2 stream windows plus its proxy copy) or passes the client's pace back to the daemon. Settling it needed a live Serve with a throttled client. It decides M3's sizing and whether the slot and deadline machinery matters at all.
- **Whether a WKWebView page at `tether-app://ui` can open `ws:` HMR** with only a domain-scoped `NSExceptionDomains` entry, which depends on WebKit's mixed-content rules for custom schemes. It needs a device; G13 owns it.
