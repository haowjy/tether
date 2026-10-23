# Client design and Mac handoff

Start here when implementing the desktop browser, mobile browser, or iPhone client.
The layout mockup is approved; it is not the working terminal client. The production
iOS app has not been built: `ios/spikes/keyboard` is an isolated keyboard experiment.

## Read in order

1. [Interaction contract](browser-behaviors.md): navigation, sessions, tabs, files,
   creation, focus, naming, minimal controls, and visual rules.
2. [Interactive mockup](mockups/index.html): desktop and mobile layouts with fictional
   data. It has no daemon connection and demonstrates keyboard-hidden layout only.
3. [Touch, clipboard, local draft](terminal-interaction-design.md): proposed
   implementation direction, measured constraints, and real-device checks.
4. [Decision reconciliation](browser-review-decisions.md): current rationale.
   [Review dispositions](browser-review-resolution.md) are optional historical notes,
   not implementation instructions.
5. Existing [product plan](../plan.md), [native shell](../ios-shell.md),
   [daemon/protocol](../daemon-core.md), [auth](../auth.md), and [files](../fs.md).

### Which rules win

This directory supersedes the older plan's native-only client scope and conflicting
navigation/layout rules: desktop gets Home/Terminal/Files icon rail; mobile gets
Sessions/Files Home and a compact full-screen terminal. Terminal + opens existing
sessions, not Files. Use actual tmux names. No dot separators or dot status markers.
Mobile browser uses the ordinary keyboard, not a custom accessory-key strip.
Both mobile versions need a local multiline draft editor while the keyboard is open.

Existing subsystem security, resource budgets, tmux ownership, and native focus
invariants still apply. Older native accessory key rows, suggestion strips, and dedicated media controls
are deferred. The required native draft follows the same Insert-without-Enter
semantics as mobile browser; its keyboard-open layout remains to prototype. The keyboard
spike's extra controls are test instrumentation, not approved product controls.

Layout approval does not settle browser authentication/asset serving, touch gesture
implementation, or real-device copy behavior. The daemon now restores active-grid wraps
and history chunks carry their own wrap map, but mobile selection and clipboard behavior
still need device checks. Retaining a draft after Insert is proposed; closed-tab draft
retention remains undecided.

## Connection roadmap

[Tailscale first, public HTTPS next](connection-roadmap.md) records the delivery order,
saved-server settings, multi-machine behavior, and security/reachability gates.
SSH is not the planned second phase. Current tailnet-only rules remain in force.

## Browser and PWA setup

The phone browser must be installable as a PWA. See [browser setup research](browser-setup.md)
for recommended hosting, authentication, platform boundaries, offline drafts, updates,
and implementation order. This is not implemented; its security design still needs review.

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

Pull this repository on the Mac, then follow
[the keyboard spike build instructions](../../../ios/spikes/keyboard/README.md).
They cover Xcode, XcodeGen, signing, Developer Mode, and running on a real phone.
The existing project generator command is:

```sh
cd ios/spikes/keyboard
xcodegen
open KeyboardSpike.xcodeproj
```

This builds the spike, not a finished tether app. Run its
[device checklist](../spike-1-keyboard.md) and save results before selecting native
input/viewport behavior. Xcode compilation and real iPhone behavior have not been
verified on the Linux development host.

Suggested next implementation brief:

> Read docs/design/client/README.md and its linked contracts. Prototype the unresolved
> input and platform boundaries before production implementation. First run the
> keyboard spike on the Mac/iPhone and prototype touch selection, keyboard-open
> local drafts, and logical copy over restored terminal and history rows. Resolve browser
> auth/asset serving and resize ownership before connecting a browser client.
> Preserve tmux as source of truth, bounded event-driven resource use, and one
> native focus controller. Use isolated tmux sessions for probes, never personal
> running sessions. Record design choices and hardware results in this repository.

## Research evidence and remaining gates

- [Primary sources](terminal-interaction-sources.md).
- [Isolated tmux 3.4 paste/wrap probe](terminal-interaction-probe.md).
- [Pinned xterm 6.0.0 source study and headless probe](terminal-selection-source-research.md).

L3 now reconstructs active-grid soft wraps in daemon restore bytes and includes a packed
wrap map in history chunks for logical copy; the terminal pipeline and snapshot frame
remain unchanged. Verify the result with the headless and real-tmux checks in the
daemon-core design, then finish the real-device selection and clipboard probes.
Coordinate tap versus scroll versus long-press so selection never sends an unintended
remote click. Paste uses tmux's mode-aware paste route; embedded newlines can execute
commands even when no extra Enter is appended. Drafts need stable target identity, local
save failure feedback, and no automatic retry after uncertain delivery.

The interaction design contains the full verification matrix: streaming-output
selection stability, Unicode, multiline/trailing-newline paste, IME/dictation,
storage failure, keyboard hide/show/rotation/hardware input, and real Safari/WKWebView
clipboard gestures. tmux 3.7b and real iPhone checks are still outstanding.
