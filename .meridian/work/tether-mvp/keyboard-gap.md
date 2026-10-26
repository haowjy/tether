# The keyboard-height gap under the app's dock

Jimmy, on the phone: a screenshot with the keyboard up showed the terminal content at the
top, the dock under it, and about a keyboard-height of empty page between the dock and the
keyboard.

## Cause

Two owners of one fact. The native shell moves the web view's bottom edge above a docked
keyboard (`WebShellController.keyboardWillChange` → `bottomConstraint`), and its
`viewport()` also reported that same frame delta as `keyboardInset` — "the bottom
obstruction between stable and visible height". The web lifts the dock, Dialog sheets and
toasts by `--keyboard-inset` (`Dock.module.css`, `Dialog.module.css`, `Toast.module.css`),
a rule built for the browser, where the layout viewport stays full height and the keyboard
overlays it. In the app the lift ran inside a view that had already shrunk: the dock
floated a keyboard height up and left its vacated slot empty.

Both halves landed separately (`ab61cd5` native shell, `2a5c401` phone dock) and no device
check had run between them — this is the class of defect the device checklist exists for.

## Evidence

`web/e2e/dock/lead-dock-geometry.real.ts` (scratch, deleted): a real daemon on a private
tmux 3.7b, 393×593 viewport, touch, the terminal screen open, then `--keyboard-inset`
written and the dock row's box measured.

| `--keyboard-inset` | dock top | dock bottom | viewport bottom | blank under dock |
|---|---|---|---|---|
| 259 px | 292 | 334 | 593 | **259 px** |
| 0 px | 551 | 593 | 593 | **0 px** |

The 259 px matches the gap in the screenshot for that keyboard height.

## Fix

`keyboardInset` means the part of the page the web can see that the keyboard covers. The
app reports 0 (it moves the view instead); the browser reports the covered strip. `keyboard`
still carries "the frame the keyboard took >= 120 pt", which drives the strip, the
`data-keyboard` chrome and the toast offset. One behavioural line in
`ios/Tether/Web/WebShellController.swift`; `web/platform/types.ts`, `ios-shell.md` and
`decisions.md` say what the number now means.

Rejected: dropping the native resize and letting the web rise everywhere (the documented
fallback — loses the frame animation, reopens WebKit scrolling the focused line field); a
web-side measurement of whether the page already excludes the keyboard; keying the lift on
`keyboard` instead of the inset.

## Not verified

The device itself. The Simulator cannot show the software keyboard to an agent shell, and
the phone went `unavailable` to `devicectl` during the rebuild, so the fixed build has not
been installed at the time of writing. What is verified is the layout rule, on the real app
against a real daemon, with the numbers above.
