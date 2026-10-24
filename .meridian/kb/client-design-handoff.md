# Client design: where it lives and what is still unverified

tether has three clients (desktop browser, phone browser or PWA, native iPhone app)
sharing one web UI. Their design is in `docs/design/client/`, entered through
`docs/design/client/README.md`; the web client's architecture is
`.meridian/work/tether-mvp/design/client-architecture.md`; the native shell is
`docs/design/ios-shell.md`. This page records what a cold agent needs before opening
them: which rules are easiest to undo by reading an older document, the quality bar,
and what has not been verified on the real system.

## The bar is Jimmy's phone, not the mockup

Jimmy judged the native keyboard spike on his iPhone and rejected it for "a shit ton of
ui issues"; the reference he gave is Termius ("like termius"), but "i don't think we
should EXACTLY copy termius". UI quality on a real phone is the bar. The mockup in
`docs/design/client/mockups/` shows the approved layout with fictional data and is a
starting point, not a pixel spec: a deliberate departure is logged in
`docs/design/decisions.md` and the contract updated in the same commit.

## Settled rules that cut across clients

`docs/design/client/browser-behaviors.md` holds the full set, with reasons in
`docs/design/client/browser-review-decisions.md` and in `docs/design/decisions.md`
under "Phone input follows Termius" and "Window size follows the client that acted
last".
These are the ones older documents contradict:

- One shared client: shared workspace behavior, platform-specific navigation and
  input. Three independent terminal implementations is the wrong shape.
- On touch, every client ends Terminal in the phone dock, drawn by the web: one row at
  rest (tab chip, one-line field, the one keyboard toggle) and the fixed key row above
  it while the keyboard is up. Navigation stays at the bottom; tabs on top were
  rejected as "hard to reach". Native draws nothing above the keyboard; it owns the
  terminal input's first responder, lends the line field to WebKit by touch location,
  and sizes the web view so the dock rides the keyboard.
- A tap on the terminal never opens or closes the keyboard; the toggle does, and
  tapping the line field opens line typing.
- The line field holds one line; Return sends it to the tab it was written for, then
  Enter, and clears it. Its unsent text is that tab's draft. The Enter rides in the
  paste's own tmux group, and the daemon confirms each paste.
- A long-press on the terminal is the arrow pad when held and dragged, and selects a
  word when released; the key row has no arrow keys.
- The dock's tab chip opens the session switcher (open tabs, every session, search,
  New session). The desktop terminal's `+` opens existing tmux windows only; creating
  sessions and windows happens on Home. Closing a tether tab only detaches it.
- A window takes the size of the client that acted on it last: "whoever has the last
  focus gets the focus and the size of the screen" (Jimmy). A watching phone no longer
  caps the window while the laptop is in use (`docs/design/daemon-core.md` §3.6).
- Browsers and the PWA are admitted as enrolled tailnet nodes; the app presents a
  device token. tether never authenticates with a cookie (`docs/design/auth.md`).

Where `docs/design/plan.md` conflicts with `docs/design/client/`, the client directory
wins. Tmux ownership, resource budgets, security, and the single native focus
controller still apply.

## What is built but unverified

The web client, the dock, touch gestures, the native shell and its bridge are built and
tested in browsers and the Simulator. None of these close from an agent shell
([probe-environments.md](probe-environments.md) says why):

| Gate | What must hold |
| --- | --- |
| Real device | The device checklist in `docs/design/ios-shell.md`, run by Jimmy on his iPhone: keyboard toggle, focus restoration, line-field lending, geometry and rotation, selection, hardware keys, latency, paste, Face ID. |
| Touch on device | Tap, scroll and long-press resolve before anything is sent, and selection and copy behave in iPhone Safari and WKWebView, not only in emulated touch. |
| Deployment | The auth probe gates G1–G12 in `docs/design/auth.md`, on the Linux dev box behind real Tailscale Serve. The Mac can't run them. |
| tmux versions | The real-tmux Rust suite (`tests/tmux_real.rs`) and the real-daemon web suites (`pnpm --dir web run e2e:real`, with `TETHER_E2E_TMUX=3.4` or `3.7b`) pass on both versions. |

The full verification matrix for touch and copy is in
`docs/design/client/terminal-interaction-design.md`.

## Connection roadmap

`docs/design/client/connection-roadmap.md` records Tailscale first, public HTTPS as
intended follow-up, and saved-server settings. SSH is not the planned second phase.
Browser/PWA uses each server's URL; unified cross-origin switching is a separate
design. Nothing in the roadmap authorizes exposing the daemon outside the tailnet.
