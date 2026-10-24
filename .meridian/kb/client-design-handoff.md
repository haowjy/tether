# Client design: where it lives and what is still gated

The canonical design for tether's three clients (desktop browser, mobile browser,
native iPhone app) is in the tether repository at `docs/design/client/`, entered
through `docs/design/client/README.md`. Read that before building any client. This
page records only what a cold agent needs before opening it: what Jimmy approved,
what that approval does not cover, and the gates that block calling the work done.

## Approved means the layout, not the client

Jimmy approved the layout direction: navigation, sessions and windows, tabs, files,
creation, naming, and minimal controls, as specified in
`docs/design/client/browser-behaviors.md` and shown in `docs/design/client/mockups/`.

That approval covers less than it looks like:

- The mockup uses fictional data and never connects to tmux. Its phone terminal shows
  the dock with the keyboard down and up. It demonstrates layout; it does not prove any interaction
  works.
- The production iOS app does not exist. The keyboard spike was retired on 2026-10-24;
  its open native checks are the device checklist in `docs/design/ios-shell.md`.
- Touch selection, clipboard, and the phone dock's line field are a proposed
  implementation direction (`docs/design/client/terminal-interaction-design.md`),
  backed by research but unverified on a device.

## Settled rules that cut across clients

These are the decisions most likely to be undone by following older documents; `browser-behaviors.md`
holds the full set, with reasons in `browser-review-decisions.md`.

- One shared client: shared workspace behavior, platform-specific navigation and
  input. Three independent terminal implementations is the wrong shape.
- Desktop terminal `+` opens existing tmux windows only; creating sessions and windows
  happens on Home, behind text-labelled buttons. On the phone the dock's tab chip opens
  the session switcher instead: open tabs, every session, search and New session, with
  no tab row and no +. Files opens from Home or the desktop rail, never from either.
- Closing a tether tab only detaches it; this pass exposes no rename or kill.
- On touch, every client (phone browser, PWA, app) ends Terminal in the phone dock:
  one row at rest (tab chip, one-line field, the one keyboard toggle) and the fixed key
  row above it while the keyboard is up, drawn by the web
  (`docs/design/client/browser-behaviors.md`, Phone dock). The phone browser must
  support PWA installation. Browser/PWA hosting research is in
  `docs/design/client/browser-setup.md`; its cookie/auth direction is a proposal,
  not a replacement for current auth rules until reviewed and implemented.
- The line field holds one line; Return sends it to the tab it was written for, then
  Enter, and clears it. Its unsent text is that tab's draft. The Enter rides in the
  paste's own tmux group, and the daemon confirms each paste by `req`.
- A long-press on the terminal is the arrow pad when held and dragged, and selects a
  word when released; there are no ← → keys.

Where `docs/design/plan.md` or `docs/design/ios-shell.md` conflict with
`docs/design/client/`, the client directory wins. Tmux ownership, resource budgets,
security, and the single native focus controller from those specs still apply.

Native draws nothing above the keyboard: it owns the terminal input's first responder,
lends the line field to WebKit by touch location, and sizes the web view so the dock
rides the keyboard (`docs/design/ios-shell.md`).

## Gates before implementation counts as done

None of these close from the Linux dev box; each needs the real system.

| Gate | What must hold |
| --- | --- |
| Real device | The device checklist in `docs/design/ios-shell.md` run on the iPhone during P4. Touch, clipboard, and keyboard layout verified on iPhone Safari and WKWebView. Xcode compilation has not been verified. |
| Wrap restoration | Snapshot repaint currently loses soft-wrap boundaries, so restored text copies with false newlines. Fix the capture/restore boundary before promising correct copy after reconnect, tab switch, or history fetch. |
| Gesture arbitration | Tap, scroll, and long-press resolve before anything is sent, so selecting never sends a stray remote click. |
| Browser architecture | Browser authentication, asset serving, and terminal resize ownership pass architecture review before a browser client connects. The dev proxy is not production auth. |
| tmux 3.7b | Paste and wrap probes have run on tmux 3.4 only. |

The full verification matrix is in `docs/design/client/terminal-interaction-design.md`.

Drafts are now the line field's unsent text per tab; Return clears it, and a closed
tab's draft is kept (decisions.md).

## Connection roadmap

`docs/design/client/connection-roadmap.md` records Tailscale first, public HTTPS as
intended follow-up, and saved-server settings. SSH is not the planned second phase.
Browser/PWA initially uses each server's URL; unified cross-origin switching is a
separate design. Identity-only Tailscale auth and the cookie proposal remain options,
not authorization to remove current device checks or expose the daemon publicly.

## Where the Mac agent starts

On the Mac, pull the repository and read `docs/design/client/README.md`. It covers:

1. Serving the mockup locally (a Python static server; no Tailscale or daemon).
2. The native app comes in P4; its device checklist is in `docs/design/ios-shell.md`.
3. A suggested implementation brief: prototype touch selection, the phone dock, and logical copy across snapshot restoration on the device first; resolve
   browser auth, asset serving, and resize ownership before connecting a browser
   client.

Probe with isolated tmux sessions, never Jimmy's running ones. Record design choices
in `docs/design/` and decisions in `docs/design/decisions.md`.
