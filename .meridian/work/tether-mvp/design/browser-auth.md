# Browser and PWA authentication, first phase (draft for approval)

Status: draft, revision 2, 2026-10-22. Nothing here is built. It specifies Option A
(an enrolled, revocable `HttpOnly` browser device cookie) so that Option C (passkey
unlock) adds to it without rework. Revision 2 answers the security review in
[browser-auth-review-1.md](browser-auth-review-1.md). Each finding is either fixed
or accepted, and the [Review disposition](#review-disposition) table at the end
says which. Sections 3–5 are the text to land in the specs once Jimmy approves and
the review passes.

## 1. Summary

A browser or installed PWA enrols the way the phone app does: Jimmy runs `tether
enroll` on the server and types the code into tether's first screen. The daemon then
sets a `__Host-tether` cookie (`Secure; HttpOnly; SameSite=Strict; Path=/`) holding a
new **browser credential**. It is a second kind of device in `auth.toml`, listed and
revoked with `tether device`, and it expires 30 days after enrolment. Browser
credentials and native tokens are not interchangeable: a cookie value sent as a
bearer token is unknown, and so is the reverse.

Because a cookie is ambient, tether now has to check where a request came from,
which the native scheme never needed. A cookie-authenticated request must come from
tether's one canonical origin. Every such request needs an exact `Host`. WebSockets
and mutations also need an exact `Origin`. `GET` and `HEAD` need `Sec-Fetch-Site:
same-origin`. Native requests keep today's rules unchanged.

Before enrolment the daemon serves only the page shell: HTML, scripts, manifest,
icons and the service worker. Those files are built into the binary and served
under fixed caps on connections, concurrency, buffers and time. If the daemon finds
another service published under its hostname, it **revokes every browser
credential**, because that service may already have received the cookie.

The accepted risk: anyone holding Jimmy's unlocked laptop or phone can use the
browser client, with no Face ID step, until the credential is revoked or expires. C
later adds a passkey check at one function, `auth::admit`, backed by an in-memory
unlock window.

### Read before approving: A is sound, under four conditions Jimmy should know about

- **Every machine in the tailnet is the same "site" as tether.** `ts.net` is on the
  Public Suffix List (checked 2026-10-22, entry `ts.net`, submitted by Tailscale), so
  the registrable domain is `tailXXXX.ts.net` and `otherbox.tailXXXX.ts.net` is
  same-site with `devbox.tailXXXX.ts.net`. Within the tailnet, `SameSite=Strict`
  protects nothing: a page served by any of Jimmy's other machines sends tether's
  cookie on its requests. The exact `Origin` and fetch-metadata rules below carry
  that protection. They are mandatory controls, not hardening.
- **A server on another port of tether's hostname receives the cookie itself.**
  Cookies are not isolated by port (RFC 6265 §8.5). The Origin rules stop a sibling
  *page* from using the cookie through the browser. They do nothing about a sibling
  *server* that the browser sends the cookie to directly: that server can log the
  cookie and replay it with `curl`, which forges `Origin`, `Host` and `Sec-Fetch-*`
  freely. The documented spike workflow (plan.md "Running the phone spikes",
  `--https=8443` on tether's hostname) creates exactly that server. Decision D2
  chooses what the daemon does about it. The recommendation is to revoke every
  browser credential when a sibling is detected.
- **Safari has a history of dropping `SameSite=Strict` `HttpOnly` cookies on
  WebSocket handshakes** (WebKit bug 232666, closed "configuration changed" with the
  fix unconfirmed in every case; an Apple forum report against HttpOnly). Probe gate
  G2 decides between `Strict` and a `Lax` fallback. The `Lax` fallback is safe
  because the Origin rules, not SameSite, carry the defence.
- **The memory ceiling has no room for the shell.** daemon-core §6 is already about
  1 MB over `MemoryMax`. Capping HTTP connections and the shell adds about 1.3 MB
  net (§5, daemon-core). By daemon-core's existing rule, the third control client
  goes first if the measured peak doesn't fit (gate G12).

## 2. Decisions that need Jimmy

| # | Question | Recommended answer | Alternatives |
|---|---|---|---|
| D1 | Browser credential lifetime | **30 days from enrolment, absolute.** Nothing renews it in A. The UI warns from 3 days out. While the credential still works, re-enrolling takes a minute: run `tether enroll` in a tether terminal, in that same browser, and type the code. **Cost to accept knowingly:** once it has expired, a phone-only user needs another shell on the server (the native app, or SSH) to get a code. C will renew it after a passkey check | No expiry, as native has (native has Face ID to bound the unlocked-device threat; a browser has nothing else). 90 days (a weak bound on a copied cookie). Sliding idle expiry (needs a write to `auth.toml` on the check path, which is read-only today) |
| D2 | A server on another port of tether's hostname (a **sibling**) | **(a) Revoke on detection.** When the daemon sees a sibling in the serve config, it deletes every browser device in one write, logs it, and refuses browser credentials and enrolment while the sibling stays. Native is unaffected. The spike workflow moves to another hostname, so detection means a mistake, and re-enrolling is its cost. **Residual, accepted:** a sibling published and torn down entirely between two of the daemon's checks (§3.6) goes unseen, and a cookie it received stays valid | **(b) A dedicated hostname for tether** (a Tailscale Service, or a second node name) as the plan of record. Nothing else is ever published on that name. G9 becomes a ship gate: if Serve doesn't add `Tailscale-User-Login` there, browsers can't ship. It also needs tailnet-admin setup, and a second node name means a second `tailscaled` on an already overloaded box. Detection stays as a backstop. **(c) A warning only:** the daemon logs and `tether enroll` prints the sibling, and admits as before. Residual: a cookie a sibling received stays valid for up to 30 days |
| D3 | Logout and local drafts | **Logout revokes the credential and keeps the drafts on that browser.** A separate "Clear local data" action deletes them. The logout sheet says which one it does | Logout always clears drafts: it loses unsent text whenever the reason for logging out is "re-enrol" |
| D4 | One pending code for both kinds | **Yes.** `tether enroll` prints one code. Native redeems it with `POST /auth/enroll`, a browser with `POST /auth/browser/enroll`. Both share the pending code, its 5-try counter and its expiry | `tether enroll --browser`: a second CLI mode for no security gain, since one code works for one device either way |

**Why (a) over (b) for D2.** (a) can be built now and doesn't depend on G9. It makes
a detected leak harmless instead of merely paused. (b) is cleaner, but whether it can
work at all is unknown (G9), and it adds tailnet configuration and maybe a second
`tailscaled`. If G9 passes, (b) can be adopted later without changing anything else
in this spec: the canonical origin simply becomes the dedicated name. (c) leaves the
review's scenario open: a third-party tool published at `:8443` logs the cookie,
and the cookie keeps working after `serve off`.

**Next to D2, a separate dev-only hole (review L5).** `web/vite.config.ts` proxies to
the daemon and injects a fixed `Tailscale-User-Login` header on every request, for
any caller that reaches the Vite port. Any tailnet peer that reaches a published
spike therefore passes the login allowlist as Jimmy. It still needs a device token,
which the proxy also injects from `tether.dev.token`. This predates the draft and
matters only if the tailnet is ever shared, or if a spike is published while its
proxy holds a real token. Fix, outside this spec: the proxy forwards the incoming
`Tailscale-User-Login` (Serve adds it to the spike's requests too) instead of
inventing one, and refuses requests that lack it. Tracked as a follow-up in the work
item, not a ship gate.

Settled without Jimmy, because the brief or the threat model fixes them: browser
credentials have native's full power (the WebSocket is the shell, so there is no
narrower scope worth having); the native scheme is unchanged; and no credential ever
appears in a URL, in JSON, or in JS storage.

## 3. Proposed text for `auth.md`

The text below is written as the current rule, in auth.md's voice. It replaces
the summary paragraph, "Threat model", "Constants" (adds rows), "Carrying the token"
→ "No `Origin` check", "State on disk", "CLI" and "Endpoints". It also adds the new
sections "Browser credentials", "Canonical origin", "Browser admission" and
"Logout". The Face ID, Keychain and recovery sections stay as written; they describe
native.

### 3.1 Replacement for the opening paragraph

> Three checks guard every host. The daemon accepts only requests that `tailscale
> serve` tags with Jimmy's Tailscale login. Each client holds a random **device
> credential** per host, issued once at enrolment against a one-time code that
> `tether enroll` prints on the server. There are two kinds. The iOS app holds a
> **native token**, kept in the Keychain behind Face ID and sent as a bearer token
> or a WebSocket subprotocol. A desktop browser, the phone's browser and an installed
> PWA each hold a **browser credential**, kept in an `HttpOnly` cookie that script
> can't read and that the daemon accepts only from tether's canonical origin. The
> device credential is the only credential: no session tokens, no signatures. Only
> browsers use a cookie, and only cookies get an origin check.

### 3.2 Threat model (replaces the section)

> One user, a tailnet with only his own devices, tailnet-only hosts. The daemon is
> remote code execution for whoever holds a credential, so the checks guard against:
>
> - another tailnet user reaching the port, if the tailnet is ever shared (the login
>   allowlist);
> - his other tailnet devices, or anything running on them (the device credential);
> - **pages on any other origin making a browser use its cookie**: other sites, other
>   machines in the tailnet (all of them are one "site", because `ts.net` is a public
>   suffix), other ports on the same machine (the
>   [browser admission](#browser-admission) rules);
> - **another server under tether's hostname receiving the cookie**, which a browser
>   sends to every port of a host (revocation on detection,
>   [Canonical origin](#canonical-origin));
> - **script reading a browser credential** (`HttpOnly`), and a copied cookie used
>   as a native token or the reverse (credential kinds);
> - someone holding the phone unlocked, or who adds a face to it, **for the native
>   app only** (the Face ID lock, `.biometryCurrentSet`);
> - a process on the server that forges Tailscale headers to enrol itself (the
>   enrolment code, readable only from a shell as Jimmy);
> - anything that passes the Tailscale check exhausting the daemon's memory through
>   the HTTP surface, the pre-enrolment shell included (the connection, header and
>   shell caps in [daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling)).
>   Such a client can still deny service by holding every connection. That is
>   accepted, since only Jimmy's own devices pass the check.
>
> **Accepted for browsers:**
>
> - Anyone holding Jimmy's unlocked laptop or phone can use the browser client, with
>   no further check, until the credential is revoked or expires (30 days). A browser
>   has no equivalent of the Keychain's Face ID gate. A lock screen drawn by the page
>   would not protect a cookie the browser sends anyway, so the client draws none.
> - A sibling server published and removed entirely between two of the daemon's
>   serve-config reads goes unseen, and a cookie it received stays valid.
> - An HTTP response already streaming when its credential is revoked or expires
>   runs to its end (see [Logout](#logout)).
>
> Out of scope: processes on the server that already run as Jimmy (they can drive
> tmux directly), a jailbroken phone, malware on a device that can read process
> memory or the browser's cookie store, browser extensions granted access to
> `*.ts.net` (they can send requests with the cookie, and some can read it), and
> script injected into tether's own origin (it can act with the cookie while the page
> is open; `HttpOnly` only keeps it from taking the credential away). That last risk
> is kept small by the CSP, DOMPurify, and raw files that never run
> ([fs.md](fs.md#get-fsrawpath)).
>
> A stolen browser credential works only from a device on the tailnet logged in as
> Jimmy, for at most its remaining lifetime. That bound holds because every host is
> tailnet-only. **A browser credential is never honoured on a public origin without
> passkey unlock**: a public phase must add C before it serves browsers, and must
> revise this section.

### 3.3 Constants (rows added)

| Constant | Value |
|---|---|
| browser credential | `tetherb_` + 43 characters: base64url, no padding, of 32 random bytes |
| browser cookie | `__Host-tether=<credential>; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=<seconds left>`, no `Domain` |
| browser credential lifetime | 30 days from enrolment, absolute |
| expiry warning in the client | from 3 days before `expiresAt` |
| minimum browsers | Safari and iOS 16.4, Chrome 76, Firefox 90: the first versions that send `Sec-Fetch-Site` |

### 3.4 Browser credentials (new section, after "The device token")

> - **Same entropy, same hashing, a different kind.** A browser credential is 32
>   random bytes with the prefix `tetherb_`. The daemon stores only its `sha256` in
>   the device's `token_sha256`, beside `kind = "browser"`. The check never trusts
>   the prefix: it looks for the hash **only among devices of the kind the transport
>   implies**. A cookie is matched only against browser devices; `Authorization`
>   and the `tether.auth.` subprotocol are matched only against native devices. The
>   scan is still constant time over the whole list, with the kind folded into the
>   comparison mask. A copied cookie sent as a bearer token is therefore "unknown",
>   so it cannot skip the origin rules, and a native token in a cookie is "unknown"
>   too.
> - **It expires.** Each browser device has `expires_at`, set at enrolment to
>   enrolment + 30 days. From then on every check refuses it as unknown (401, 4401).
>   A live socket closes at its next re-check. The cookie's `Max-Age` matches, so the
>   browser drops it too, but the daemon's `expires_at` is what decides.
>   `expires_at` is stored, not derived from `enrolled_at`, so a later renewal
>   rewrites one field. When `expires_at` is present on any device it bounds that
>   device; native devices have none.
> - **Never visible to script.** The credential exists in daemon memory only while
>   one `Set-Cookie` response is built. It is never in JSON, a URL, a log line,
>   `localStorage` or IndexedDB. The browser client never handles it; it learns its
>   state from `GET /auth/browser/session`.
> - **One credential per browser profile.** Safari, the installed PWA and each
>   desktop browser keep separate cookie jars, so each enrols separately, appears
>   separately in `tether device list` and is revoked separately. The first-launch
>   screen says so.

### 3.5 Enrolment (additions to the section)

> Steps 1–2 and 5–6 are unchanged and shared by both kinds: one pending code, one
> wrong-try counter, one atomic write that consumes the code and adds the device. A
> browser redeems the code at a different route:
>
> 3b. **In a browser**, the first visit to the canonical origin shows the enrolment
>    screen: the host's name from `GET /auth/info`, a code field, and a device name
>    prefilled from the platform ("Safari on iPhone", "Chrome on Mac") that Jimmy can
>    edit.
>
> 4b. The page sends `POST /auth/browser/enroll {code, deviceName}`. The request must
>    pass the [browser admission rules](#browser-admission) for a mutation, except
>    that no credential is needed. The daemon first refreshes its
>    [browser state](#canonical-origin) and refuses with `503 browser_unavailable`
>    unless browsers are admitted. On the auth lane, `Store::enroll` runs with
>    `kind = Browser` and `expires_at = now + 30 days`. In the same write it also:
>    - **replaces the browser's previous credential**: if the request carries a
>      `__Host-tether` cookie that matches a browser device, that device is removed,
>      so re-enrolling a browser leaves no orphan row;
>    - **drops expired browser devices**, so expired rows don't pile up.
>
>    The answer is `200 {deviceName, expiresAt}` with `Set-Cookie` and `Cache-Control:
>    no-store`. The body never carries the credential.
>
> **Native enrolment refuses browsers.** `POST /auth/enroll` returns a token in JSON,
> so it refuses any request carrying `Origin` or `Sec-Fetch-Site` with `403
> bad_origin`. Every browser tether supports sends `Origin` on a POST; the app's
> ephemeral `URLSession` sends neither. Script on tether's origin that intercepts a
> typed code therefore can't trade it for a native token, which no origin rule would
> ever stop.

### 3.6 Canonical origin (new section)

> Browsers are admitted from exactly one origin per host, the **canonical origin**:
> `https://<host>` or `https://<host>:<port>`, lowercase, with no trailing dot or
> path. The daemon derives it from tailscaled's serve config, the same LocalAPI read
> as the Funnel check. Request headers (`Host`, `X-Forwarded-*`) never choose it.
>
> **Browser state** is the cached result of one serve-config read: the canonical
> origin, and whether browsers are *admitted*, *refused* (with a reason) or
> *revoking*. HTTP requests only read the cache. The daemon re-reads the serve config
> at startup and at three browser events: an enrolment, a WebSocket upgrade, and `GET
> /auth/browser/session`, which the shell calls at every boot. These are events, not
> a poll. Concurrent refreshes share one LocalAPI call, bounded by its 2 s timeout. A
> read that fails or times out sets *refused*, so the daemon fails closed.
>
> **Deriving the canonical origin.** Browsers are admitted only through publications
> that put tether's proxy handler (`http://127.0.0.1:<port>` or `localhost`) at mount
> path `/` of a `Web` entry, in the background config, a foreground config, or a
> Tailscale Service (`Services`). If there is exactly one such publication, it is the
> canonical origin. If there are several, the config key `browser_origin` picks one,
> and it must equal one of them exactly. A `browser_origin` that names nothing tether
> publishes at `/` is *refused* (`browser_origin_unpublished`). Several publications
> and no `browser_origin` is *refused* (`ambiguous_origin`). So is tether published
> only under a non-root path (`not_at_root`): the shell, the API and the cookie's
> `Path=/` all assume the root.
>
> **Siblings.** A sibling is anything else the serve config makes reachable under the
> canonical hostname:
>
> - another `Web` key `<canonical host>:<other port>`;
> - another handler or mount path inside the canonical `Web` entry itself (the same
>   origin as tether, the worst case);
> - a `TCP` entry with `TCPForward` on a port other than the canonical one, with or
>   without `TerminateTLS`. `TCP` is keyed by port alone, so it applies to the node's
>   hostname; inside a Service it applies to the Service's hostname;
> - the same, in any foreground config.
>
> `TCP` entries carrying only `HTTPS: true` or `HTTP: true` are markers that
> tailscaled writes for every `Web` port, tether's own included. They are judged
> through their `Web` entry and otherwise ignored. A plain-HTTP `Web` entry counts
> as a sibling too. The cookie is `Secure` and never goes to it, but counting it
> keeps the rule simple and fails closed. The parsed `ServeConfig` gains `HTTPS`,
> `HTTP`, `TerminateTLS`, per-handler mount paths and `Services`.
>
> **On a sibling, the daemon revokes.** When a refresh finds a sibling, the state
> becomes *revoking*. The auth lane deletes every browser device in one atomic write
> and logs the sibling's `host:port` and the number of devices revoked at `warn`.
> Open browser sockets close with 4401 at their next re-check. Browser credentials
> and enrolment are refused with `503 browser_unavailable` (reason `sibling`) for as
> long as the sibling stays. If the write fails, the state stays *revoking* and the
> write is retried at the next refresh event. Removing the sibling doesn't readmit
> browsers until a revocation write has succeeded. Native credentials ignore all of
> this. `tether enroll` and `tether device list` print the reason browsers are
> refused.
>
> **Why revoke rather than refuse.** The browser sends the cookie to every port of
> its host. The admission rules below stop a sibling *page* from using the cookie
> through the browser. A sibling *server* receives the cookie itself and can replay
> it with forged headers from any device logged in as Jimmy. Refusing only while the
> sibling is up would leave that copy valid once it is gone. Revoking makes any copy
> worthless. What remains is a sibling that came and went between two refreshes, an
> accepted risk. HTTPS servers that fetch their own Tailscale certificate outside
> `tailscale serve` are invisible to the check. Running one under tether's hostname
> needs tailscaled operator rights, which belong to Jimmy.
>
> `GET /auth/info` reports `browserOrigin`: the canonical origin when browsers are
> admitted, otherwise `null`, with `browserRefused` set to the reason. The shell
> compares `browserOrigin` with `location.origin` before connecting. On a mismatch it
> shows "Open tether at `<browserOrigin>`" and opens no socket. A socket would only
> fail with a status the browser can't see.

### 3.7 Browser admission (new section, replaces "No `Origin` check")

> Cookies are ambient: the browser attaches them to requests that other pages start.
> **Credentials are parsed only on the device routes** (`/ws`, `/fs/*`,
> `/complete`, the debug endpoint) **and on `/auth/browser/*`**. The shell routes,
> `GET /auth/info` and `POST /auth/enroll` never parse or judge a credential. A
> bookmark, a cold PWA launch or a link from another app sends `GET /` with the
> cookie and `Sec-Fetch-Site: none` or `cross-site`, and gets the shell (200).
>
> On those routes, a request on the browser lane (below), and every browser enrolment
> and logout, must show that tether's own page sent it. These checks are pure, on
> headers alone, and they run before the auth lane reads `auth.toml`. A flood of
> cross-origin requests therefore costs no file reads.
>
> | Check | Rule | Refusal |
> |---|---|---|
> | Host | `Host` equals the canonical origin's authority (case-insensitive; a default port may be omitted) | `403 bad_origin` |
> | Origin, on a WebSocket upgrade and on every method but `GET` and `HEAD` | `Origin` is present and equals the canonical origin, byte for byte after lowercasing. `null`, a missing `Origin`, a suffix or a prefix match all fail; nothing is ever reflected. **This is the required control on upgrades and mutations** | `403 bad_origin` |
> | Fetch metadata, on a WebSocket upgrade and on every method but `GET` and `HEAD` | if `Sec-Fetch-Site` is present, it equals `same-origin` | `403 bad_origin` |
> | Fetch metadata, on `GET` and `HEAD` | `Sec-Fetch-Site` is present and equals `same-origin`. It is the required control here, because browsers usually send no `Origin` on a GET | `403 bad_origin` |
> | Origin, on `GET` and `HEAD` | if present, equals the canonical origin | `403 bad_origin` |
>
> Each route keeps its own body rule: the JSON routes take `Content-Type:
> application/json` through axum's `Json` (415 otherwise), logout takes `{}`, and
> `POST /fs/upload` takes a raw body ([fs.md](fs.md)). The content type is no
> cross-site defence; the exact `Origin` is.
>
> A refused upgrade gets a plain 403 with no socket. A page on the right origin never
> meets it, because the shell checks `browserOrigin` first (above), and a foreign page
> should get nothing that looks like a connection. **No CORS:** the daemon sends no
> `Access-Control-*` header and answers no preflight. Every browser request comes
> from the same origin. No anti-CSRF token is issued. Every cookie-authenticated
> mutation carries an exact `Origin`, which every supported browser sends and no page
> can forge, so a synchronizer token would add state and buy nothing. A browser older
> than the minimums in Constants omits `Sec-Fetch-Site`, so every GET it makes is
> refused. Tether doesn't support it.
>
> **Which credential a request presents.** The daemon joins every `Cookie` header
> field with `; ` (HTTP/2 may split them) and finds the pairs named `__Host-tether`.
> Other cookies are ignored. Any `Authorization` header counts as a native credential
> presented, whatever its scheme: the scheme name matches case-insensitively, so
> `bearer` is `Bearer`. Then:
>
> | Presented | Lane |
> |---|---|
> | exactly one `__Host-tether`, no `Authorization` header, no `tether.auth.` subprotocol | browser: the admission rules above, then the browser-kind lookup |
> | exactly one `Authorization` header, or exactly one `tether.auth.` subprotocol, and no `__Host-tether` | native: today's rules, no origin check. `Bearer <token>` goes to the native-kind lookup. Any other scheme (`Basic`, …), or an empty or missing token, is unknown: `401 auth_required` |
> | nothing | `401 auth_required` / close 4401 |
> | a cookie together with any `Authorization` header or a subprotocol token; two `__Host-tether` pairs; two `Authorization` headers; two `tether.auth.` subprotocols; an `Authorization` header together with a subprotocol | **ambiguous: refused** as `401 auth_required` / close 4401. Nothing guesses which credential was meant |
>
> **Why ambiguity is refused.** Tether only ever sets one cookie. A second pair can
> come from browsers with nameless-cookie or cookie-tossing bugs, which let any
> tailnet host inject one, even over plain HTTP. A sibling HTTPS service on the
> hostname can do worse: it can set `__Host-tether` itself, which *replaces*
> tether's cookie rather than adding a second one. That is a forced logout, or a
> session under a credential the attacker already holds, which gives them nothing
> new. Either way the impact is denial of service, and refusing keeps it from turning
> into a guess. The log line records `ambiguous`, the route, the number of
> `__Host-tether` pairs and `Cookie` fields, and which other credentials were
> present. It never records their values.
>
> **Close codes and statuses for browsers** mean what they mean for native.
> `401` or `4401` means "this credential is gone" (unknown, revoked, expired or
> ambiguous): the browser client shows the enrolment screen and does not retry.
> `503` or `4503` (`auth.toml` unreadable, auth lane busy, `browser_unavailable`)
> means "can't decide now": the client keeps its cookie and retries with the usual
> backoff. `4005` means over the connection cap. A credential's re-check on a live
> socket is unchanged: every 10 s it finds the device by kind and hash and applies
> `admit`. The codes `403 unlock_required` and close 4423 are reserved for C and are
> not sent in A.
>
> **`auth::admit(device, now)` is the one policy over a found device**, used by the
> initial check and every re-check: the device exists, and `now < expires_at` when
> it has one. A future condition (passkey unlock) is added here and nowhere else.

### 3.8 Logout (new section)

> `POST /auth/browser/logout {}` passes the browser admission rules. If the cookie
> matches a browser device, the daemon removes that device in one locked write. It
> answers `204` with `Set-Cookie: __Host-tether=; Max-Age=0; Secure; HttpOnly;
> SameSite=Strict; Path=/` in every admitted case: a matching cookie, an unknown
> cookie, or no cookie at all. Before calling logout, the client closes its own
> sockets. Any other socket the credential holds, such as another tab or window of
> the same browser, closes with 4401 at its next re-check (at most 10 s). The
> re-check is the one revocation path, and logout uses it rather than adding a
> socket registry.
>
> **In-flight HTTP is not cut.** A response already streaming when its credential
> is revoked or expires runs to its end. In practice that means a `/fs/raw` range.
> Each response holds one of 2 raw slots and dies after a 30 s stall
> ([fs.md](fs.md#constants)). Every new request is checked, and a video makes a new
> `Range` request every few seconds, so playback stops within one range. Cutting
> streams early would need a registry of responses by credential, which costs more
> than one range is worth. browser-setup.md asks that logout close live connections.
> This meets that for sockets and accepts the gap for a response in flight.
>
> Local drafts stay; "Clear local data" is a separate action
> ([browser-setup.md](client/browser-setup.md#drafts-installation-and-lifecycle)).

### 3.9 State on disk (row change)

> `auth.toml`: `[[device]]` with `name`, `kind` (`native` or `browser`; absent means
> `native`, so files written before browsers parse unchanged), `token_sha256`,
> `enrolled_at`, `enrolled_by` (the Tailscale login, or `cli`), and `expires_at`
> (RFC 3339; set on every browser device). Optional `[pending]` with `code_sha256`,
> `expires_at`, `wrong_tries`. A browser device without a parseable `expires_at` is
> refused as unknown and logged by name. The file still parses, so no other device is
> affected. Browser state (§ Canonical origin) is memory only.

```toml
[[device]]
name = "iphone"
token_sha256 = "…"          # kind absent: native
enrolled_at = "2026-10-21T09:12:00Z"
enrolled_by = "jimmy@github"

[[device]]
name = "Safari on iPhone"
kind = "browser"
token_sha256 = "…"
enrolled_at = "2026-10-22T08:00:00Z"
enrolled_by = "jimmy@github"
expires_at = "2026-11-21T08:00:00Z"
```

### 3.10 CLI (table change)

> | Command | Effect |
> |---|---|
> | `tether enroll [--ttl 10m]` | Print a new enrolment code, the host URL for the app, and the browser URL (`browserOrigin`, or the reason browsers are refused, such as the sibling's `host:port`). The code works for either kind |
> | `tether device list` | Devices with name, kind, enrolled date, `enrolled_by`, and for browsers the expiry (or `expired`); a line for why browsers are refused, if they are |
> | `tether device remove <name>` | Remove a device of either kind; its credential stops working and its sockets close at the next re-check |
> | `tether device add <name>` | Add a **native** device and print its token once, for the desktop dev shim or Playwright against a real daemon. It never mints a browser credential |

### 3.11 Endpoints (replaces the route table)

> Every route sits behind the Tailscale check (403 `forbidden`, before anything else).
> API paths are reserved before static routing (`/ws`, `/auth/`, `/fs/`,
> `/complete`, `/debug`): an unknown path under them is a JSON 404 and never falls
> through to the shell.
>
> | Route | Native token | Browser credential | Request → response |
> |---|---|---|---|
> | shell: `GET`/`HEAD` `/`, `/manifest.webmanifest`, `/sw.js`, `/icons/*`, `/apple-touch-icon.png`, `/favicon.ico`, `/assets/<hashed name>` | never parsed | never parsed: the Tailscale check only | the packaged files, nothing else; no fallback, no directory listing; served under the shell caps ([daemon-core.md](daemon-core.md#static-shell)) |
> | `GET /auth/info` | never parsed | never parsed | `{hostId, name, daemonVersion, protocol, browserOrigin, browserRefused}` |
> | `POST /auth/enroll` | redeems the code | refused: any `Origin` or `Sec-Fetch-Site` is `403 bad_origin` | `{code, deviceName}` → `{token, deviceName}` |
> | `POST /auth/browser/enroll` | an `Authorization` header is `400 bad_request` | browser admission (mutation), no credential needed; refreshes browser state | `{code, deviceName}` → `200 {deviceName, expiresAt}` + `Set-Cookie`; 403 `bad_code`; 503 `browser_unavailable`, `busy` |
> | `GET /auth/browser/session` | `401 auth_required` | browser admission (GET) + valid credential; refreshes browser state | `{deviceName, expiresAt}`; 401; 503 |
> | `POST /auth/browser/logout` | `401 auth_required` | browser admission (mutation); the credential may be unknown or absent | `{}` → `204` + clearing `Set-Cookie` |
> | `GET /ws` | subprotocol token, as today | cookie; only `tether.v1` offered; browser admission (upgrade); refreshes browser state | upgrade; bad credential → close 4401; unreadable file, busy or `browser_unavailable` → close 4503; bad origin → plain 403 |
> | `GET /fs/*` (list, dirs, roots, raw incl. `Range`) | `Authorization: Bearer` | browser admission (GET) | as fs.md |
> | `POST /fs/*` (roots add/remove, uploads-dir, upload) | `Authorization: Bearer` | browser admission (mutation); each route's own body rule | as fs.md |
> | `POST /complete` | `Authorization: Bearer` | browser admission (mutation) | as complete.md |
> | debug endpoint | `Authorization: Bearer` | browser admission for its method | as plan.md |
>
> Every non-shell response carries `Cache-Control: no-store`, `X-Content-Type-Options:
> nosniff` and `Cross-Origin-Resource-Policy: same-origin`. CORP keeps other origins
> from embedding a response with `<img>` or `<video>` even when the request carries a
> cookie. New errors: `403 bad_origin` (a browser request that failed admission) and
> `503 browser_unavailable` (browser state is *refused* or *revoking*; retryable,
> with the reason logged and shown by `/auth/info`).
>
> **Shell responses** carry `Content-Security-Policy: default-src 'none'; script-src
> 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src
> 'self' blob:; font-src 'self'; connect-src 'self' wss://<canonical host>;
> manifest-src 'self'; worker-src 'self'; frame-src 'none'; frame-ancestors 'none';
> object-src 'none'; base-uri 'none'; form-action 'none'`, plus `nosniff`,
> `Referrer-Policy: no-referrer` and `Cross-Origin-Opener-Policy: same-origin`.
> Hashed assets get `Cache-Control: public, max-age=31536000, immutable`; `/`,
> `/sw.js` and the manifest get `no-cache` and an `ETag` (the content hash), and
> answer `If-None-Match` with 304. The service worker's fetch handler answers only
> shell paths. For every other request it doesn't call `respondWith`, so API, file,
> media and socket traffic never pass through it, and their cookies, `Range` and
> fetch metadata are the browser's own. The shell carries no host data and no
> credential, so serving it before enrolment gives away only the client's code.

### 3.12 Module shape (additions)

> - `browser.rs` (new, pure): `Origin::canonical`; `BrowserState { origin,
>   status: Admitted | Refused(Reason) | Revoking }` and its derivation from a
>   `ServeConfig`, including sibling detection; `presented(headers) -> Presented {
>   None, Native(Authorization | Subprotocol), Browser(&str), Ambiguous }`;
>   `admission(method, upgrade, headers, &Origin) -> Result<(), Refused>`;
>   `set_cookie(credential, max_age)` and `clear_cookie()`.
> - `identity.rs`: `ServeConfig` parses `HTTPS`, `HTTP`, `TerminateTLS`, mount paths
>   and `Services`; the browser-state cell holds the last result and coalesces
>   refreshes.
> - `token.rs`: `generate(kind)`; `find(devices, kind, hash)` keeps its
>   constant-time, no-early-exit scan with the kind in the mask.
> - `store.rs`: `Device.kind` (serde default `Native`), `Device.expires_at:
>   Option<String>`; `enroll(code, name, by, kind, replaces: Option<Hash>, now)`;
>   `remove_by_hash`; `remove_kind(Browser)` for revocation.
> - `mod.rs`: `check` dispatches on `presented`; `admit(device, now)` is the single
>   post-lookup policy, called by `check` and `recheck`.
> - `http/mod.rs`: `device_check` runs `browser::admission` for the browser lane
>   before the auth lane; `bad_origin` refusals never complete an upgrade. The
>   `/auth/browser/*` routes sit outside the `devices` router, like `/auth/enroll`,
>   and call the same admission. The shell router sits outside it too, behind the
>   Tailscale check, and never looks at a credential. `http::serve` runs its own
>   accept loop (daemon-core, "Static shell").
> - The log never carries `Cookie`, `Set-Cookie`, `Authorization` or
>   `Sec-WebSocket-Protocol` values; refusals log the reason and the path.

## 4. `decisions.md` entry

```markdown
### Browsers authenticate with an HttpOnly device cookie, passkey-ready

- **Decided:** 2026-10-22, Jimmy (Option A, built so passkey unlock can be added);
  details by design (browser auth), revised after security review.
- **What:** a browser or PWA enrols with the `tether enroll` code and gets a
  `__Host-tether` cookie (`Secure; HttpOnly; SameSite=Strict; Path=/`) holding a
  browser credential: a second device kind in `auth.toml`, listed and revoked with
  `tether device`, expiring 30 days after enrolment. Kinds don't cross: cookies match
  only browser devices, `Authorization` and subprotocol tokens only native ones.
  Credentials are parsed only on the device and `/auth/browser/*` routes. There,
  a cookie request needs an exact `Host`; upgrades and mutations need an exact
  `Origin` (and `Sec-Fetch-Site: same-origin` if sent); GET and HEAD need
  `Sec-Fetch-Site: same-origin`. All are checked against one canonical origin
  derived from the serve config. When anything else is published under that
  hostname, every browser device is revoked and browsers are refused while it
  stays. Native admission is unchanged. Only the shell, embedded in the binary
  and served under fixed caps, is served before enrolment.
- **Why:** media `Range` streaming, `<img>`, fetch and the WebSocket all carry a
  cookie without script handling a secret; reusing the device store keeps one
  enrolment, revocation and re-check path. `ts.net` is a public suffix, so every
  machine in the tailnet is same-site: `SameSite` can't separate them and the
  `Origin` and fetch-metadata checks are required controls. A sibling server
  receives the cookie itself, so only revocation makes a leaked copy worthless.
  Jimmy accepts that an unlocked laptop or phone can use the browser client in
  this phase.
- **Changes:** "No `Origin` check" and the invariant "tether never authenticates with
  a cookie" now hold for native credentials only. "The daemon serves no UI" no
  longer holds. `http::serve` caps connections and header time for every client.
- **Rejected:**
  - B, a token in browser JS storage sent as a bearer or subprotocol: readable by any
    injected script, and `<video src>` can't add a header, so media needs blob loading
    or URL tickets.
  - D, Tailscale identity alone: no per-device enrolment or revocation.
  - A lifetime of none (native's choice; a browser has no Face ID to bound the
    unlocked-device case), 90 days (a weak bound on a copied cookie), or sliding idle
    expiry (writes `auth.toml` on the check path).
  - A session cookie derived from the credential: minting and refresh for no
    protection a 30-day credential behind the Origin rules doesn't already give.
  - An anti-CSRF synchronizer or double-submit token: every mutation carries an
    exact `Origin`; a token adds state for no further protection.
  - `SameSite` as the cross-origin defence: same-site covers the whole tailnet.
  - Requiring `Sec-Fetch-Site` on upgrades and mutations: WebKit added fetch
    metadata to WebSocket handshakes late, and the exact `Origin` already decides.
  - Accepting the first of duplicate or mixed credentials: guessing hides an
    injected or overwritten cookie.
  - One enrol route with a `kind` field: the native route must refuse browsers so a
    typed code can't be traded for a JSON token by injected script.
  - Closing a logged-out credential's sockets at once through a socket registry: the
    10 s re-check already revokes, and the client closes its own sockets first.
    Cancelling in-flight raw responses on revocation, for the same reason.
  - For a sibling on the hostname: refusing only while it is up (a leaked copy works
    again after `serve off`); a warning only (the same, with no refusal); a dedicated
    hostname as the plan of record (unknown whether Serve identity works there, G9,
    and extra tailnet setup). The dedicated hostname stays open if G9 passes.
  - Serving the shell from a directory on disk: a configurable root, fs-lane reads,
    and a daemon and shell that can drift apart during an upgrade. Sharing the 2 raw
    slots with the shell: a cold load or an update would starve the file viewer.
```

The C seam, recorded in the same entry or in auth.md "Open risks":

```markdown
- **Passkey unlock (C) plugs into:**
  - `auth::admit(device, now)`, one new condition: the device's **unlock window** is
    open. The unlock window is `unlocked_until`, an in-memory map from a browser
    device's credential hash to an instant, held by the auth lane, at most one entry
    per browser device. It is never written to `auth.toml`, so it costs no write on
    the check path, and a daemon restart locks every browser. A passkey assertion
    with user verification opens it. Socket activity can slide it in memory, to
    match native's 5-minute lock delay. A second short-lived cookie was rejected: it
    is another secret to protect and needs a signing key, which is more state.
  - Routes under `/auth/browser/passkey/*`, behind the same browser admission.
  - `Store::renew`, which rewrites `expires_at`: a renewal of the 30-day credential,
    separate from the unlock window.
  - Refusals `403 unlock_required` and close 4423, reserved now. 401 and 4401 keep
    meaning "credential gone".
- **RP ID:** the canonical origin's full hostname (`devbox.tailXXXX.ts.net`),
  stored with each registered passkey. It is never the registrable domain
  `tailXXXX.ts.net`: that would let a page on any other machine in the tailnet ask
  for assertions. A hostname change, such as D2's dedicated hostname or the public
  phase, re-registers passkeys. The public phase serves a new origin, which needs a
  new browser credential with C anyway (auth.md "Threat model"). That phase may pick
  a parent domain it owns (`tether.example.com` over per-machine subdomains) as its
  RP ID, but only if every subdomain is a tether daemon. Settle D2 before C ships,
  so the tailnet RP ID doesn't move.
- A provides the kind, the stored `expires_at`, the canonical origin (the WebAuthn
  origin), and admission rules every new browser route reuses.
```

## 5. Other spec sections that must change

### plan.md "Security"

- **Identity**: unchanged.
- **Device token and Face ID lock** → **Device credentials**: "Two kinds
  ([auth.md](auth.md)): a native token behind Face ID for the iOS app, and an
  `HttpOnly` browser cookie for browsers and the PWA, admitted only from the canonical
  origin. Both are checked on every route but the shell, `/auth/info` and the
  enrolment routes by one middleware…" (keep the fail-closed sentence).
- **Web hardening**: replace "No cookies anywhere, so there is no cross-site request
  to forge" with "The iOS app never sends a cookie. Browsers send one, so every
  cookie-authenticated request must pass exact Origin, Host and fetch-metadata checks
  against the canonical origin. A sibling service under tether's hostname revokes
  every browser credential ([auth.md](auth.md#browser-admission))." Add: the
  browser shell is served by the daemon under the CSP in auth.md §Endpoints. That
  replaces "The daemon serves no UI", which ios-shell.md also states.
- **Running the phone spikes**: step 2 must no longer publish on tether's hostname
  (`--https=8443` on the same machine name). Publish spikes under another hostname.
  Publishing one on tether's hostname revokes every browser credential (D2).

### daemon-core.md

- **§5.1 Transport**: "A native client offers `tether.v1, tether.auth.<token>`; a
  browser offers only `tether.v1` and carries its cookie. The daemon answers
  `tether.v1` either way."
- **§5.2**: add `Upgrade --> Rejected: browser request from another origin, HTTP 403`
  to the diagram. 4401 becomes "bad, unknown, revoked, expired or ambiguous
  credential"; 4503 adds "browser credentials refused for now (`browser_unavailable`)";
  4423 is reserved ("unlock required", passkey phase). The browser client sends
  `hello.client.kind = "web"`, a value that already exists. `ClientKind`
  (`src/proto/messages.rs`) has no catch-all, so a new `"browser"` value would make
  an older daemon refuse `hello` with 4003. The credential kind, not `hello`, is what
  the daemon trusts.
- **New subsection, "Static shell"** (proposed text):

> **HTTP connections.** `http::serve` runs its own accept loop over hyper-util's
> HTTP/1 connection builder, because `axum::serve` sets no header timeout and no
> connection cap. Each accepted socket takes one of **24 connection permits** and
> holds it until the socket closes, even after a WebSocket upgrade. With no permit
> free, the loop stops accepting, and the kernel's listen backlog of 32 holds
> newcomers. The builder sets a **10 s header-read timeout**, which applies to a
> request's first byte and to an idle keep-alive connection (gate G12 confirms it),
> a **16 KiB header limit**, and a **64 KiB maximum buffer** per connection, read
> and write each. The 24 permits cover 3 WebSockets, 2 raw responses, 1 upload, the
> 8 fs waiters, 4 shell responses, and 6 for JSON and the shell's waiting requests.
> A request waiting for any slot holds its connection, so the permits also bound
> every waiter that has no cap of its own.
>
> **Packaging.** The release build embeds the shell: `build.rs` reads `web/dist` and
> Vite's manifest and generates a static table of path, bytes, content type and hash.
> The build fails if a file is missing or the manifest is stale. It also fails over
> **8 MiB in total, 2 MiB for one file, or 128 files**. Today's build is 5.0 MiB in 52
> files, the largest a 1.0 MiB font. Embedded bytes are the binary's read-only pages:
> the daemon and shell always match, there is no configured root, and nothing reads
> the disk on the fs lane. Debug builds may read `web/dist` instead.
>
> **Serving.** A shell response takes one of **4 shell slots**, separate from the fs
> raw slots, so a cold load or an update can't starve the file viewer. Waiting for a
> slot is bounded at **10 s**, then `503 busy` with `Retry-After: 1`. The body is
> **64 KiB slices of the embedded bytes**: `Bytes::from_static`, never copied, so a
> response holds no heap beyond hyper's write buffer. Two deadlines bound a slow
> reader: fs raw's **30 s stall deadline** for the socket to take the next slice, and
> a **60 s deadline for the whole response**, well above the 17 s a 2 MiB file takes
> at 1 Mbit/s. Either aborts the response and frees its slot. The shell is served
> uncompressed; the fonts are already woff2. A cold load is about 10 requests, which
> queue in the 4 slots. A service-worker update that meets 503 fails as a whole and
> leaves the old version active (browser-setup "Offline shell and updates"), so a
> burst degrades into a retry at the next update check.

- **§6 Limits** (rows added): connection permits 24 (stop accepting); header-read
  timeout 10 s (connection closed); header size 16 KiB (431); hyper buffer per
  connection 64 KiB, read and write; shell slots 4 (wait up to 10 s, then `503
  busy`); shell stall 30 s and response deadline 60 s (aborted); shell size 8 MiB,
  2 MiB per file, 128 files (build fails); browser credential lifetime 30 days
  (auth.md). Note under the connection cap that browser tabs, the PWA and native all
  count toward the 3 sockets. The cap is not raised here.
- **§6 Memory ceiling** (rows changed and added):

| Item | Bound | MB |
|---|---|---|
| HTTP connections (new): those not upgraded and not in another row, waiting or idle | 24 permits − 3 WebSockets = 21 × (≤ 32 KiB read buffer under the 16 KiB header cap + 8 KiB header write buffer + task) | 1 |
| shell responses (new) | 4 slots × (64 KiB write buffer; the body is static, uncopied) | 0.3 |
| file API (changed: the 64 KiB hyper buffer replaces ~400 KiB in the raw and upload rows of fs.md) | raw 2 × (64 KiB chunk + channel + 64 KiB) + upload (64 KiB + 64 KiB chunk + 2 MiB dirty) + scan + listing | 4 (was 5) |
| kernel socket buffers (changed) | as before, plus the 4 shell sockets × 256 KiB | 3 (was 2) |
| **ceiling** | | **~66 (was ~65)** |

  Below the table: the embedded shell's pages (at most 8 MiB, only those touched)
  are clean and file-backed, like page cache. They are reclaimable, so they stay out
  of the ceiling, but they count toward `memory.current` and push toward
  `MemoryHigh` while warm. **What gives:** the ceiling is now about 2 MB over
  `MemoryMax`. By the rule §6 already states, the third control client goes first
  (3 → 2 saves 5.3 MB, to about 61 MB), unless the budget measurement, which now
  includes G12's shell burst, shows the peak fits. Before this change, HTTP
  connections were unbounded and uncounted, so the ceiling was optimistic. The new
  rows make it honest.

### fs.md

- `GET /fs/raw`: `Cache-Control: private, no-cache` → `no-store`; add
  `Cross-Origin-Resource-Policy: same-origin`. Add one sentence: in a browser, raw
  responses share the UI's origin. "It sends nothing a browser runs" (text/plain for
  `html`/`js`/`css`/`xml`, `nosniff`, `sandbox`) is what keeps an uploaded or
  repository file from running as tether, or registering as its service worker.
  Changes to the type table are security changes.
- Video in a browser plays with `<video src>` on the same origin, the cookie riding
  on its `Range` requests. `Content-Range` and `ETag` are readable without
  `Access-Control-Expose-Headers` because the request is same-origin. The "daemon
  sends no CORS headers" sentence stays.
- "Limits and the memory ceiling": hyper's buffer is 64 KiB, not ~400 KiB, in the
  raw and upload rows (daemon-core "Static shell"). The file API total becomes ~4 MB.
- Errors: add `bad_origin` and `browser_unavailable` to the shared table, and to
  `HttpError` (generated for TypeScript).

### ios-shell.md

- "Where the web UI comes from": "The daemon serves no UI" becomes "The daemon also
  serves the browser build at its canonical origin ([auth.md](auth.md)); the app
  never loads it. It bundles its own copy and never registers the service worker."
- Add an invariant: the app's `URLSession`s keep cookies off, and its web view never
  loads a host's origin, so no request from the app carries `__Host-tether`. A
  request that did would be refused as ambiguous (probe G6).
- "Dev mode": the desktop dev shim and the Vite proxy remain dev-only, using a native
  token from `tether device add`. They are never a browser deployment, and the
  release browser build contains neither.
- The bridge: `Native.kind` gains a browser platform adapter, chosen at boot when no
  native bridge exists in a production build. It has no `token()` and passes no
  subprotocol token, `httpOrigin` is `location.origin`, and `hostRejected` shows the
  enrolment screen.

### client/browser-setup.md

- "Roadmap and authentication status" and "Browser credential candidate": replace
  "candidate" with "settled in [auth.md](../auth.md)", and point there for fields,
  routes and rules.
- "Required controls": anti-CSRF is satisfied by an exact Origin on mutations and
  upgrades and `Sec-Fetch-Site: same-origin` on reads (no token), with the reason and
  the minimum browsers. Host validation is against the canonical origin from the
  serve config. Add CORP `same-origin` and `no-store` on every API response.
- "Deployment trap": now enforced by revocation on detection. Add the same-site fact
  (`ts.net` is a public suffix).
- "Packaging and static delivery": the static bounds this section asks for are set
  in daemon-core "Static shell" (embedded; 24 connection permits; 4 shell slots;
  64 KiB per-connection buffers; 10 s header, 30 s stall, 60 s response; 8 MiB
  shell). Replace "still require a small build/resource spike" with G12.
- "Threat-model decision required": resolved, Jimmy accepts reduced protection
  (no unlock) for the Tailscale phase; passkey unlock is the planned follow-up.
- Logout: drafts kept; "Clear local data" is separate (D3). Live sockets close within
  10 s; a response already streaming runs to its end (auth.md "Logout").

### connection-roadmap.md

- "Authentication versus reachability": the first-phase trust model is chosen. Link
  to auth.md and this decision. Passkeys stay the preferred public-phase auth, now
  with a named seam. Add: browser credentials are never honoured on a public origin
  without passkey unlock, and the public phase picks its own RP ID (auth.md, C seam).

## 6. Probe gates and acceptance checks

### Probe gates: check on the real deployment before shipping

None of these was run for this draft. Each names what it decides.

| # | Gate | Decides |
|---|---|---|
| G1 | Through `tailscale serve`: on plain HTTP, on POST and on the WebSocket upgrade, the daemon receives `Cookie` (including HTTP/2 split cookie fields, and how they arrive), `Origin`, `Host` (exact value, with or without `:443`) and `Sec-Fetch-*` unchanged. `Set-Cookie` comes back to the browser unchanged, including on `204`. **Safari 26 sends WebSocket upgrades over HTTP/2** (extended CONNECT): Serve must turn them into HTTP/1.1 upgrades to the daemon with those headers intact, and the socket must work | Whether the Host and fetch-metadata rules can hold as written. If Serve rewrites `Host`, compare against what Serve sends and record it. If Safari 26's HTTP/2 upgrade fails through Serve, the browser client doesn't ship on it until it works |
| G2 | Safari on macOS, Safari on iOS, and the installed iOS PWA send the `Strict` `HttpOnly` `__Host-tether` cookie on: the WebSocket handshake after a fresh load, a reload, a tab restored after quitting, history navigation, and a PWA cold launch; on `fetch`; and on `<img>` and `<video>` `Range` requests | `SameSite=Strict`, or the `Lax` fallback (safe because the Origin rules carry the defence) |
| G3 | Fetch metadata on the same requests: GETs (`fetch`, `<img>`, `<video>` ranges) carry `Sec-Fetch-Site: same-origin`; upgrades and POSTs carry either `same-origin` or nothing. `<video>` loads in Safari especially, since WebKit may load media through AVFoundation | If media GETs omit it: allow a missing header on `GET /fs/raw` only, never a value other than `same-origin`. CORP alone then guards those responses. `SameSite` adds nothing, because the tailnet is one site. Recorded: a sibling page in a browser without CORP could embed raw media |
| G4 | WebSocket upgrades and POSTs carry `Origin`, serialized exactly as the canonical origin (no `:443`) | Origin rule as written |
| G5 | On the target iOS release, Safari and the installed PWA keep separate cookie jars; the cookie survives a PWA relaunch and a reboot; Web Inspector shows a 30-day expiry (no 7-day cap on a server-set `HttpOnly` cookie) | The separate-enrolment copy, and D1 holding in practice |
| G6 | The iOS app's WKWebView WebSocket carries no tether cookie; the app's `URLSession` sends no `Origin` or `Sec-Fetch-*` on `POST /auth/enroll` | The ambiguity rule and the native-enrol refusal don't break native |
| G7 | Browser-state derivation agrees with `tailscale serve status` for: Web, TCP and foreground entries; the `HTTPS: true` / `HTTP: true` markers tailscaled writes for every Web port (ignored); a `TCPForward` with and without `TerminateTLS` (sibling); a second mount path inside tether's own Web entry (sibling); tether at a non-root path (refused); tether in a Service; the documented `:8443` spike mapping (sibling, revokes) | D2's enforcement, and the canonical-origin derivation |
| G8 | A raw `.svg` and `.html` opened top-level from `/fs/raw` run no script in Safari or Chrome under `CSP: sandbox`; a raw `.js` (`text/plain` + `nosniff`) is refused both as `<script>` and by `serviceWorker.register` | That same-origin raw files can't run as tether |
| G9 | Only if D2 chooses (b), and then **a ship gate**: Tailscale Services or a second node name still adds `Tailscale-User-Login`, and the Funnel and serve-config checks see it | Whether the dedicated hostname works at all; if it fails, D2 falls back to (a) |
| G10 | From a page on a sibling tailnet machine, from another port of the same machine, and from a **plain-HTTP page** on a tailnet host (in a staging setup, not production): WebSocket hijack, `fetch` POST, form POST, and `<img>`/`<video>` of `/fs/raw` all fail (403 or blocked by CORP). A cookie set or **overwritten** from a sibling port, and a tossed duplicate from the plain-HTTP page, never admit anything | The cross-origin defence end to end, and L1's impact being denial of service only |
| G11 | In Safari, iOS Safari, the installed PWA and Chrome, with a valid cookie: a typed URL, a bookmark, a PWA cold launch and a link from another app (`Sec-Fetch-Site: none` or `cross-site`) all load the shell, which then connects | The shell routes never judging credentials (M1) |
| G12 | On the dev box, under the systemd unit: a burst of 24 connections fetching the whole shell at once, plus 3 sockets and a raw stream, with some readers throttled to 64 kbit/s. Record the unit's `memory.peak`, check that slow readers are cut at 30 s or 60 s, that a 25th connection waits and is then served, and that an idle keep-alive connection closes at 10 s | The new memory-ceiling rows, the header timeout's coverage of idle connections, and "what gives" in daemon-core §6 |

### Acceptance checks (automated in `tests/http_auth.rs` where a socket suffices)

- **Kinds:** a browser credential as `Authorization: Bearer` and as `tether.auth.`
  is 401/4401; a native token in `__Host-tether` is 401/4401; each works on its own
  transport.
- **Presented credentials:** cookie + bearer, cookie + `Authorization: Basic`, cookie
  + subprotocol, two `__Host-tether` pairs, two cookie header fields each holding
  one, two `Authorization` headers, two subprotocol tokens, `Authorization` +
  subprotocol: all refused, none admitted by picking one. `Authorization: Basic …`,
  `Authorization: Bearer` with an empty token, and a missing scheme are 401 on the
  native lane; `authorization: bearer <token>` works.
- **Origin and fetch metadata:** for each browser route, a missing, `null`,
  other-port, other-host, suffix-extended (`…ts.net.evil`) and scheme-changed Origin
  on an upgrade or POST is `403 bad_origin`. An exact Origin with no `Sec-Fetch-Site`
  on an upgrade or POST is admitted; with `same-site`, `cross-site` or `none` it is
  403. A GET with a missing `Sec-Fetch-Site`, or with `same-site`, `cross-site` or
  `none`, is 403. A wrong `Host` is 403. A refused upgrade never sees 101. None of
  these reads `auth.toml` (count auth-lane runs).
- **Shell never judges credentials:** `GET /` with a valid, an unknown and a
  duplicated cookie, and `Sec-Fetch-Site: none` or `cross-site`, is 200 and runs
  no auth lane; `GET /auth/info` with a cookie is 200.
- **Bodies:** `POST /fs/upload` with a raw body, an exact Origin and a cookie is
  admitted; a JSON route with `text/plain` is 415.
- **Enrolment:** a browser enrol body and headers never contain the credential;
  `Set-Cookie` has exactly the attributes in Constants; a wrong code counts against
  the shared counter and the fifth deletes it, whichever route took the tries; a
  right code is consumed for both routes; re-enrolling with a valid cookie removes
  the old device in the same write; expired browser rows are dropped; `POST
  /auth/enroll` with `Origin` is 403.
- **Lifetime:** a browser device past `expires_at` is 401; a live socket closes 4401
  at the next re-check after expiry; a browser row with a bad `expires_at` is refused
  alone, and other devices keep working.
- **Logout:** 204 and a clearing cookie; the device is gone from `auth.toml`; a
  second socket on the same credential closes 4401 within 10 s; an unknown cookie and
  no cookie at all both get 204 and clearing.
- **Browser state:** from fixture serve configs. A sibling Web port, a second mount
  path in tether's entry, or a `TCPForward` on another port revokes every browser
  device in one write and gives `503 browser_unavailable` / 4503 until it is gone.
  Native requests are unaffected throughout. A failed revocation write keeps
  browsers refused even after the sibling is removed. `HTTPS: true` markers alone
  admit. An unreadable config, two publications with no `browser_origin`, a
  `browser_origin` that tether doesn't publish, and tether at a non-root path are
  all refused, revoke nothing, and set `/auth/info.browserOrigin` to `null` with the
  reason. Enrolment, an upgrade and `/auth/browser/session` each trigger a refresh;
  other HTTP requests trigger none (count LocalAPI calls).
- **Static shell:** shell paths answer before enrolment with the CSP and cache
  headers above; `If-None-Match` on `/` gives 304; unknown `/fs/…`, `/auth/…` and
  `/ws…` paths are JSON 404, never HTML; a failed Tailscale check is 403 on shell
  paths too. A fifth concurrent shell response waits, then gets `503 busy` after 10
  s. A reader that stops reading is aborted at 30 s. A connection that sends no
  complete header in 10 s is closed. A 25th connection isn't accepted until one
  closes. The build fails on a missing asset, a stale manifest, or a shell over the
  size limits.
- **Headers:** every API response has `no-store`, `nosniff` and CORP; nothing logs
  a cookie, bearer or subprotocol value (grep the test log for the credential).
- **Build:** the release browser bundle contains neither `createDevShim`,
  `tether.dev.token` nor `Tailscale-User-Login`, and boots with no `window.webkit`;
  the native bundle registers no service worker and boots with no cookie.
- **Native unchanged:** the existing native suite passes untouched: no Origin check
  on bearer or subprotocol, 4401 and 4503 meanings, Face ID flow.

## Sources

- Code read at the current checkout: `src/auth/{mod,token,store,identity}.rs` (single
  bearer-or-subprotocol `presented`, first match wins; constant-time `find`;
  `ServeConfig::url_for` and `funnels_to`; the fixture with `{"HTTPS": true}` TCP
  markers on 443 and 8443; no `HTTPS`, `TerminateTLS` or `Services` parsed),
  `src/http/{mod,enroll,error,ws,fs}.rs` (`device_check`, 4401/4503 mapping,
  `MAX_CONNS = 3`, `RECHECK = 10 s`, raw headers `private, no-cache` + `nosniff` +
  `sandbox`, `upload` taking a raw `Body`, `axum::serve` with no connection cap),
  `web/proto/link.ts` (subprotocol token), `web/main.tsx` (release boot requires the
  native bridge), `web/dev/shim.ts` and `web/vite.config.ts` (dev-only
  cookie-to-bearer proxy with injected login). No debug-endpoint route exists in
  `src/http/` yet; plan.md names it.
- Library source: axum 0.8.9 `serve` builds hyper-util's connection builder with no
  timer, so no header-read timeout applies and nothing caps connections. hyper 1.12
  `http1::Builder` offers `header_read_timeout` (needs a timer), `max_buf_size`
  (default 8 KiB + 400 KiB, used by both the read and the write buffer) and
  `max_header_size`.
- Build measured: `web/dist` today, 52 files, 5,225,026 bytes (2.6 MB gzipped), the
  largest two the 1.0 MiB JetBrains Mono woff2 fonts, then the 780 KiB `cpp`
  grammar and the 552 KiB entry chunk.
- Docs: `docs/design/auth.md`, `plan.md` "Security", "Resource budget" and "Running
  the phone spikes" (the `:8443` mapping), `daemon-core.md` §5.1–5.2 and §6 (the
  ~65 MB ceiling and the control-client rule), `fs.md` "Constants" and "Limits and the
  memory ceiling", `ios-shell.md`, `client/browser-setup.md` (the static-load gate),
  `client/connection-roadmap.md`, `decisions.md` "Auth".
- [Security review 1](browser-auth-review-1.md), and the sources it cites: WebKit
  bug 237550 (fetch metadata on WebSocket handshakes), the Apple forum thread on
  Safari 26 WebSockets, WebKit bug 260284, and the report on Serve's `Host` header.
- [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat): `ts.net`
  and `*.c.ts.net` in Tailscale's private section (fetched 2026-10-22).
- [RFC 6265 §8.5](https://httpwg.org/specs/rfc6265.html#section-8.5): cookies are not
  isolated by port.
- [WebKit bug 232666](https://bugs.webkit.org/show_bug.cgi?id=232666) and
  [Apple forum thread 104488](https://developer.apple.com/forums/thread/104488):
  Safari omitting SameSite/HttpOnly cookies on WebSocket handshakes (unconfirmed on
  current Safari; G2).
- [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html):
  Origin validation for cookie-authenticated sockets.

## Review disposition

| Finding | Disposition | Landed in |
|---|---|---|
| H1 refusing protects nothing already leaked | **Fixed.** D2 offers (a) revoke on detection, (b) a dedicated hostname with G9 as a ship gate, (c) a warning. It recommends (a). The rationale now separates a sibling page (stopped by admission) from a sibling server (handled by revocation). The between-refreshes gap is accepted | §1, §2 D2, §3.2, §3.6, §4, G7, G9 |
| H2 static HTTP unbounded | **Fixed.** Shell embedded with build-time size limits; 24 connection permits; 4 shell slots; 64 KiB buffers; 10 s header, 30 s stall, 60 s response timeouts; ceiling rows, and the third control client as what gives | §5 daemon-core "Static shell" and §6, fs.md, browser-setup; G12; static-shell checks |
| M1 shell contradicts §3.7 | **Fixed.** Credentials are parsed only on the device and `/auth/browser/*` routes | §3.7, §3.11; G11; "Shell never judges credentials" check |
| M2 `Sec-Fetch-Site` with no fallback | **Fixed.** Exact Origin is required on upgrades and mutations, with `Sec-Fetch-Site` checked only if present; it is required on GET/HEAD; minimum browsers stated; G3 relies on CORP alone; Safari 26 HTTP/2 added to G1 | §3.3, §3.7, §4; G1, G3 |
| M3 serve-config rule unbuildable | **Fixed.** Cached browser state with named refresh events; sibling rules ignore `HTTPS: true` markers; new fields parsed; root mount required; `browser_origin` validated | §3.6, §3.12; G7; "Browser state" check |
| M4 C seam half real | **Fixed.** `unlocked_until`, held in memory, is the unlock state; `403 unlock_required` and 4423 reserved; the RP ID is the full canonical hostname, with the public phase's choice stated | §3.7, §4 C seam, §5 daemon-core, connection-roadmap |
| M5 body rule false for uploads | **Fixed.** Each route keeps its own body rule; the exact Origin is the defence | §3.7, §3.11; "Bodies" check |
| L1 duplicate-cookie rationale | **Fixed.** Overwrite and tossing described; impact stated as denial of service; the log records the shape, never values | §3.7; G10 |
| L2 credential-table gaps | **Fixed.** Any `Authorization` counts as native; schemes match case-insensitively; Basic and empty bearer are unknown; logout with no cookie is 204 | §3.7, §3.8; "Presented credentials", "Logout" checks |
| L3 tailnet-only bound is phase-limited | **Fixed.** Browser credentials are never honoured on a public origin without C | §3.2, connection-roadmap |
| L4 revocation doesn't cut in-flight HTTP | **Accepted.** A response in flight runs to its end, bounded by 2 raw slots, the 30 s stall and per-range checks; a response registry costs more than one range | §3.2, §3.8, §4, browser-setup |
| L5 Vite proxy forges the login header | **Accepted for this spec, follow-up recorded.** Predates the draft and is dev-only; the fix (forward the incoming header) is described next to D2 | §2 |
| L6 phone-only re-enrol every 30 days | **Fixed.** D1 states the cost, and the in-browser re-enrol path before expiry | §2 D1 |
| Probe-gate changes | **Fixed.** G1, G3, G7, G9 and G10 changed; G11 (shell navigation) and G12 (measured static load) added | §6 |
