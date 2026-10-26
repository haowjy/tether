# Handing the enrolled host to the app

Jimmy's ask: from Safari or the PWA, after the link enrols the browser, hand the same host
to the tether app so he does not enrol twice.

## Why not Universal Links

The origin is a per-machine tailnet host (`<machine>.<tailnet>.ts.net`). Universal Links
need the host to serve `apple-app-site-association` where Apple's CDN can fetch it, and
the CDN cannot reach a private tailnet address. Separately, the wildcard development
profile in use cannot carry `com.apple.developer.associated-domains` without an explicit
App ID. Tried far enough to see the second wall; abandoned by Jimmy's call.

## The fact that makes one code cover the phone

Enrolment has two paths, and only the browser's covers the phone:

- `POST /auth/node/enroll` (the web Enrol screen) admits the **node**, keyed by
  tailscale's whois of the request (`src/http/node_auth.rs`, `Session::Node`).
  `src/auth/mod.rs` admits any request from an enrolled node with no token.
- `POST /auth/enroll` (the app, with a code) mints a **device token** for one client.

The app cannot simply go tokenless: its web UI is served from `tether-app://ui`, so the
terminal WebSocket carries that origin, and node-lane admission requires the canonical
HTTPS origin. So the app needs a token — and now it can mint one from its node.

## Shape (as built)

- **Scheme:** `tether://add?host=<percent-encoded origin>`. No code travels in it.
- **Web:** after the browser enrols, a one-time banner offers "Open in the tether app";
  it is not shown inside the app's own web view, and only on a platform where the app can
  exist. Its fallback text names the `https://` origin, which the app accepts with the
  code left empty.
- **App:** the link opens Add server with the host filled and the code empty. Add posts
  `POST /auth/node/enroll` with `{"code":"", "deviceName":…}` and `Origin` only. An
  already-enrolled node mints a native token bound to that node; an unenrolled one
  answers `not_enrolled`, and the app tells the reader to run `tether enroll`.
- **Daemon:** the mint refuses anything carrying browser fetch metadata (so script on
  tether's origin cannot trade CSRF-adjacent access for a portable token), rotates the
  node's previous token, and native checks require the binding's node row to still exist,
  so removing the node revokes what it minted.

## Out of scope

- Universal Links (above).
- Enrolling the browser from the app.
- A Settings entry for the handoff; the banner is the entry point.
