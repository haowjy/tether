# Report

I've reviewed the draft and recommend **approve with changes**. Option A's core holds up: separate credential kinds, an exact Origin check, no CORS, an `HttpOnly` `__Host-` cookie, and the native enrol route refusing browsers. I found no blocker. Two high findings need fixing before Jimmy signs. I edited nothing.

**What I checked against:** `.meridian/work/tether-mvp/design/browser-auth.md` at `e47dd74`, `docs/design/auth.md`, `client/browser-setup.md`, `daemon-core.md` §5.1–5.2 and §6, the iOS shell spec, and the code in `src/auth/`, `src/http/` and `src/fs/`. I verified the external facts myself with fetches and searches. No probes were run; the draft hasn't been built.

**The draft's claims, checked:**
- **Code:** accurate. Today only one credential counts (bearer first, then subprotocol). The constant-time `find`, `url_for` and `funnels_to`, `MAX_CONNS = 3`, the 10 s re-check, the raw-file headers and `ClientKind {Ios, Web}` with no catch-all all match. One exception is finding M5.
- **PSL:** confirmed. `ts.net` and `*.c.ts.net` are on the list, submitted by Tailscale.
- **RFC 6265 §8.5:** correct, cookies are not isolated by port.
- **WebKit 232666:** cited fairly. The bug is closed "RESOLVED / CONFIGURATION CHANGED", and the reporter says it looked fixed in Safari 15.1 but couldn't confirm every case. So gate G2 is still the right call.

## High

**H1. Refusing browser credentials while another service shares the hostname protects nothing that's already leaked (§3.6, D2).**
- **Problem:** the daemon only *refuses* while a sibling is published. It doesn't revoke. The draft admits the browser sends the cookie to the sibling anyway, and the check runs only at startup, enrolment and socket upgrade.
- **Scenario:** a container or third-party tool is published at `devbox:8443` (this threat is in scope because it isn't running as Jimmy). Jimmy's desktop browser visits it once and the cookie lands in its logs. Jimmy runs `tailscale serve --https=8443 off`. The leaked credential now works again for up to 30 days from any device signed in as Jimmy, because `curl` can forge `Origin`, `Sec-Fetch-Site` and `Host`.
- **Fix:** pick one and say so in D2:
  - delete every browser device when a sibling is detected, and log it (honest, but it costs a re-enrol after each spike); or
  - make a dedicated hostname for tether the plan of record and turn G9 into a ship gate; or
  - downgrade D2 to a warning and record the residual risk as accepted.
- Whichever is chosen, reword the rationale: Origin plus fetch metadata already stop a sibling *page*. What D2 is about is a sibling *server* seeing the cookie, and refusing doesn't fix that.

**H2. Static HTTP is unbounded, which an earlier review set as a gate (§3.11; §5 "daemon-core §6: No new caps").**
- **Problem:** browser-setup.md makes "bounded static HTTP startup/update load" an explicit gate. It asks for limits on concurrent static responses, bytes buffered per response, total shell size, slow-client timeouts and startup/update bursts. The draft adds a pre-enrolment static surface with none of these, and says "No new caps."
- **Why it matters:** daemon-core §6's memory ceiling is already ~65 MB, about 1 MB over `MemoryMax`. The shell is reachable by anything passing the Tailscale check, including software on Jimmy's other devices, which the threat model keeps in scope. A flood of slow readers on `/assets/*` or `/sw.js` is unbounded in connections and buffers.
- **Fix:** specify the packaging (embedded or on-disk), a concurrency cap and a per-response chunk bound (or reuse the fs raw slots), a header and slow-client timeout, and the shell's size limit. Add a row to the memory ceiling, and a probe gate that measures `memory.peak` under a shell-load burst.

## Medium

**M1. The spec contradicts itself on the shell, and built literally it 403s every launch (§3.7 vs §3.11).**
- **Problem:** §3.7 says every request that *presents* a browser credential must pass admission. The shell row says "not needed".
- **Scenario:** typing the URL, opening a bookmark or cold-launching the PWA sends `GET /` with the cookie and `Sec-Fetch-Site: none`. A link from another app sends `cross-site`. A coder following §3.7 returns 403 on the shell. A coder who guesses differently might skip parsing elsewhere too.
- **Fix:** state that the shell routes and `GET /auth/info` never parse or judge credentials. Credential parsing and admission run only in the device router and on `/auth/browser/*`. Add an acceptance check: `GET /` with a cookie and `Sec-Fetch-Site: none` returns 200.

**M2. Requiring `Sec-Fetch-Site: same-origin` on sockets and mutations has no fallback, and G3's fallback reasoning is wrong (§3.7, G3).**
- **Problem:** WebKit added fetch metadata to WebSocket handshakes only in late 2022 (bug 237550). Safari 26 reportedly sends WebSocket upgrades over HTTP/2 with unusual headers. If Safari drops the header on the upgrade, the browser client dies on Safari, and G3 only has a fallback for media.
- **Separately:** G3's media fallback "relies on CORP plus `SameSite`". `SameSite` is useless here, as the draft itself says (`ts.net` is a public suffix).
- **Fix:**
  - On upgrades and non-GET requests, the exact `Origin` is the required control. There, `Sec-Fetch-Site` only has to equal `same-origin` *if present*.
  - Require `Sec-Fetch-Site` on GET/HEAD, where Origin is usually absent.
  - State the minimum browsers (Safari/iOS 16.4+, Chrome 76+, Firefox 90+).
  - Reword the G3 fallback to rely on CORP alone, and record that a sibling page on an old browser can embed media.
  - Add Safari 26 WebSocket-over-HTTP/2 through `tailscale serve` to G1.

**M3. The serve-config rule can't be built without guessing (§3.6).**
- **When it refreshes:** the draft doesn't say when the canonical origin and the sibling state are re-derived. It doesn't say what a cookie-authenticated `GET /fs/raw` consults: a cached value, or a LocalAPI call per request with a 2 s timeout.
- **The `TCP` map:** the draft says to refuse on "a `TCP` entry on another port". But tailscaled puts `{"HTTPS": true}` TCP entries for every Web port, 443 included, as the existing test fixture shows. Read literally, the rule refuses always or never.
- **Missing fields:** the current `ServeConfig` doesn't parse `HTTPS`, `TerminateTLS` or `Services`.
- **Mount path:** tether proxied under a non-root path is undefined.
- **`browser_origin`:** the override isn't checked against what is actually published.
- **Fix:**
  - Cache derived state; refresh it at startup, at enrolment and at upgrade; HTTP requests read the cache.
  - Siblings are `Web` keys with the canonical host and another port, plus TCP entries with `TCPForward` and `TerminateTLS` for that host. `HTTPS: true` markers are ignored.
  - Require tether's handler at `/`.
  - Require `browser_origin` to be one of tether's published URLs.

**M4. The passkey (C) seam is only half real (§4, C seam).**
- **What holds:** `admit()` as the single policy point, the credential kinds, and the canonical origin as the WebAuthn origin are all real.
- **What's missing:** "a fresh passkey user verification" has no place to live. `Store::renew` rewriting `expires_at` is a 30-day renewal, not an unlock. Matching native's 5-minute lock delay needs a short unlock window, which is exactly the sliding state D1 rejected writing to `auth.toml`.
- **RP ID:** the draft makes it the serve-derived hostname, which changes under G9 or in the public phase. Every passkey would then have to be registered again.
- **Fix:** name the unlock state now: an in-memory `unlocked_until` per device hash, lost on restart, or a short-lived second `__Host-` cookie. Reserve the "unlock required" close code number. Decide the RP ID with the public hostname in mind. None of this changes A's code.

**M5. The body rule is false for uploads (§3.7, "Body, on mutations").**
- **Problem:** the rule claims `Content-Type: application/json` "as for every POST". `POST /fs/upload` takes a raw body (`src/http/fs.rs` `upload`, `body: Body`).
- **Consequence:** built literally, browser uploads break. If a coder exempts uploads instead, the spec has silently drifted.
- **Fix:** each route keeps its own body rule. Cross-site protection on mutations comes from the exact `Origin`, not from the content type.

## Low

- **L1. The duplicate-cookie rationale is wrong (§3.7).**
  - A sibling port setting `__Host-tether` *overwrites* tether's cookie (same name, host and path) rather than creating a duplicate. That's a forced logout or credential fixation.
  - Nameless-cookie and cookie-tossing bugs in some browsers let other tailnet hosts, even over plain HTTP, inject a second pair.
  - Impact is denial of service only. Keep refusing; fix the wording and log the source.
- **L2. The table of credential combinations has gaps.**
  - It doesn't cover a non-Bearer `Authorization` (Basic) with or without a cookie, an empty bearer, logout with no cookie at all, or a lowercase `bearer`.
  - Fix: treat any `Authorization` header as a native credential being presented, and give logout-with-no-cookie a definite answer (204 plus the clearing cookie).
- **L3. "A stolen credential works only on the tailnet" lasts only for this phase.** State that browser credentials are never honoured on a public origin without C.
- **L4. Revocation doesn't cut in-flight HTTP.** A raw video stream started before logout or expiry runs to the end. browser-setup asks that logout close live connections. Document it as accepted, or cancel raw streams on re-check.
- **L5. The dev Vite proxy forges `Tailscale-User-Login` for any caller (`web/vite.config.ts`).** This predates the draft and sits outside it. Anything reaching `:8443` bypasses the login allowlist; it only matters if the tailnet is ever shared. Record it next to D2.
- **L6. Usability:** a phone-only user needs a server shell every 30 days to re-enrol. Make sure Jimmy is choosing that knowingly under D1.

## Probe gates
The set mostly decides the right questions. Changes:
- **G1:** add Safari 26 WebSocket over HTTP/2.
- **G3:** fix the `SameSite` rationale (M2).
- **G7:** cover TCP entries with `HTTPS: true` and `TerminateTLS` (M3).
- **G10:** add a plain-HTTP sibling page and a cookie overwrite from a sibling port.
- **New:** a cookie-bearing shell navigation with `Sec-Fetch-Site: none` (M1).
- **New:** a measured static-load gate (H2).
- **G9:** if H1 resolves toward a dedicated hostname, G9 must pass before shipping.

## Hypotheses (not verified)
- **Host forwarding:** that `tailscale serve` passes `Host` unchanged rests on a third-party report only (I didn't find the serve.go source). G1 settles it.
- **Safari fetch metadata on WebSockets:** whether current Safari and the iOS PWA send `Sec-Fetch-Site` on upgrades is unconfirmed. The WebKit patch landed in Nov 2022, and the shipping Safari version wasn't checked. G3 settles it.

Sources: [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat), [WebKit bug 232666](https://bugs.webkit.org/show_bug.cgi?id=232666), [WebKit bug 237550](https://bugs.webkit.org/show_bug.cgi?id=237550), [Apple forum on Safari 26 WebSocket](https://discussions.apple.com/thread/256142477), [WebKit bug 260284](https://bugs.webkit.org/show_bug.cgi?id=260284), [Hermes issue on the Serve Host header](https://github.com/NousResearch/hermes-agent/issues/34390), [Tailscale Serve docs](https://tailscale.com/kb/1242/tailscale-serve).
