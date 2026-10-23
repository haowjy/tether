# Design the first-phase browser/PWA authentication for tether

tether is a Rust daemon plus a web client that today runs only inside a native iOS app. It is gaining a desktop browser client and an installable phone PWA, served from the daemon on the tailnet. Design how browsers authenticate. Produce a spec draft that Jimmy (the owner) can approve when he wakes up, and that a security reviewer will check before he does.

## Jimmy's decision (2026-10-22)

**Option A, built so Option C can be added later.**
- A: first visit shows an enrolment screen. Jimmy runs `tether enroll` on the server and types the one-time code. The daemon then sets an `HttpOnly` host-only cookie that it tracks as a *browser* device credential. Revocation uses the existing device store. Jimmy **accepts that, for the Tailscale-only phase, anyone holding his unlocked phone or laptop can use the browser client**. No Face ID equivalent yet.
- C, later (likely with the public-HTTPS phase): a passkey (WebAuthn user verification: Face ID on iPhone, Touch ID on Mac) unlocks or renews the browser session. A must not need reworking when C arrives: name exactly which seam C plugs into, and what A builds now so that it can.
- Rejected: B (token kept in browser JS storage, sent as bearer/subprotocol): readable by injected script, and media Range streaming via `<video src>` becomes awkward. D (Tailscale identity only): no per-device enrolment or revocation.

## Read first
- `docs/design/auth.md`: the current native scheme. Note its invariant "tether never authenticates with a cookie" and "No Origin check". Your design replaces those rules for browsers only, so say exactly what the replacements are and why they are safe.
- `docs/design/client/browser-setup.md` ("Network and authentication", "Required controls", "Deployment trap", "Acceptance checks"): the researched candidate and the gates a review attached to it (browser protection relative to native biometrics; bounded static HTTP).
- `docs/design/client/connection-roadmap.md`: Tailscale first, public HTTPS next, passkeys preferred for public auth.
- `docs/design/plan.md` "Security"; `docs/design/daemon-core.md` §5.2 (handshake), §6 (limits incl. the 3-WebSocket cap).
- Code: `src/auth/`, `src/http/` (the middleware, `ws.rs`), `src/fs/` raw-file serving headers, `web/native/bridge.ts`, `web/main.tsx`, `web/net/`, `web/dev/shim.ts` (dev-only owner injection, which must never ship). Ground every claim about current behaviour in the code.
- `docs/design/decisions.md`: the format and the prior auth decisions.

## What the draft must settle
Settle these at the level a coder can build from, and judge for yourself what else belongs:
- Credential types. Browser and native credentials are distinct, so a stolen browser cookie can't be replayed as a native bearer token to skip Origin checks, and the reverse. Cover store fields, hashing, the `tether device` CLI listing and revocation, and lifetime. Jimmy hasn't chosen a lifetime: recommend one.
- Browser enrolment flow. Cover the routes, the Set-Cookie response (no secret in JSON), and how the existing pending code, attempt counter and atomic write are reused. Safari and the installed PWA hold separate credentials. Cover logout, which revokes the credential and closes its live sockets.
- Admission rules per route for each credential type: `/ws`, `/fs/*` (including Range and media), `/complete`, `/auth/*`, the debug endpoint, and static assets. Which public shell assets (HTML, manifest, icons, service worker) are served after only the tailnet check, without enrolment. Exact Origin, Host and CSRF rules, including null Origin and mixed or duplicate credentials. The existing 4401/4503 close-code semantics for browsers.
- Canonical origin and hostname. Requirements so a dev server on another port of the same hostname can never receive the production cookie. Cookies are not isolated by port: RFC 6265 §8.5.
- The C seam: what passkey unlock adds later, and what A's structures already provide for it.
- Threat model delta against auth.md: what browsers are protected from, what they are not, and the accepted risk in plain words.
- Probe gates that must be checked on the real deployment before shipping, for example whether Tailscale Serve forwards Cookie, Origin and Host unchanged. List them; don't run anything against live services.

## Output
Write one file: `.meridian/work/tether-mvp/design/browser-auth.md`. Structure it as:
1. A one-paragraph summary Jimmy can read in a minute.
2. The decisions that need Jimmy, each with your recommended answer.
3. The proposed new or replacement text for `auth.md`, written as the current rule, the way that spec is written.
4. The `decisions.md` entry, with the alternatives rejected.
5. The other spec sections that must change (plan.md Security, daemon-core, ios-shell, browser-setup, fs.md), each with the change.
6. Probe gates and acceptance checks.

Edit nothing outside that file. Another agent is editing `ios/` and `src/fs` tests in the same checkout. No source code, no tmux, no service or Tailscale changes. If you find that A is unsound in a way Jimmy should hear before approving, say so plainly at the top.
