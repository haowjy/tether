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

- The mockup uses fictional data, never connects to tmux, and shows only the
  keyboard-hidden layout. It demonstrates layout; it does not prove any interaction
  works.
- The production iOS app does not exist. `ios/spikes/keyboard` is an isolated
  keyboard experiment, and its extra controls are test instrumentation, not approved
  product controls.
- Touch selection, clipboard, and the local draft editor are a proposed
  implementation direction (`docs/design/client/terminal-interaction-design.md`),
  backed by research but unverified on a device.

## Settled rules that cut across clients

These are the decisions most likely to be undone by following older documents; `browser-behaviors.md`
holds the full set, with reasons in `browser-review-decisions.md`.

- One shared client: shared workspace behavior, platform-specific navigation and
  input. Three independent terminal implementations is the wrong shape.
- Terminal `+` opens existing tmux windows only. Creating sessions and windows
  happens on Home, behind text-labelled buttons. Files opens from Home or the
  desktop rail, never from terminal `+`.
- Closing a tether tab only detaches it; this pass exposes no rename or kill.
- The mobile browser uses the ordinary system keyboard, with no app-drawn key strip,
  and must support PWA installation. Browser/PWA hosting research is in
  `docs/design/client/browser-setup.md`; its cookie/auth direction is a proposal,
  not a replacement for current auth rules until reviewed and implemented.
- Both mobile clients need a local multiline draft while the software keyboard is
  open. Insert sends the draft as one paste with no added Enter, to the tab captured
  when Insert was tapped.

Where `docs/design/plan.md` or `docs/design/ios-shell.md` conflict with
`docs/design/client/`, the client directory wins. Tmux ownership, resource budgets,
security, and the single native focus controller from those specs still apply.

The repository plan and native shell explicitly defer extra accessory controls and
use draft Insert without Enter. Native compose focus is internal; any web-controlled
toggle needs a reviewed bridge action before implementation.

## Gates before implementation counts as done

None of these close from the Linux dev box; each needs the real system.

| Gate | What must hold |
| --- | --- |
| Real device | Keyboard spike run on a real iPhone with its device checklist (`docs/design/spike-1-keyboard.md`) recorded before choosing native input and viewport behavior. Touch, clipboard, and keyboard layout verified on iPhone Safari and WKWebView. Xcode compilation has not been verified. |
| Wrap restoration | Snapshot repaint currently loses soft-wrap boundaries, so restored text copies with false newlines. Fix the capture/restore boundary before promising correct copy after reconnect, tab switch, or history fetch. |
| Gesture arbitration | Tap, scroll, and long-press resolve before anything is sent, so selecting never sends a stray remote click. |
| Browser architecture | Browser authentication, asset serving, and terminal resize ownership pass architecture review before a browser client connects. The dev proxy is not production auth. |
| tmux 3.7b | Paste and wrap probes have run on tmux 3.4 only. |

The full verification matrix is in `docs/design/client/terminal-interaction-design.md`.

Two draft decisions remain open: keeping the draft after Insert is proposed but not
confirmed, and draft retention after a tab closes is undecided.

## Connection roadmap

`docs/design/client/connection-roadmap.md` records Tailscale first, public HTTPS as
intended follow-up, and saved-server settings. SSH is not the planned second phase.
Browser/PWA initially uses each server's URL; unified cross-origin switching is a
separate design. Identity-only Tailscale auth and the cookie proposal remain options,
not authorization to remove current device checks or expose the daemon publicly.

## Where the Mac agent starts

On the Mac, pull the repository and read `docs/design/client/README.md`. It covers:

1. Serving the mockup locally (a Python static server; no Tailscale or daemon).
2. Building the keyboard spike per `ios/spikes/keyboard/README.md` (Xcode,
   XcodeGen, signing, Developer Mode), then running the device checklist and
   saving the results in the repository.
3. A suggested implementation brief: prototype touch selection, keyboard-open
   drafts, and logical copy across snapshot restoration on the device first; resolve
   browser auth, asset serving, and resize ownership before connecting a browser
   client.

Probe with isolated tmux sessions, never Jimmy's running ones. Record design choices
in `docs/design/` and decisions in `docs/design/decisions.md`.
