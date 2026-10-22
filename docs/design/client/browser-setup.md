# Browser and phone PWA: recommended setup

Research date: 2026-10-22. **Recommendation, not shipped functionality or an approved
security implementation.** Desktop/mobile redesign remains a mockup. The phone
browser must be installable as a PWA; this is a product requirement, not an optional
future feature. Existing native app and backend invariants remain in force.

## Roadmap and authentication status

The later [connection roadmap](connection-roadmap.md) sets Tailscale first and public
HTTPS as the intended follow-up. Tailscale-identity-only access was discussed as a
simpler alternative to extra browser enrolment. The cookie design below remains a
candidate, not a settled requirement; first-phase authentication must be chosen and
reviewed before coding. No current device-token or tailnet-only protection is removed.

## What exists today

Source inspection at `76f3d2c` found:

| Evidence | Current behavior / consequence |
| --- | --- |
| `web/main.tsx`, `web/native/bridge.ts` | Release boot expects a native bridge; ordinary-browser fallback exists only in DEV. Merely hosting `web/dist` is insufficient. |
| `web/vite.config.ts`, `web/dev/shim.ts` | Development proxy injects owner identity, uses JS-readable dev credentials and simulated phone geometry. Not a deployment template. |
| `src/http/mod.rs`, `src/auth/mod.rs` | API-only daemon, bearer/subprotocol credentials, no cookie support or Origin checks. New browser auth is a deliberate security-design change. |
| `web/term/xterm.ts`, `web/eslint.config.js` | Native owns input; xterm stdin is disabled and lint bans browser editing controls outside dev. Add a real browser input boundary rather than removing native safeguards globally. |
| `web/net/host.ts`, `web/term/size.ts` | Reconnect/background handling and keyboard-independent tmux sizing already exist and should be reused. |
| `src/http/ws.rs` | Three sockets total per daemon, not per browser tab/device. |

Read-only runtime check confirmed the current local Vite preview serves HTTP 200 and
its user services run; that does not verify a production bundle or phone behavior.
No live tmux attachment, service reconfiguration or production implementation was
performed for this research.

## Recommended shape

```text
Desktop browser / phone browser / installed phone PWA
          HTTPS + WSS over the tailnet
                      |
               Tailscale Serve
                      |
        tether daemon on loopback only
          | static browser bundle
          | auth, /ws, /fs, /complete
                      |
              existing tmux server

Native iPhone shell: bundled shared UI + native platform adapter
                    -> same daemon and protocol
```

One responsive Preact/xterm client, two platform adapters (browser and native), one
backend. PWA is an installation mode of the browser client, not a fourth UI or a
second terminal implementation. Keep existing framework and protocol; no Next.js,
SSR, extra Node production server, or hosted relay is needed for this application.

Build browser assets with Vite and serve the resulting versioned files from the
existing daemon. Prefer a release-packaged, explicit asset set over a configurable
arbitrary filesystem root. Release packaging must build web assets before Rust and
fail on missing/stale files. Native bundles its platform entrypoint and the same
shared UI; it does not register the browser service worker. Packaging/embedding
choice and memory impact still require a small build/resource spike. Set explicit
bounds for concurrent static responses, bytes buffered per response, total shell/cache
size, slow-client timeouts and simultaneous startup/update load. The WebSocket cap
does not bound accepted HTTP connections or static responses; measure those separately.

Serve UI, API, and WebSocket from one canonical HTTPS origin at the origin root.
This removes cross-origin credential/media plumbing. Reserve API paths before static
routing: unknown API routes stay errors, never fall through to HTML. Hash-based UI
navigation is sufficient initially, avoids server-side route fallback, and must
still implement the approved Back/modal hierarchy. No credentials in URLs.

This is a recommendation inferred from the current repo and deployment requirements.
[Vite's production guidance](https://vite.dev/guide/static-deploy.html) explicitly
separates built assets from its development/preview servers.

## Network and authentication

Tailscale handles private connectivity and HTTPS, not the browser's UI or keyboard.
The phone still needs an active tailnet connection. Use Serve, never Funnel; retain
the allowlisted Tailscale identity check and app device authorization. Serve strips
spoofed identity headers; tagged clients do not receive user identity headers. The
loopback backend is a trusted-local-process boundary, not protection from hostile
processes already on the server.
[Tailscale documentation](https://tailscale.com/docs/features/tailscale-serve).

### Browser credential candidate: server-issued cookie

Use a server-issued, revocable opaque browser credential in a host-only
`__Host-tether` cookie (`Secure; HttpOnly; SameSite=Strict; Path=/`; no Domain).
Reuse existing device-store/enrolment/revocation machinery rather than inventing a
second user database. Native keeps its Keychain/bearer/subprotocol transport.
Browser and native credential types must be distinguished so a stolen browser cookie
cannot bypass browser Origin policy by being presented as a native bearer token.
Exact store fields, expiry/rotation and endpoint schema require auth-spec review.

**Threat-model decision required:** native tokens are protected by biometric-gated
Keychain access, including the unlocked-phone threat described in auth.md. An ambient
browser cookie is not an equivalent unlock mechanism. Before shipping, explicitly
accept reduced browser/PWA protection or design a reviewed reauthentication mechanism;
include session lifetime and offline draft visibility. A frontend-only lock screen
does not protect an already usable credential. Do not claim Face ID parity.

First browser/PWA launch shows enrolment, using the existing approved device-code
flow. The browser enrolment response sets the cookie without returning its secret
in JSON. HTML/manifest/install icons are available after the tailnet check without
requiring an already enrolled device; APIs remain device-protected. Never silently
mint credentials from Tailscale identity alone or ship the dev shim's injected owner
login. Logout revokes the browser device credential and closes its live connections;
separately explain whether local drafts are retained or explicitly cleared.

Cookies let fetch/media and WebSocket share credentials without exposing the token to
JavaScript or inventing query-string tokens. The browser WebSocket API exposes URL
and subprotocol parameters, not arbitrary request headers.
[WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket),
[cookie attributes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

### Required controls, not optional hardening

- Validate an exact configured public Origin (scheme, hostname, port) for browser
  WebSocket upgrades and mutation requests, including enrolment/logout. No wildcard,
  suffix matching, reflected arbitrary Origin, or null-Origin cookie exception.
- Add explicit anti-CSRF protection for cookie-authenticated mutations. Keep safe
  GETs side-effect free; no permissive credentialed CORS. Native auth has a separate,
  reviewed admission rule and must not weaken browser checks.
- Validate public Host against deployment configuration, not arbitrary forwarded
  headers. Reject ambiguous/mixed credentials; preserve bounded auth work and socket
  caps and existing device-revocation checks.
- No token/cookie/subprotocol secrets in request logs. Use restrictive CSP including
  no framing, no inline script exceptions for previews, and narrow connection sources.
  Serve raw user files with correct MIME/nosniff and safe disposition; never execute
  arbitrary uploaded HTML on the app origin.

These are proposed requirements derived from
[OWASP WebSocket guidance](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html).
HttpOnly reduces credential theft via script; it does not stop XSS from making
requests. Authentication design needs an independent security review before coding.

**Deployment trap:** cookies are not isolated by port. A dev preview at another
port of the same hostname can receive a production cookie. Before enrolment goes
live, remove/move development services from that hostname or use a dedicated hostname
with a reviewed Tailscale deployment. Path scoping is not an isolation boundary.
Do not overwrite existing Serve mappings during setup.
[RFC 6265 §8.5](https://httpwg.org/specs/rfc6265.html#section-8.5).

### Alternatives considered

| Approach | Decision and tradeoff |
| --- | --- |
| Keep current bearer + WS subprotocol, browser JS owns credentials | Smallest backend change and preserves cookie-free CSRF model. Requires browser token storage/re-enrolment policy and explicit authenticated media fetching; blob-loading large media conflicts with efficient range streaming. Viable alternative if cookie-origin gates cannot be met, not selected by default. |
| HttpOnly browser credential + typed native credentials | Recommended for normal fetch/media/WS and reduced persistent token exposure to JS. Costs explicit CSRF/Origin policy and auth-spec migration; does not make XSS harmless. |
| Tailnet identity alone | Reject: removes per-device enrolment/revocation boundary. |
| Vite production proxy or separate public frontend host | Reject: dev identity spoofing is not auth; separate origin adds credential, CSP/CORS and deployment complexity without product value. |
| Separate desktop, mobile and PWA applications | Reject: duplicates terminal state and reconnect behavior. |

The existing auth.md cookie-free/no-Origin decision remains current until a reviewed
replacement is approved and implemented. This document is the proposed replacement,
not permission to add cookies to the old middleware without changing its threat model.
Before changing that boundary, update auth.md, the decision log, protocol/bridge specs
and security probes together. Do not infer native readiness from target-design files.

## Required phone PWA behavior

- Ship a manifest with stable `id`, `name`/`short_name`, `start_url`, `scope`,
  `display: standalone`, theme/background colors, and suitable 192/512px and maskable
  icons; provide an Apple touch icon. Keep identity stable across releases.
- Phone browser remains fully usable without installation. Offer a small install
  affordance with platform-specific instructions, not a forced install screen.
  On iPhone use Add to Home Screen/Open as Web App; do not rely on a universal
  programmatic install prompt. Native app remains separate.
- Standalone mode follows the same compact mobile layout and normal keyboard rules,
  accounting for safe areas and keyboard geometry. No fake keyboard or fixed device
  dimensions from the dev harness.

A service worker is not intrinsically necessary for installation. We recommend one
for the narrow offline shell/draft experience below, not to keep a terminal socket
alive. Installation criteria vary across browsers.
[MDN installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable),
[Safari 26 web apps](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).

### Offline shell and updates

Use a build-generated asset manifest and a small service worker caching only explicit
public shell assets. Precache the minimum needed to open Home and drafts; don't
precache every syntax-highlighter language. Never cache auth/API/file responses,
terminal snapshots, uploads, completion results, or credentials. APIs are network-only
with `no-store` responses. No Background Sync for commands, keystrokes, paste or
uploads; offline actions must not later run implicitly.

Use versioned caches and content-hashed assets. Install the complete new shell before
making it available. Keep the prior version working during updates; show Update ready
and reload only after draft persistence and explicit user acceptance. No unconditional
skipWaiting/clients.claim or automatic reload mid-composition. Multi-window update
coordination and server protocol compatibility must be tested; mismatch disables
input and explains reload, not retries. Prefer lifecycle-triggered update checks over
polling. Cache only this app's namespaces and remove obsolete versions safely.
[Service-worker lifecycle](https://web.dev/articles/service-worker-lifecycle).

Offline launch shows Disconnected and the locally saved drafts, not a pretend live
terminal. Never allow Insert against a stale or different window. Preserve immutable
target identity and explicit delivery uncertainty. Do not cache terminal/file content
for offline reading in the minimal pass.

### Drafts, installation and lifecycle

Prefer bounded IndexedDB storage for drafts and workspace metadata, with stable
host/window identity and a schema version. Save small changed records, not the whole
workspace per keystroke. Expose save failure and Clear; request persistent storage
where supported without promising it. Storage is not encryption or guaranteed backup.
[WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).

Treat Safari and the installed PWA as potentially separate enrolments and draft
stores. Do not promise that installation transfers them or silently sync drafts.
First-launch guidance must explain this distinction, and installation tests must
check actual cookies/drafts on the target iOS release.
[WebKit's storage isolation documentation](https://webkit.org/tracking-prevention/).

Suspend/reconnect is normal. Persist incrementally, not just on unload; observe
visibilitychange/pagehide/pageshow and connectivity hints through one lifecycle owner.
Hidden clients release watches/connections per the resource policy, without closing
UI tabs or tmux processes. On resume reauthenticate/reconnect and receive a fresh
snapshot before permitting input. navigator.onLine is a hint, not proof that the
Tailscale route or daemon is reachable. Do not promise background sockets or use a
service worker as a persistent terminal transport.
[Mobile pagehide limitations](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event).

## Platform boundary and implementation sequence

Keep shared tab/window state, protocol, reconnect, terminal rendering, files and layout.
Replace the native-only assumption at boot with explicit browser/native adapters for
credentials, input/focus, viewport/lifecycle, storage, file selection and link opening.
Avoid scattered user-agent branches or promoting `web/dev/shim.ts` into production.
Browser direct input must handle composition/input/paste; local drafts own their own
editing and never feed keystrokes into tmux. Use the normal platform keyboard.

1. Review auth/origin/credential-type design and deployment hostname; settle browser
   admission in auth.md and protocol compatibility before implementation.
2. Build the real browser adapter and packaged static delivery, with same-origin
   enrolment and explicit offline/disconnected states. Native remains functional.
3. Implement approved Home/Terminal/Files layouts and phone PWA manifest/install UX.
4. Add local drafts and narrow shell caching/update behavior. Prototype iPhone
   keyboard visibility, scroll/selection/click arbitration and correct logical copy.
   Fix wrap metadata capture/restore before claiming newline-correct copy.
5. Verify built production assets, not only Vite dev mode, against isolated tmux 3.4
   and 3.7b and actual desktop/Safari/PWA/native clients before shipping.

Browser implementation can proceed on Linux alongside the Mac keyboard spike once
shared interfaces are settled. Lack of an iPhone does not block desktop serving/auth
work; it does block signing off on phone input, clipboard, and lifecycle behavior.

## Acceptance checks

- Fresh browser and fresh installed PWA enrol; no credential appears in URL, JS storage
  or logs. Revocation/logout closes access and live sockets; denial is recoverable.
- Cross-origin form/fetch/WS and null Origin, wrong Host, duplicate credentials,
  direct nonloopback and spoofed Serve headers fail. Native cannot act as an Origin
  bypass for a browser credential. Same-host other-port exposure is removed.
- Built bundle runs without window.webkit or dev shim. Native bundle needs no service
  worker, public web origin or browser cookie to boot.
- Install/relaunch with Tailscale on/off, offline launch after first use, Safari vs PWA
  storage, force-quit, background/foreground, rotation, ordinary/hardware keyboard.
- Upgrade with an active terminal, unsaved IME composition, multiple windows and old
  cached assets; no lost draft, duplicate input or mixed-version API calls.
- Storage unavailable/evicted/full, browser logout, lost server/window, uncertain
  Insert delivery; draft survives normal hiding and reload without accidental send.
- Bound connections for browser + PWA + native: current daemon cap is three admitted WebSockets, not three HTTP connections. Do not
  increase it blindly; show an actionable over-cap state and measure resource use.
- Existing touch/copy matrix in terminal-interaction-design.md, especially copying
  after reconnect and history loading, remains a release gate.

## Recommendation review

Independent security/architecture review approved this direction with notes, not an
implementation. Its two medium omissions are now explicit gates: browser protection
relative to biometric native unlock, and bounded static HTTP startup/update load.
Actual Serve Host forwarding, cookie admission, cache policies, installation and
resource behavior remain to verify. Existing raw-file sandbox/nosniff protections
must survive hosting changes; private no-cache is not equivalent to the recommended
no-store policy. No production source or service settings changed in this research.
