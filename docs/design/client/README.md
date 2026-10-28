# Client design and Mac handoff

Start here when implementing the desktop browser, mobile browser, or iPhone client.
The interaction contract describes the approved redesign, which is not yet implemented.
The older interactive mockup and built clients do not demonstrate the redesign; keyboard,
focus and touch behavior also require the [device checklist](../ios-shell.md#device-checklist).

## Read in order

1. [Interaction contract](browser-behaviors.md): navigation, sessions, tabs, files,
   creation, focus, naming, minimal controls, and visual rules.
2. [Interactive mockup](mockups/index.html): an older desktop and mobile layout with
   fictional data and no daemon connection. The interaction contract takes precedence.
3. [Touch, clipboard, the line field](terminal-interaction-design.md): proposed
   implementation direction, measured constraints, and real-device checks.
4. [Decision log](../decisions.md): current choices and their history.
   [Earlier decision reconciliation](browser-review-decisions.md) and
   [review dispositions](browser-review-resolution.md) are historical notes, not
   implementation instructions.
5. Existing [product plan](../plan.md), [native shell](../ios-shell.md),
   [daemon/protocol](../daemon-core.md), [auth](../auth.md), and [files](../fs.md).

### Which rules win

The [interaction contract](browser-behaviors.md) governs layout: desktop uses a top
row with Home, tabs and +; phone Home is server-first, and the current-tab button opens
the picker sheet. Files is a tab. With the keyboard up the phone dock shows a compose
box above the key row. The contract covers browser/PWA and native differences and the
open implementation details. Older mockups and review notes do not override it.

Existing subsystem security, resource budgets, tmux ownership, and native focus
invariants still apply. Suggestion strips and dedicated media controls are deferred.

Browser authentication and asset serving are specified in [auth.md](../auth.md). The
daemon restores active-grid wraps and history chunks carry their own wrap map, but
touch gestures, mobile selection and clipboard behavior still need device checks.

## Connection roadmap

[Tailscale first, public HTTPS next](connection-roadmap.md) records the delivery order,
saved-server settings, multi-machine behavior, and security/reachability gates.
SSH is not the planned second phase. Current tailnet-only rules remain in force.

## Browser and PWA setup

The phone browser must be installable as a PWA. [Browser setup](browser-setup.md) is
the browser/PWA delivery contract: hosting, platform boundaries, offline drafts and
updates. Authentication is in [auth.md](../auth.md).

## Open the mockup on a Mac

From the repository root:

```sh
python3 -m http.server 5174 --bind 127.0.0.1 --directory docs/design/client
open http://127.0.0.1:5174/mockups/
```

Choose the mockup's platform controls to inspect desktop and mobile layouts. This
needs neither Tailscale nor a daemon. Stop the server with Ctrl-C. Do not mistake the
sample terminal for a working app or the mock keyboard control for device validation.

## Start iPhone development

The native app is in `ios/`; start with [ios/AGENTS.md](../../../ios/AGENTS.md). Its
design is [ios-shell.md](../ios-shell.md), including signing and distribution, and the
checks it still needs on the phone are that spec's
[device checklist](../ios-shell.md#device-checklist).

## Research evidence and remaining gates

- [Primary sources](terminal-interaction-sources.md).
- [Isolated tmux 3.4 paste/wrap probe](terminal-interaction-probe.md).
- [Pinned xterm 6.0.0 source study and headless probe](terminal-selection-source-research.md).

The daemon reconstructs active-grid soft wraps in daemon restore bytes and includes a packed
wrap map in history chunks for logical copy; the terminal pipeline and snapshot frame
remain unchanged. Verify the result with the headless and real-tmux checks in the
daemon-core design, then finish the real-device selection and clipboard probes.
Coordinate tap versus scroll versus long-press so selection never sends an unintended
remote click. Paste uses tmux's mode-aware paste route; embedded newlines can execute
commands even when no extra Enter is appended. Line-field drafts need stable target
identity, local save failure feedback, and no automatic retry after uncertain delivery.

The interaction design contains the full verification matrix: streaming-output
selection stability, Unicode, multiline/trailing-newline paste, IME/dictation,
storage failure, keyboard hide/show/rotation/hardware input, and real Safari/WKWebView
clipboard gestures. tmux 3.7b and real iPhone checks are still outstanding.
