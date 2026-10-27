# Browser setup and phone PWA

This is the browser/PWA delivery contract. Authentication and security rules live in
[auth.md](../auth.md); product navigation and platform behavior live in
[browser behaviors](browser-behaviors.md) and the surrounding client specs.

## Browser authentication and delivery

A browser or installed PWA presents no bearer token, cookie, or other credential. The
daemon admits it as an enrolled Tailscale node, trusting every browser and process on
that machine until Jimmy removes the node. Enrolment uses the same one-time code as
the native app; `/auth/node/session` names an unenrolled node, and “Remove this
device” revokes all browser profiles on it. Local drafts remain local; clearing them
is a separate action. The native iOS app keeps its Keychain token and Face ID lane.

The node lane exists only on `serve.sock`, published as the sole root handler of one
HTTPS Serve entry with Funnel off. The daemon checks the exact forwarded host,
`Origin` on upgrades and mutations, `Sec-Fetch-Site: same-origin` on reads, and
uncached LocalAPI whois for the forwarded node address on every node-lane request.
Other origins on an enrolled node are refused before whois; other ports and tailnet
hosts do not receive the node lane. The trusted browser machine is the credential,
not the browser profile. Public HTTPS will need a separate portable-credential lane
and security design; this contract does not enable it.

The daemon serves the production browser build at its canonical origin from explicit
static routes. `build.rs` runs the web production build and embeds raw and deterministic
gzip assets, with build-time limits of 192 files, 8 MiB total and 1.5 MiB per file.
Four responses may stream concurrently, 16 wait in order, and a 30 s write stall
aborts the response. Unknown paths, including unknown API routes, are 404 rather than
rewritten to the shell. The generated manifest is named `tether <host>`. Hashed
assets are immutable; the shell entry, manifest and service worker revalidate.

The shell, `/auth/info` and enrolment flow are reachable after the Tailscale check but
before device enrollment, so a bookmark or cold PWA launch can load the page. APIs,
completion, files and WebSockets require either a valid native token or an enrolled
node. Responses other than shell files use `Cache-Control: no-store` and
`Cross-Origin-Resource-Policy: same-origin`; file responses also retain
`nosniff`, `Content-Security-Policy: sandbox` and non-executable source MIME types.
The browser shell uses a restrictive CSP. There are no cookies or credentialed CORS.

Actual Serve header behavior, LocalAPI fields and latency, iOS Safari/PWA networking,
raw-file active-content behavior, and resource limits remain deployment/device probe
gates. See [auth.md §Probe gates](../auth.md#probe-gates) and
[daemon-core.md §6](../daemon-core.md#6-limits-and-the-memory-ceiling).

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
terminal. Never send a line to a different tab than the one it was written in; it goes to the window that tab shows when it is sent. Preserve immutable
target identity and explicit delivery uncertainty. Do not cache terminal/file content
for offline reading in the minimal pass.

### Drafts, installation and lifecycle

Prefer bounded IndexedDB storage for drafts and workspace metadata, with stable
host/session identity and a schema version. Save small changed records, not the whole
workspace per keystroke. Expose save failure and Clear; request persistent storage
where supported without promising it. Storage is not encryption or guaranteed backup.
[WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).

Treat Safari and the installed PWA as potentially separate draft stores. Node
enrolment is machine-wide, not profile-specific. Do not promise that installation
transfers drafts or silently sync them. First-launch guidance must explain this
distinction, and installation tests must check storage on the target iOS release.
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

Keep shared tab state, protocol, reconnect, terminal rendering, files and layout.
Replace the native-only assumption at boot with explicit browser/native adapters for
credentials, input/focus, viewport/lifecycle, storage, file selection and link opening.
Avoid scattered user-agent branches or promoting `web/dev/shim.ts` into production.
Browser direct input must handle composition/input/paste; the line field owns its own
editing and sends nothing to tmux until Return. The dock's key row supplements the
normal platform keyboard.

1. Build the browser adapter and enrolment UI against the settled node lane in
   [auth.md](../auth.md). Native remains on its independent token lane.
2. Implement approved Home/Terminal/Files layouts and phone PWA manifest/install UX.
3. Add the phone dock with its drafts, and narrow shell caching/update behavior. Prototype iPhone
   keyboard visibility, scroll/selection/click arbitration and correct logical copy.
   Fix wrap metadata capture/restore before claiming newline-correct copy.
4. Verify built production assets, not only Vite dev mode, against isolated tmux 3.4
   and 3.7b and actual desktop/Safari/PWA/native clients before shipping.

Browser implementation proceeds on Linux once shared interfaces are settled. Lack of an iPhone does not block desktop serving/auth
work; it does block signing off on phone input, clipboard, and lifecycle behavior.

## Acceptance checks

- Fresh browser and fresh installed PWA enrol through the shared code; no credential
  appears in URL, JS storage or logs. Removing the node revokes access and live
  sockets; denial is recoverable.
- Cross-origin form/fetch/WS and null Origin, wrong Host, duplicate forwarded headers,
  direct nonloopback and spoofed Serve headers fail. Native tokens cannot act as an
  Origin bypass for the node lane. Same-host other-port exposure is removed.
- Built bundle runs without window.webkit or dev shim. Native bundle needs no service
  worker, public web origin or browser cookie to boot.
- Install/relaunch with Tailscale on/off, offline launch after first use, Safari vs PWA
  storage, force-quit, background/foreground, rotation, ordinary/hardware keyboard.
- Upgrade with an active terminal, unsaved IME composition, multiple windows and old
  cached assets; no lost draft, duplicate input or mixed-version API calls.
- Storage unavailable/evicted/full, node removal, lost server/session, uncertain
  Return delivery; draft survives normal hiding and reload without accidental send.
- Bound connections for browser + PWA + native: current daemon cap is three admitted WebSockets, not three HTTP connections. Do not
  increase it blindly; show an actionable over-cap state and measure resource use.
- Existing touch/copy matrix in terminal-interaction-design.md, especially copying
  after reconnect and history loading, remains a release gate.

## Recommendation review

Serve header forwarding, LocalAPI behavior, raw-file active-content protection,
installation and resource behavior remain deployment/device gates. No browser cookie
or cross-origin credential path is part of this contract.
