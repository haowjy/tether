# Browser and PWA authentication, first phase (draft for approval)

Status: draft, revision 3, 2026-10-23. Nothing here is built. It specifies Option A
(an enrolled, revocable `HttpOnly` browser device cookie) so that Option C (passkey
unlock) adds to it without rework. Revision 3 answers the second security review in
[browser-auth-review-2.md](browser-auth-review-2.md), on top of the first
([browser-auth-review-1.md](browser-auth-review-1.md)). Each finding is either fixed
or accepted, and the [Review disposition](#review-disposition) table at the end
says which. Sections 3–5 are the text to land in the specs once Jimmy has answered
§2. Where an answer changes the text, the text says so.

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
icons and the service worker. Those files are built into the binary, gzipped, and
served under per-route caps that refuse at once when full, behind a connection cap
that normal use never reaches. Another HTTPS service published under tether's
hostname receives the cookie too; decision D2 chooses what the daemon does about it.

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
  `--https=8443` on tether's hostname) creates exactly that server. tailscaled can't
  tell the daemon when the serve config changes, so no option catches every such
  server. D2 sets out each option's residual risk and workflow cost.
- **Safari has a history of dropping `SameSite=Strict` `HttpOnly` cookies on
  WebSocket handshakes** (WebKit bug 232666, closed "configuration changed" with the
  fix unconfirmed in every case; an Apple forum report against HttpOnly). Probe gate
  G2 decides between `Strict` and a `Lax` fallback. The `Lax` fallback is safe
  because the Origin rules, not SameSite, carry the defence.
- **The memory ceiling no longer fits with three control clients.** Counting every
  HTTP connection, the kernel buffers of shell responses and the shell's pages
  takes the ceiling from about 65 MB to about 70 MB. The part the kernel can't
  reclaim reaches about 64.3 MB, just over `MemoryMax` (64 MB). Two control
  clients bring it to about 59 MB. D6 asks Jimmy to make that call.

## 2. Decisions that need Jimmy

| # | Question | Recommended answer | Alternatives |
|---|---|---|---|
| D1 | Browser credential lifetime | **30 days from enrolment, absolute.** Nothing renews it in A. The UI warns from 3 days out. While the credential still works, re-enrolling takes a minute: run `tether enroll` in a tether terminal, in that same browser, and type the code. **Cost to accept knowingly:** once it has expired, a phone-only user needs another shell on the server (the native app, or SSH) to get a code. C will renew it after a passkey check | No expiry, as native has (native has Face ID to bound the unlocked-device threat; a browser has nothing else). 90 days (a weak bound on a copied cookie). Sliding idle expiry (needs a write to `auth.toml` on the check path, which is read-only today) |
| D2 | Another HTTPS server under tether's hostname (a **sibling**, defined in [D2 in detail](#d2-in-detail)) | **(a) Revoke on detection, with D5 = yes, and spikes moved to plain HTTP (G13).** The deciding question is in D2 in detail: if Jimmy keeps other HTTPS services on the dev box's own name, choose (b) instead | (b) a dedicated hostname for tether; (c) a warning only. Costs of all three in D2 in detail |
| D3 | Logout and local drafts | **Logout revokes the credential and keeps the drafts on that browser.** A separate "Clear local data" action deletes them. The logout sheet says which one it does | Logout always clears drafts: it loses unsent text whenever the reason for logging out is "re-enrol" |
| D4 | One pending code for both kinds | **Yes.** `tether enroll` prints one code. Native redeems it with `POST /auth/enroll`, a browser with `POST /auth/browser/enroll`. Both share the pending code, its 5-try counter and its expiry | `tether enroll --browser`: a second CLI mode for no security gain, since one code works for one device either way |
| D5 | Under D2(a): also re-read the serve config on the live browser socket's 10 s re-check? | **Settled: yes** (decisions.md, "AGENTS.md states principles; the specs hold the rules"). It sends nothing over the network and adds no timer: at most one loopback LocalAPI read every 10 s, only while a browser socket is open | — |
| D6 | The third control client, now that the ceiling is redone ([D6 in detail](#d6-in-detail)) | **Drop to 2 control clients when the browser shell lands.** With 3, the memory the kernel can't reclaim reaches about 64.3 MB at caps, against `MemoryMax` of 64 MB. With 2 it is about 59 MB. Raise it back if the budget measurement shows room | Keep 3 and let G12 and the budget measurement decide (daemon-core §6's existing rule). Shrink the new HTTP rows instead (a 48-connection backstop, or 8 KiB hyper buffers): each saves at most about 1 MB and gives up the headroom that review N3 asked for |

### D2 in detail

**What counts as a sibling.** It is anything else that tailscaled terminates TLS for
under tether's hostname, because only TLS on that name makes a browser send the
`Secure` cookie:

- an HTTPS `Web` entry on another port of tether's hostname;
- another handler or mount path inside tether's own `Web` entry;
- a `TCP` entry with `TCPForward` **and** `TerminateTLS`, on another port;
- the same in a foreground config, or in a Tailscale Service that shares the name.

These are **not** siblings: a plain-HTTP `Web` entry (`--http`), because the browser
never sends a `Secure` cookie over HTTP; and a `TCPForward` without `TerminateTLS`
(`--tcp`, such as SSH or a database). A raw TCP forward only sees the cookie if its
backend presents a valid certificate for tether's hostname, and getting one needs
tailscaled operator rights, which only Jimmy has. A plain-HTTP page can still toss a
duplicate cookie, and the ambiguity rule (§3.7) keeps that to denial of service.

**Who could use a leaked cookie.** A sibling's copy matters only when something less
trusted than Jimmy's own shell can read it: a backend running as another user or in
a container, a backend on another machine, or logs that leave the box. Anything that
runs as Jimmy on the server is out of scope already, since it can drive tmux
directly. Replaying the copy then needs a device logged in to the tailnet as Jimmy,
or a process on the dev box that can reach the daemon's loopback port.

**Why no option is airtight.** tailscaled can't notify the daemon of a serve-config
change: the IPN bus's `Notify` carries no serve config (review 2, upstream
`ipn/backend.go`). The daemon only sees the serve config when it reads it.

| | (a) Revoke on detection | (b) A dedicated hostname | (c) A warning only |
|---|---|---|---|
| What the daemon does | Deletes every browser device in one write when it sees a sibling, and refuses browsers while it stays | Serves browsers only on a name nothing else is published on; detection as in (a) stays as a backstop | Logs the sibling, and `tether enroll` prints it; browsers are admitted as before |
| **Residual risk** | With D5: a sibling that is published and removed while no tether browser tab is connected, and before the next browser boot, goes unseen, and any cookie it received stays valid for up to 30 days. Without D5, the same holds for any sibling that comes and goes between two browser boots or socket upgrades, even with tether open in another tab | None from siblings while nothing else is published on tether's name. If something is, the backstop behaves as (a) | Any cookie a sibling receives stays valid for up to 30 days after the sibling is gone |
| **Workflow cost** | Publishing any HTTPS service on the dev box's own name revokes every browser profile, so each re-enrols with a code (about a minute each), and browsers stay refused until it is removed | A one-time tailnet-admin setup, a new URL in every browser, and no browser client until G9 passes. The setup is a Tailscale Service, or a second node name, which means a second `tailscaled` on the overloaded box | None |
| **Where spikes go** | Spikes 3–8 run inside the app: the app fetches the dev server's assets natively, and the page's origin stays `tether-app://ui` (ios-shell.md "Dev mode"). So they can publish on plain HTTP (`--http=8080`) at no cost to secure-context APIs. The traffic stays inside WireGuard. The cost is a Debug-only ATS exception for the dev host, and HMR over `ws:` or reloading (G13, unverified). If G13 fails, publish from the Mac's own tailnet name, or accept one revocation per spike session. Most spikes run before browsers ship anyway (plan.md: "The spikes come first") | Unchanged: `--https=8443` on the dev box's name | Unchanged |
| Build cost | Sibling detection, the revocation write and its race guard (§3.5), plus D5's refresh | (a)'s backstop, plus deriving the canonical origin from a Service | Sibling detection and a log line |

**Recommendation: (a), with D5.** A leaked cookie is a shell as Jimmy, and once
plain-HTTP and raw TCP entries are no longer siblings, (a) costs something only when
an HTTPS service is published on the dev box's own name. The spikes can avoid that.
(b) is cleaner but blocked on G9 and on tailnet setup, and it can be adopted later
without changing the rest of this spec: the canonical origin simply becomes the
dedicated name. **The question that would change this:** if Jimmy keeps other HTTPS
services on the dev box's name as a standing state, (a) means no browsers for as
long as they run. Then choose (b), or (c) if every such service is his own code
running as him.

**D5's cost.** Settled as consistent with tether's principles: it sends nothing over
the network and does no work while idle. D5 adds no timer: each browser socket already wakes every 10 s to re-check
its credential, and that re-check reads `auth.toml` on the auth lane every time
(`Auth::recheck`, `src/auth/mod.rs`). D5 makes the same wake-up also refresh browser
state, reusing any result younger than 10 s. So the cost is at most one loopback
`GET /localapi/v0/serve-config` per 10 s for the whole daemon, only while a browser
socket is open, and none when only native or nobody is connected. What it buys: a
sibling that is up for 10 s or more while tether is open in any browser tab, which
is the review's own scenario, is now seen.

### D6 in detail

| Ceiling at every cap (daemon-core §6, rows redone in §5) | 3 control clients | 2 control clients |
|---|---|---|
| everything, reclaimable included (what `memory.peak` can reach) | ~69.8 MB | ~64.5 MB |
| reclaimable: the shell's clean file pages (≤ 3.1 MB) and the completion slab (2.4 MB) | 5.5 MB | 5.5 MB |
| **what the kernel can't reclaim, which must fit `MemoryMax` (64 MB)** | **~64.3 MB** | **~59.0 MB** |

Both columns are above `MemoryHigh` (48 MB) at caps, where systemd throttles the
unit. That was true before. Before this change, HTTP connections were unbounded and
uncounted, so the old ceiling of ~65 MB was optimistic. What dropping a client costs
the product: windows from at most two tmux sessions can be watched at once (a control
client is attached to one tmux session), so watching a third gets `watchEnded {
error }` after lingering clients are closed.

### Next to D2: a separate dev-only hole (review L5)

`web/vite.config.ts` proxies to
the daemon and injects a fixed `Tailscale-User-Login` header on every request, for
any caller that reaches the Vite port. Any tailnet peer that reaches a published
spike therefore passes the login allowlist as Jimmy. It still needs a device token,
which the proxy also injects from `tether.dev.token`. This predates the draft and
matters only if the tailnet is ever shared, or if a spike is published while its
proxy holds a real token. Fix, outside this spec: the proxy forwards the incoming
`Tailscale-User-Login` (Serve adds it to the spike's requests too) instead of
inventing one, and refuses requests that lack it. Tracked as a follow-up in the work
item, not a ship gate.

### Settled without Jimmy

The brief or the threat model already settles these: browser
credentials have native's full power (the WebSocket is the shell, so there is no
narrower scope worth having); the native scheme is unchanged; and no credential ever
appears in a URL, in JSON, or in JS storage.

## 3. Proposed text for `auth.md`

The text below is written as the current rule, in auth.md's voice, for the
recommended answers in §2 (D2 (a), D5 yes, D6 two control clients). A note in
brackets says what changes under another answer. It replaces
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
> - **another HTTPS server under tether's hostname receiving the cookie**, which a
>   browser sends to every port of a host (revocation on detection,
>   [Canonical origin](#canonical-origin));
> - **script reading a browser credential** (`HttpOnly`), and a copied cookie used
>   as a native token or the reverse (credential kinds);
> - someone holding the phone unlocked, or who adds a face to it, **for the native
>   app only** (the Face ID lock, `.biometryCurrentSet`);
> - a process on the server that forges Tailscale headers to enrol itself (the
>   enrolment code, readable only from a shell as Jimmy);
> - anything that passes the Tailscale check exhausting the daemon's memory through
>   the HTTP surface, the pre-enrolment shell included (the per-route caps, the
>   connection backstop and the buffer limits in
>   [daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling)). Such a
>   client can still deny service: by holding every connection, or by filling the
>   kernel receive buffers of connections the daemon isn't reading (up to 128 KiB
>   each, which can push the unit to `MemoryMax`). That is accepted, since only
>   Jimmy's own devices pass the check, and any other process able to reach the
>   loopback port is local to the box.
>
> **Accepted for browsers:**
>
> - Anyone holding Jimmy's unlocked laptop or phone can use the browser client, with
>   no further check, until the credential is revoked or expires (30 days). A browser
>   has no equivalent of the Keychain's Face ID gate. A lock screen drawn by the page
>   would not protect a cookie the browser sends anyway, so the client draws none.
> - A sibling the daemon never sees keeps any cookie it received valid for up to
>   30 days. A sibling is seen only when the daemon reads the serve config: at
>   startup, at a browser's boot, enrolment or socket upgrade, and every 10 s while
>   a browser socket is open. So a sibling published and removed while no browser
>   tab is connected, before the next browser boot, goes unseen.
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
>    that no credential is needed. Only then does the daemon refresh its
>    [browser state](#canonical-origin), and it refuses with `503
>    browser_unavailable` unless browsers are admitted. On the auth lane,
>    `Store::enroll` runs with `kind = Browser` and `expires_at = now + 30 days`.
>    **Under the store's write lock, it reads browser state again** and writes
>    nothing, answering `503 browser_unavailable`, unless browsers are still
>    admitted. A refresh that finds a sibling sets *revoking* before it queues the
>    revocation write. So an enrolment either lands before the revocation write,
>    which then removes it, or sees *revoking* and writes nothing: no browser device
>    is ever created while a sibling is known. In the same write it also:
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
> *revoking*. Every other request only reads the cache. tailscaled offers no
> notification of serve-config changes, so the daemon re-reads it at startup and at
> four points, **each on the browser lane only, and each after the pure admission
> checks** (§ Browser admission), so a cross-origin flood causes no LocalAPI call:
>
> 1. `POST /auth/browser/enroll`;
> 2. a browser-lane `/ws` upgrade, whose admission then uses the refreshed state;
> 3. `GET /auth/browser/session`, which the shell calls at every boot;
> 4. each open browser socket's 10 s re-check, reusing any result younger than 10 s,
>    so the daemon makes at most one read per 10 s however many browser sockets are
>    open. [Under D5 = no, this trigger is dropped.]
>
> Native requests and native upgrades never refresh browser state and never consult
> it. Concurrent refreshes share one LocalAPI call, bounded by its 2 s timeout. A read
> that fails or times out sets *refused*, so the daemon fails closed: browser sockets
> close with 4503 at their re-check, and the client retries with its usual backoff.
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
> **Siblings.** A sibling is anything else for which tailscaled terminates TLS under
> the canonical hostname, since only TLS on that name makes a browser send the
> `Secure` cookie:
>
> - another HTTPS `Web` key `<canonical host>:<other port>`;
> - another handler or mount path inside the canonical `Web` entry itself (the same
>   origin as tether, the worst case);
> - a `TCP` entry with `TCPForward` **and** `TerminateTLS` on a port other than the
>   canonical one. `TCP` is keyed by port alone, so it applies to the node's
>   hostname; inside a Service it applies to the Service's hostname;
> - the same, in any foreground config.
>
> Not siblings: a plain-HTTP `Web` entry, to which the browser never sends the
> `Secure` cookie, and a `TCPForward` without `TerminateTLS`, whose backend would
> need a certificate for the canonical hostname, which takes tailscaled operator
> rights. `TCP` entries carrying only `HTTPS: true` or `HTTP: true` are markers that
> tailscaled writes for every `Web` port, tether's own included; they are judged
> through their `Web` entry and otherwise ignored. The parsed `ServeConfig` gains
> `HTTPS`, `HTTP`, `TerminateTLS`, per-handler mount paths and `Services`.
>
> **On a sibling, the daemon revokes.** [Under D2 (c), it logs and prints the
> sibling instead, and the rest of this paragraph doesn't apply.] When a refresh
> finds a sibling, the state becomes *revoking* first, then the auth lane deletes
> every browser device in one atomic write and logs the sibling's `host:port` and the number of devices revoked at `warn`.
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
> sibling is up would leave that copy valid once it is gone. Revoking makes every
> copy a *detected* sibling may hold unknown. It does nothing about a sibling the
> daemon never reads: one published and removed while no browser socket is open,
> before the next browser boot. That is an accepted risk (§ Threat model). HTTPS
> servers that fetch their own Tailscale certificate outside `tailscale serve` are
> invisible to the check. Running one under tether's hostname needs tailscaled
> operator rights, which belong to Jimmy.
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
> headers alone, and they run before any browser-state refresh and before the auth
> lane reads `auth.toml`. A flood of cross-origin requests therefore costs no file
> read and no LocalAPI call.
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
> socket keeps its 10 s timer: it finds the device by kind and hash and applies
> `admit`, and for a browser socket it also refreshes browser state (§ Canonical
> origin, trigger 4) and closes with 4401 or 4503 if browsers are no longer
> admitted. The codes `403 unlock_required` and close 4423 are reserved for C and are
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
>   and `Services`; the browser-state cell holds the last result with its time,
>   coalesces concurrent refreshes, and reuses a result younger than 10 s for
>   socket re-checks. `Store::enroll` reads the cell under the write lock.
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
>   Tailscale check, and never looks at a credential. `http::serve` owns its
>   accept loop; `http/shell.rs` holds the embedded table and the shell slots
>   (daemon-core, "Static shell").
> - The log never carries `Cookie`, `Set-Cookie`, `Authorization` or
>   `Sec-WebSocket-Protocol` values; refusals log the reason and the path.

## 4. `decisions.md` entry

Written for the recommended answers in §2. Under another answer to D2, D5 or D6,
the sibling and control-client bullets change to match.

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
  derived from the serve config. When the daemon sees another HTTPS service
  under that hostname (it reads the serve config at a browser's boot, enrolment
  and upgrade, and every 10 s while a browser socket is open), every browser
  device is revoked and browsers are refused while it stays. Plain-HTTP entries
  and raw TCP forwards don't count. Native admission is unchanged. Only the
  shell, embedded gzipped in the binary, is served before enrolment. Every HTTP
  route bounds its own concurrency and refuses at once when full, behind a
  64-connection backstop in an accept loop the daemon owns.
- **Why:** media `Range` streaming, `<img>`, fetch and the WebSocket all carry a
  cookie without script handling a secret; reusing the device store keeps one
  enrolment, revocation and re-check path. `ts.net` is a public suffix, so every
  machine in the tailnet is same-site: `SameSite` can't separate them and the
  `Origin` and fetch-metadata checks are required controls. A sibling server
  receives the cookie itself, so revocation is what makes a detected sibling's
  copy useless; tailscaled can't announce serve-config changes, so a sibling
  that lives only while no browser is connected goes unseen, and that is
  accepted.
  Jimmy accepts that an unlocked laptop or phone can use the browser client in
  this phase.
- **Changes:** "No `Origin` check" and the invariant "tether never authenticates with
  a cookie" now hold for native credentials only. "The daemon serves no UI" no
  longer holds. `http::serve` owns its accept loop and bounds connections and
  hyper's buffers for every client. The third control client goes (2 control
  clients), to keep the unreclaimable ceiling under `MemoryMax`.
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
  - Counting plain-HTTP entries and raw TCP forwards as siblings: neither can
    receive the `Secure` cookie, and counting them would revoke browsers for every
    `--tcp` forward on the box.
  - Watching for serve-config changes: tailscaled's IPN bus carries none, and its
    state file is root-only. The 10 s re-read rides the socket re-check that
    already exists.
  - A connection cap sized to the routes' sum (24): one cold load filled it and
    queued the native app's reconnect behind it. A `Listener` wrapper for the cap
    alone: it can't set hyper's buffer size, and at hyper's default (8 KiB +
    400 KiB per buffer) 61 connections could hold about 25 MB.
  - Time-bounded waits for the shell (503 after 10 s): a slow link failed the
    same requests on every retry. Waiters are bounded by count instead.
  - Serving the shell uncompressed: twice the transfer and twice the pages.
  - A 10 s idle timeout: it races tailscaled's 90 s idle pool, and a POST sent on
    a connection the daemon is closing gets a 502.
  - Raising `MemoryMax` instead of dropping a control client (as in the earlier
    caps decision).
```

The C seam, recorded in the same entry or in auth.md "Open risks":

```markdown
- **Passkey unlock (C) plugs into:**
  - `auth::admit(device, now)`, one new condition: the device's **unlock window** is
    open. The unlock window is `unlocked_until`, an in-memory map from a browser
    device's credential hash to an instant, held by the auth lane, at most one entry
    per browser device. It is never written to `auth.toml`, so it costs no write on
    the check path, and a daemon restart locks every browser. A passkey assertion
    with user verification opens it. User input slides it in memory, to match
    native's 5-minute lock delay: only the `input` and `paste` messages count.
    Ping, pong and output never do, or an open tab would never lock. A second short-lived cookie was rejected: it
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
- **Resource budget**, "Event-driven only": add "The one timed read is each live
  socket's existing 10 s re-check, which also refreshes browser state, at most once
  per 10 s for the daemon, while a browser socket is open (auth.md, D5)."
  [Dropped under D5 = no.]
- **Running the phone spikes** [under D2 (a); unchanged under (b) or (c)]: step 2
  publishes on plain HTTP, `tailscale serve --bg --http=8080 http://127.0.0.1:5173`,
  and step 3's URL becomes `http://<machine>.<tailnet>.ts.net:8080`. Add why:
  publishing on HTTPS under tether's hostname revokes every browser credential
  (auth.md "Canonical origin"), and plain HTTP stays inside WireGuard. HMR uses
  `protocol: "ws"` and `clientPort: 8080`, or the documented reload fallback.
  Teardown becomes `tailscale serve --http=8080 off`. If G13 fails, step 2
  publishes from the Mac's own tailnet name instead.

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
- **New subsection, "Static shell"** (proposed text). It also sets the bounds for
  every HTTP route, since the shell is what made them necessary:

> **One rule bounds HTTP.** Each route caps its own concurrency and, when its
> waiters are full, answers at once: `503 busy` with `Retry-After: 1`, or 4005 for a
> socket. Waiters are bounded by count, never by a timer. A connection cap sits
> behind them as a backstop, sized above their sum so that ordinary bursts never
> reach it, and the native app's reconnect never queues behind a browser's page
> load.
>
> | Route | Served at once | Waiting | When full |
> |---|---|---|---|
> | `/ws` | 3 sockets | — | close 4005 |
> | file API | 1 scan, 2 raw, 1 upload | 8 on the fs lane | `503 busy` at once |
> | `/complete` | 4 | — | `503 busy` at once |
> | shell | 4 slots | 16, in arrival order, no deadline | `503 busy` at once |
> | auth routes, and each device route's credential read | the auth lane's 2 threads | uncapped; a read takes milliseconds | `503 busy` after the lane's 10 s wait |
>
> Those caps add up to about 40 connections, plus a handful waiting on the auth lane
> and the idle connections tailscaled
> keeps pooled to the daemon: at most 2, held for 90 s (Go's default
> `MaxIdleConnsPerHost`, which Serve doesn't change; `IdleConnTimeout: 90 *
> time.Second` in its proxy transport). The backstop is **64 connections**, so
> reaching it means a flood, and a flood only denies service.
>
> **The accept loop.** `http::serve` owns its accept loop rather than calling
> `axum::serve`. A `Listener` wrapper could cap connections alone, but the memory
> bound needs hyper's buffer size, and axum 0.8.9 builds each connection with
> hyper's defaults and no hook (`serve/mod.rs`). At the default (8 KiB + 400 KiB per
> buffer), 61 connections could hold about 25 MB. The loop:
>
> - takes one of the **64 connection permits** before each `accept`. With none
>   free it stops accepting, and the kernel's listen backlog of 32 holds newcomers.
>   The permit lives inside the connection's I/O wrapper, so it moves into an
>   upgraded socket and is freed only when the socket closes. The wrapper forwards
>   `poll_write_vectored` and `is_write_vectored`, so hyper keeps queueing body
>   `Bytes` instead of copying them into its write buffer;
> - sizes each socket's kernel buffers with `small_buffers`, as today;
> - serves the connection with hyper's `http1::Builder`. The daemon has only ever
>   spoken HTTP/1.1 (axum's `http1` feature), and tailscaled proxies plain-HTTP
>   backends over HTTP/1.1. The builder gets a tokio timer, **`max_buf_size` of
>   16 KiB** (it bounds the read and the write buffer alike, and a request head that
>   doesn't fit is answered 431), a **100 s header-read timeout**, and
>   `with_upgrades()` for `/ws`;
> - inserts `ConnectInfo<SocketAddr>`, the accepted peer, into every request's
>   extensions before the router, because the Tailscale check reads it.
>
> The header-read timeout also closes idle keep-alive connections, since hyper arms
> it at every request head. 100 s is above tailscaled's 90 s idle timeout, so
> tailscaled always closes an idle connection first and never sends a request on one
> the daemon is closing. Go doesn't retry a POST on such a connection, so a shorter
> timeout would turn a rare enrolment or upload into a 502. A slow sender can only be
> a process on loopback, because tailscaled forwards complete heads at once, and the
> permits bound how many such connections there can be.
>
> **Shutdown.** Each connection is spawned into a `JoinSet` and watched by
> hyper-util's `GracefulShutdown`. On the signal the loop stops accepting, sets
> `stop` (every socket closes with 4004, as today), and starts the graceful
> shutdown. At the 2 s deadline it aborts every connection task still in the
> `JoinSet`, so a stalled raw response is closed instead of outliving `serve`. It
> then waits for the upgraded sockets' slots until the same deadline, as today.
> axum spawns upgraded sockets outside the `JoinSet`, so one that misses the
> deadline still holds a `Ctx`, and `main` keeps calling `HubHandle::stop`.
>
> **Packaging.** The release build embeds the shell. `build.rs` reads `web/dist` and
> Vite's manifest, gzips every text asset (HTML, JS, CSS, the manifest, SVG) at level
> 9, and generates a static table of path, bytes, content type, encoding and hash. It
> embeds only the gzip bytes of a text asset; fonts (already woff2) and images are
> embedded as they are. The build fails if a file is missing or the manifest is
> stale. It also fails over **3 MiB embedded, 1.5 MiB for one file, or 128 files**.
> Today's build embeds 2,623,604 bytes in 52 files, 2.1 MB of it the two 1.0 MiB
> woff2 fonts. Embedded bytes are the binary's read-only pages: the daemon and shell
> always match, there is no configured root, and nothing reads the disk on the fs
> lane. Debug builds may read `web/dist` instead.
>
> **Encoding.** A request whose `Accept-Encoding` allows gzip, or that sends none
> (RFC 9110 §12.5.3 then allows any coding), gets the gzip bytes with
> `Content-Encoding: gzip` and `Vary: Accept-Encoding`. One whose `Accept-Encoding`
> excludes gzip gets `406`. Every supported browser sends gzip, and Serve's proxy
> passes both headers through untouched (G1). Shell paths ignore `Range` and answer
> 200 with the whole file.
>
> **Serving.** A shell response takes one of **4 shell slots**, separate from the fs
> raw slots, so a cold load or an update can't starve the file viewer. Up to **16
> requests wait** for a slot, in arrival order and with no deadline; the 17th gets
> `503 busy` with `Retry-After: 1` at once. A waiter's wait is bounded anyway,
> because each slot holder is cut by the deadlines below. The body is **64 KiB
> slices of the embedded bytes**: `Bytes::from_static`, never copied, so a response
> holds no heap beyond hyper's buffers. Two deadlines bound a slow reader: fs raw's
> **30 s stall deadline** for the socket to take the next slice, and a **60 s
> deadline for the whole response**, well above the 13 s a 1.5 MiB file takes at
> 1 Mbit/s. Either aborts the response and frees its slot.
>
> A cold load is about 10 requests: 4 served and 6 waiting, so two browser profiles
> loading at once still fit. The service worker precaches only what opens Home
> (browser-setup "Offline shell and updates"), about 2.3 MB with both fonts. At
> 2 Mbit/s that takes about 9 s, and the requests behind it just wait: no request
> fails for being on a slow link. A burst past 16 waiters gets 503, and a
> service-worker update that meets it fails as a whole and leaves the old version
> active, so it degrades into a retry at the next update check.

- **§6 Limits** (rows added): connection permits 64, the backstop (stop accepting);
  hyper buffer per connection 16 KiB, read and write each (a larger head is 431);
  header-read and idle timeout 100 s (connection closed); shell slots 4 and shell
  waiters 16 (the 17th: `503 busy` at once); shell stall 30 s and response deadline
  60 s (aborted); shell size 3 MiB embedded, 1.5 MiB per file, 128 files (build
  fails); browser credential lifetime 30 days (auth.md); browser-state refresh at
  most once per 10 s while a browser socket is open (auth.md "Canonical origin").
  Changed under D6: control clients 3 → 2. Note under the connection cap that
  browser tabs, the PWA and native all count toward the 3 sockets. That cap is not
  raised here.
- **§6 Memory ceiling** (rows changed and added):

| Item | Bound | MB |
|---|---|---|
| control clients (changed, D6) | 2 × 5.3 MB measured | 11 (was 16) |
| HTTP connections (new): every accepted connection that isn't upgraded, the file API's and the shell's included | 64 permits − 3 sockets = 61 × (16 KiB read buffer + 16 KiB write buffer + ~4 KiB task and connection state) | 2.2 |
| file API (changed: hyper's buffers move to the row above) | scan 1.2 + raw 2 × (64 KiB chunk + channel) + upload (64 KiB chunk + 2 MiB of dirty pages) + listing 0.1 | 4 (was 5) |
| kernel socket buffers (changed) | as before, plus the 4 shell sockets × 256 KiB | 3 (was 2) |
| embedded shell pages (new; clean, file-backed, reclaimable) | the pages touched, at most the 3 MiB embedded (2.6 MB today) | 3.1 |
| **ceiling** | | **~64.5 (was ~65); ~59 the kernel can't reclaim** |

  Below the table, replacing the paragraph after it:

  > **What has to fit.** The ceiling counts every item, reclaimable ones included,
  > as it already did for the completion slab. The rule it is held to is on the
  > rest: what the kernel can't reclaim must fit `MemoryMax`, because the kernel
  > drops clean file pages and reclaimable slab before the OOM killer runs. Here
  > that is the ceiling minus the shell's pages (3.1 MB) and the slab (2.4 MB):
  > about 59 MB, against 64 MB. With 3 control clients it was about 64.3 MB, with
  > no margin, so the third went (decisions.md). The shell's warm pages and the slab
  > still count toward `MemoryHigh` (48 MB), where systemd throttles the unit, so
  > the throttle comes sooner while they are warm. The
  > [budget measurement](plan.md#resource-budget) and gate G12 check it. During the
  > load, sample the unit's `memory.stat` every 100 ms; the largest `anon + kernel
  > + sock − slab_reclaimable` must be at most 64 MB. Record `memory.peak` beside
  > it. The normal case is unchanged.

  [Under D6 = keep 3: the control-client row stays 16, the ceiling is ~69.8 and the
  unreclaimable part ~64.3 MB, and the paragraph says the budget measurement
  decides, by the same pass rule, whether the cap drops to 2.]

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
- "Limits and the memory ceiling": hyper's buffers leave the raw and upload rows.
  They are 16 KiB each now and counted per connection in daemon-core's "HTTP
  connections" row. The file API total becomes ~4 MB.
- "Shutdown must not wait on a stream": the accept loop now aborts a stalled raw
  response's connection task at the 2 s deadline (daemon-core "Static shell"), so
  "axum never force-closes a connection" no longer holds. `main` still calls
  `HubHandle::stop`, because an upgraded socket that misses the deadline holds a
  `Ctx`.
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
  release browser build contains neither. [Under D2 (a):] the *Dev server* URL is
  `http://devbox.tail…ts.net:8080`, and HMR uses `ws:` on 8080.
- "Info.plist" [under D2 (a)]: "no ATS exceptions" holds for Release only. The
  Debug configuration adds an `NSExceptionDomains` entry allowing insecure HTTP
  loads for the dev server's hostname, which G13 confirms is enough for the scheme
  handler's fetch and for HMR. Release builds carry no exception.
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
- "Deployment trap": now enforced by revocation on detection, for HTTPS services
  and TLS-terminated TCP forwards under tether's hostname. Plain HTTP and raw TCP
  forwards are harmless. Add the same-site fact (`ts.net` is a public suffix).
- "Packaging and static delivery": the static bounds this section asks for are set
  in daemon-core "Static shell". The shell is embedded and gzipped, at most 3 MiB.
  It has 4 shell slots and 16 waiters, refusing at once beyond them, under a
  64-connection backstop. Buffers are 16 KiB per connection; deadlines are 30 s for
  a stall and 60 s for a response; the idle timeout is 100 s. Replace "still require
  a small build/resource spike" with G12.
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
| G1 | Through `tailscale serve`: on GET, on POST and on the WebSocket upgrade, the daemon receives `Cookie` (including HTTP/2 split cookie fields, and how they arrive), `Origin`, `Host` (exact value, with or without `:443`) and `Sec-Fetch-*` unchanged. `Set-Cookie` comes back to the browser unchanged, including on `204`. **Safari 26 sends WebSocket upgrades over HTTP/2** (extended CONNECT): Serve must turn them into HTTP/1.1 upgrades to the daemon with those headers intact, and the socket must work | Whether the Host and fetch-metadata rules can hold as written. If Serve rewrites `Host`, compare against what Serve sends and record it. If Safari 26's HTTP/2 upgrade fails through Serve, the browser client doesn't ship on it until it works. Also: a `Content-Encoding: gzip` shell response reaches the browser unchanged, and `Accept-Encoding` arrives as the browser sent it. Record how many backend connections one Safari cold load opens through Serve |
| G2 | Safari on macOS, Safari on iOS, and the installed iOS PWA send the `Strict` `HttpOnly` `__Host-tether` cookie on: the WebSocket handshake after a fresh load, a reload, a tab restored after quitting, history navigation, and a PWA cold launch; on `fetch`; and on `<img>` and `<video>` `Range` requests | `SameSite=Strict`, or the `Lax` fallback (safe because the Origin rules carry the defence) |
| G3 | Fetch metadata on the same requests: GETs (`fetch`, `<img>`, `<video>` ranges) carry `Sec-Fetch-Site: same-origin`; upgrades and POSTs carry either `same-origin` or nothing. `<video>` loads in Safari especially, since WebKit may load media through AVFoundation | If media GETs omit it: allow a missing header on `GET /fs/raw` only, never a value other than `same-origin`. CORP alone then guards those responses. `SameSite` adds nothing, because the tailnet is one site. Recorded: a sibling page in a browser without CORP could embed raw media |
| G4 | WebSocket upgrades and POSTs carry `Origin`, serialized exactly as the canonical origin (no `:443`) | Origin rule as written |
| G5 | On the target iOS release, Safari and the installed PWA keep separate cookie jars; the cookie survives a PWA relaunch and a reboot; Web Inspector shows a 30-day expiry (no 7-day cap on a server-set `HttpOnly` cookie) | The separate-enrolment copy, and D1 holding in practice |
| G6 | The iOS app's WKWebView WebSocket carries no tether cookie; the app's `URLSession` sends no `Origin` or `Sec-Fetch-*` on `POST /auth/enroll` | The ambiguity rule and the native-enrol refusal don't break native |
| G7 | Browser-state derivation agrees with `tailscale serve status` for: Web, TCP and foreground entries; the `HTTPS: true` / `HTTP: true` markers tailscaled writes for every Web port (ignored); a `TCPForward` with `TerminateTLS` (sibling) and without it (not a sibling); a plain-HTTP Web entry on another port (not a sibling); a second mount path inside tether's own Web entry (sibling); tether at a non-root path (refused); tether in a Service; the documented `:8443` spike mapping (sibling, revokes) and the `--http=8080` one (not a sibling) | D2's enforcement, and the canonical-origin derivation |
| G8 | A raw `.svg` and `.html` opened top-level from `/fs/raw` run no script in Safari or Chrome under `CSP: sandbox`; a raw `.js` (`text/plain` + `nosniff`) is refused both as `<script>` and by `serviceWorker.register` | That same-origin raw files can't run as tether |
| G9 | Only if D2 chooses (b), and then **a ship gate**: Tailscale Services or a second node name still adds `Tailscale-User-Login`, and the Funnel and serve-config checks see it | Whether the dedicated hostname works at all; if it fails, D2 falls back to (a) |
| G10 | From a page on a sibling tailnet machine, from another port of the same machine, and from a **plain-HTTP page** on a tailnet host (in a staging setup, not production): WebSocket hijack, `fetch` POST, form POST, and `<img>`/`<video>` of `/fs/raw` all fail (403 or blocked by CORP). A cookie set or **overwritten** from a sibling port, and a tossed duplicate from the plain-HTTP page, never admit anything | The cross-origin defence end to end, and L1's impact being denial of service only |
| G11 | In Safari, iOS Safari, the installed PWA and Chrome, with a valid cookie: a typed URL, a bookmark, a PWA cold launch and a link from another app (`Sec-Fetch-Site: none` or `cross-site`) all load the shell, which then connects | The shell routes never judging credentials (M1) |
| G12 | On the dev box, under the systemd unit, with every other cap held as in daemon-core §6: two browser profiles cold-loading at once and a service-worker precache, plus 3 sockets, a raw stream and an upload, with some readers throttled to 64 kbit/s; then a flood of 64 connections. Sample `memory.stat` every 100 ms. **Pass:** the largest `anon + kernel + sock − slab_reclaimable` is at most 64 MB; no shell request gets 503 in the two-profile load, however slow its link; with 64 connections held, a 65th waits in the backlog and is served when one closes; the native app reconnects during the two-profile load without waiting; slow readers are cut at 30 s or 60 s; an idle keep-alive connection closes at 100 s, after tailscaled has closed it at 90 s. Record `memory.peak`, the shell pages' share (`file`), and the backend connection count | The memory-ceiling rows, D6, the backstop's headroom, and the idle-timeout ordering (N8) |
| G13 | Only under D2 (a): a spike published with `tailscale serve --http=8080`, loaded through the Debug app's dev-server switch on a real iPhone. The scheme handler's fetch works with only a Debug `NSExceptionDomains` entry for the dev host; HMR over `ws:` connects from `tether-app://ui`, or the reload fallback works; a keyboard spike behaves as it does over HTTPS | Whether spikes can stay on the dev box under (a). If not, they publish from the Mac's tailnet name, and that cost joins D2's table |

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
  /auth/enroll` with `Origin` is 403. **Race:** with the store paused after an
  enrolment's first refresh saw *admitted*, a refresh that finds a sibling, then
  the enrolment resumed, leaves no browser device in `auth.toml` and answers `503
  browser_unavailable`; in the other order, the revocation write removes the new
  device.
- **Lifetime:** a browser device past `expires_at` is 401; a live socket closes 4401
  at the next re-check after expiry; a browser row with a bad `expires_at` is refused
  alone, and other devices keep working.
- **Logout:** 204 and a clearing cookie; the device is gone from `auth.toml`; a
  second socket on the same credential closes 4401 within 10 s; an unknown cookie and
  no cookie at all both get 204 and clearing.
- **Browser state:** from fixture serve configs. A sibling HTTPS Web port, a second
  mount path in tether's entry, or a `TCPForward` with `TerminateTLS` on another
  port revokes every browser device in one write and gives `503
  browser_unavailable` / 4503 until it is gone. A plain-HTTP Web port and a
  `TCPForward` without `TerminateTLS` revoke nothing.
  Native requests are unaffected throughout. A failed revocation write keeps
  browsers refused even after the sibling is removed. `HTTPS: true` markers alone
  admit. An unreadable config, two publications with no `browser_origin`, a
  `browser_origin` that tether doesn't publish, and tether at a non-root path are
  all refused, revoke nothing, and set `/auth/info.browserOrigin` to `null` with the
  reason. Count LocalAPI calls: browser enrolment, a browser upgrade and
  `/auth/browser/session` each trigger a refresh, after admission; a cross-origin
  request on those routes, a native upgrade and every other request trigger none.
  With two browser sockets open for 30 s, the re-checks make at most 3 or 4 reads;
  with only native sockets, none. A sibling added while a browser socket is open
  closes that socket with 4401 within 10 s.
- **Static shell:** shell paths answer before enrolment with the CSP and cache
  headers above; `If-None-Match` on `/` gives 304; unknown `/fs/…`, `/auth/…` and
  `/ws…` paths are JSON 404, never HTML; a failed Tailscale check is 403 on shell
  paths too. With 4 shell responses held, 16 more wait for as long as it takes, and
  the 17th gets `503 busy` at once; no shell request ever gets 503 for waiting. A
  reader that stops reading is aborted at 30 s. A text asset comes back gzipped
  with `Vary: Accept-Encoding`, with or without an `Accept-Encoding` header;
  `Accept-Encoding: identity` gets 406. A request head over 16 KiB gets 431. A
  connection that sends no complete head in 100 s is closed. A 65th connection
  isn't accepted until one closes. The Tailscale check sees the peer address
  (`ConnectInfo`) on every route. On shutdown, sockets get 4004 and a stalled raw
  response is closed by the 2 s deadline. The build fails on a missing asset, a
  stale manifest, or a shell over the size limits.
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
- Build measured (2026-10-23): `web/dist`, 52 files, 5,225,026 bytes raw. Embedded
  as specified (text assets `gzip -9`, woff2 and images as they are): 2,623,604
  bytes, the largest file the 1,062,428-byte JetBrains Mono Bold woff2. The two
  fonts are 2.1 MB of it.
- Library source, revision 3: hyper 1.12 `proto/h1/io.rs`. `max_buf_size` sets both
  the read strategy's maximum and the write buffer's (`set_max_buf_size`), must be
  at least 8 KiB, and a head that overflows it is `Parse::TooLarge`, which
  `role.rs` answers 431. With vectored I/O, hyper queues body buffers instead of
  flattening them. `http1::Builder` has `timer`, `header_read_timeout`,
  `max_buf_size` and `max_headers`. hyper-util 0.1.21 has `server::graceful`.
  `Cargo.toml` enables only axum's `http1`.
- Upstream tailscale `ipn/ipnlocal/serve.go` (fetched 2026-10-23): the proxy
  transport sets `MaxIdleConns: 100`, `MaxIdleConnsPerHost` from a debug envknob
  (default 0, which is Go's 2), `IdleConnTimeout: 90 * time.Second`, and no
  `MaxConnsPerHost` or `DisableCompression`. It doesn't touch `Accept-Encoding` or
  `Content-Encoding`. Plain-HTTP backends get HTTP/1.1, except gRPC, which gets h2c.
- Code, revision 3: `Auth::recheck` (`src/auth/mod.rs`) reads `auth.toml` on every
  10 s re-check; `http::serve` (`src/http/mod.rs`) uses `tap_io` for
  `small_buffers`, `into_make_service_with_connect_info`, a 2 s `SHUTDOWN_WAIT`, and
  4004 on stop. Client messages that carry user input are `input` and `paste`
  (`src/proto/messages.rs`).
- ios-shell.md "Dev mode" (the scheme handler fetches dev-server assets; the origin
  stays `tether-app://ui`) and "Info.plist" (no ATS exceptions); plan.md "Spikes"
  ("The spikes come first") and "Resource budget" ("no polling timers"), and the
  lane table (auth waiters uncapped).
- Docs: `docs/design/auth.md`, `plan.md` "Security", "Resource budget" and "Running
  the phone spikes" (the `:8443` mapping), `daemon-core.md` §5.1–5.2 and §6 (the
  ~65 MB ceiling and the control-client rule), `fs.md` "Constants" and "Limits and the
  memory ceiling", `ios-shell.md`, `client/browser-setup.md` (the static-load gate),
  `client/connection-roadmap.md`, `decisions.md` "Auth".
- [Security review 2](browser-auth-review-2.md): the IPN bus has no serve-config
  notification; Serve preserves `Host` for TCP backends; hyper's
  `header_read_timeout` covers idle keep-alive.
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
| **Round 1** | | |
| H1 refusing protects nothing already leaked | **Fixed; reworked in round 2 (N1, N2).** D2 offers (a) revoke on detection, (b) a dedicated hostname with G9 as a ship gate, (c) a warning. It recommends (a). The rationale now separates a sibling page (stopped by admission) from a sibling server (handled by revocation). The between-refreshes gap is accepted | §1, §2 D2, §3.2, §3.6, §4, G7, G9 |
| H2 static HTTP unbounded | **Fixed; the bounding scheme was redesigned in round 2 (N3–N5, N10).** Shell embedded with build-time size limits; per-route caps behind a connection backstop; 4 shell slots; bounded buffers; stall and response deadlines; ceiling rows, and the third control client as what gives | §5 daemon-core "Static shell" and §6, fs.md, browser-setup; G12; static-shell checks |
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
| **Round 2** | | |
| N1 D2(a)'s protection overstated | **Fixed.** The claim now matches what revocation does: it makes a *detected* sibling's copies unknown. The residual is stated per option in one sentence each. Refreshing on the 10 s re-check is its own decision (D5), with its cost against "no polling" spelled out: at most one loopback read per 10 s, only while a browser socket is open, riding a timer that already reads `auth.toml` | §1, §2 D2 and D5, §3.2, §3.6, §3.7, §4, plan.md "Resource budget" |
| N2 spike workflow contradicts the (b) rejection | **Fixed.** Plain-HTTP entries and `TCPForward` without `TerminateTLS` are no longer siblings. Each option states its workflow cost and where spikes go. Under (a), spikes publish on `--http` (they run inside the app, so the page keeps its secure origin), with a Debug-only ATS exception; G13 checks it, and the Mac's own name is the fallback. The question that would flip the recommendation to (b) is stated | §2 D2, §3.6, §5 plan.md and ios-shell.md, G7, G13 |
| N3 accept cap blocks native behind bursts | **Fixed by the redesign.** Per-route caps refuse at once; the connection cap is a 64-connection backstop above their sum (~40, plus the auth lane's handful and tailscaled's ≤ 2 idle). The daemon owns its accept loop, because the memory bound needs `max_buf_size`, which a `Listener` wrapper can't set. `ConnectInfo`, `small_buffers`, graceful shutdown and 4004 are specified | §5 daemon-core "Static shell" and §6, §3.12, §4, G12, static-shell checks |
| N4 10 s shell wait fails slow links | **Fixed by the redesign.** 16 shell waiters bounded by count, no deadline, the 17th refused at once. The shell is embedded gzipped (2.6 MB, from 5.2 MB) | §5 daemon-core "Static shell", browser-setup, G12, static-shell checks |
| N5 shell pages left out of the ceiling | **Fixed.** A reclaimable row for the shell's pages, at the 3 MiB build cap. The accounting rule is stated: everything counts, and the part the kernel can't reclaim must fit `MemoryMax`. G12's pass rule is written down from `memory.stat`. The result, ~64.3 MB with 3 control clients and ~59 MB with 2, is decision D6 | §1, §2 D6, §5 daemon-core §6, G12 |
| N6 enrolment races revocation | **Fixed.** The enrol write re-reads browser state under the store's write lock, and a refresh sets *revoking* before queueing the revocation write, so neither order leaves a browser device behind | §3.5, §3.12, "Enrolment" check |
| N7 refresh triggers ambiguous | **Fixed.** Every trigger is on the browser lane only and after admission. A browser upgrade admits on the refreshed state, and native never refreshes or consults it | §3.6, §3.7, "Browser state" check |
| N8 10 s idle close races tailscaled's pool | **Fixed.** The header-read (and idle) timeout is 100 s, above tailscaled's 90 s `IdleConnTimeout`, so tailscaled always closes first. Slow heads can only come from loopback, and the permits bound them | §5 daemon-core "Static shell" and §6, G12 |
| N9 unlock slides on pings | **Fixed.** Only `input` and `paste` messages slide the unlock window | §4 C seam |
| N10 connection row assumed a 32 KiB read buffer | **Fixed.** `max_buf_size` is 16 KiB and bounds both buffers, and the row counts both at their maximum for every non-upgraded connection | §5 daemon-core §6 |
