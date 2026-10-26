# Terminal selection / keyboard: diagnosis notes

## Status

**Source-level causal chain is clear; runtime symptom is not confirmed.** The prober built, installed, and launched the app on the dedicated `tether-keyboard-p6` iOS 26.3 simulator. It opened to “Add a server,” with no host or terminal available. `simctl io` has no touch/type operations: attempts at `long-press`, `tap`, and `type` each returned usage / exit 117. The prober did not enroll a host or start a daemon, and could not perform the requested private-socket scenario or any keyboard/gesture matrix. The repo's `ios/AGENTS.md` likewise says Simulator input, keyboard, and focus cannot be verified from an agent shell. A real-device check remains necessary. No source was edited and no permanent test was added.

## What the specified and implemented gestures do

The user’s tentative “long-press turns into the keyboard thing” interpretation is **not proven by runtime evidence**. The implementation distinguishes the two outcomes:

- `web/touch/gesture.ts:41-49` sets a 380 ms long-press threshold, 10 px initial slop, and 16 px post-long-press pad dead zone.
- `web/screens/terminal/touchControl.ts:67-86` owns touch pointers on the terminal (calls `preventDefault` and captures); this path does not focus the native terminal input or send touch-down to xterm.
- When the timer expires, `touchControl.ts:138-140` emits the rigid haptic and draws the arrow-pad ring. If held finger moves outside the 16 px dead zone, `touchControl.ts:142-144` sends arrow key input; release then ends the pad. A movement before threshold becomes a scroll if vertical-dominant, otherwise ignored (`gesture.ts:94-109`).
- Only a long-press released with no movement enters `selectWord` (`gesture.ts:164-171`), handled at `touchControl.ts:151-154` by `SelectionControl.begin`.
- `web/screens/terminal/selection/control.ts:55-94` builds a DOM text snapshot, identifies the word under the finger, selects it and opens tether's edit menu; blank cells get Paste-only menu. It calls `selecting(true)` first. Selection-layer touches are exempted from the touch recognizer (`touchControl.ts:67-70`), so WebKit/system handles own subsequent handle-drag.
- There is no custom double-tap recognition in the live terminal gesture path; quick touches resolve independently as `tap` (`gesture.ts:150-156`). They may have ordinary tap behavior (prompt cursor / app mouse click), not word selection. Double-tap on the already-created DOM snapshot is left to WebKit and is not established by source.

Therefore, the implemented gesture that can look like “keyboard interaction” is **long-press, then move**: it is intentionally an arrow pad, not drag-to-select. The selection gesture is **hold still until haptic/ring, then lift without moving**, after which the word selection should show handles/menu. This is consistent with `docs/design/plan.md:489-493` (arrow pad on hold + drag, release without moving selects word) and `:499-510` (selection snapshot/handles; device verification required).

## Focus / keyboard causal chain

Relevant source excerpts:

- `web/screens/terminal/selection/control.ts:79-93`: selection begins with `this.deps.selecting(true)`, then creates/appends a selectable snapshot and selects the word.
- `web/screens/terminal/terminals.ts:118-130`: wires `selecting` to `this.app.focus.selecting(on)`.
- `web/app/focus.ts:190-218`: marks selection active; on Terminal, `restingMode` chooses `select` while selecting, otherwise `terminal` when an input owner holds the keyboard or `hidden` when none does; sends only a changed mode to native.
- `ios/Tether/Web/WebShellController.swift:269-276`: receives the bridge `focus` message and routes valid non-`webText` modes to `FocusController.set`.
- `ios/Tether/Input/FocusController.swift:21,39-54`: the selection mode drops the normal responder guard (`canResignInput` includes `.select`) and resigns `TerminalInputView`; `.select` has `hidesSoftwareKeyboard = false`, allowing WebKit to own first responder without the software keyboard. On selection dismissal, web sends `selecting(false)` and focus returns to prior keyboard state (`web/app/focus.ts:205-218`; `FocusController.swift:39-55`).
- The design explicitly expects `select` mode to use WebKit's content view, keyboard down, and to restore prior state after selection: `docs/design/ios-shell.md:353-381`. It also flags “The guard vs WebKit's selection” as an unverified device risk at `:713-716`.

So, according to both implementation and spec, the intended selection handoff **lowers**, not raises, the software keyboard. Actual success of handles/Copy with the responder transfer is unresolved until input can be exercised on a device. A keyboard that truly appears or a caret interaction during the attempt would need runtime observation; it is not explained by the intended `.select` transition alone.

## Suspects evaluated

- **`LineFieldLender` passive recognizer:** unlikely to be causal for terminal selection. It sets `lineFieldTouch` only when a touch begins in the published line-field rectangle and focus is `.terminal` or `.hidden` (`ios/Tether/Input/LineFieldLender.swift:48-52`). Its recognizer is passive/non-cancelling (`:16-24, 69-95`). The selection gesture is routed through web terminal touch handling and `focus select`, not this line-field route. It remains a plausible competing explanation only if the touch was actually over the dock line field / stale rect; the spec lists that as a distinct risk (`docs/design/ios-shell.md:715-719`).
- **Native `TerminalInputView` long press:** no terminal touch gesture is installed there; it is a tiny, disabled-interaction responder (`ios/Tether/Input/TerminalInputView.swift:32-35`). Native input is not what maps the terminal long press to arrows; web `TouchControl` does.
- **Arrow pad:** a likely explanation if the report refers to holding then moving. It deliberately sends arrow keys after moving past the dead zone. It is distinct from selection mode, and does not itself call `focus terminal`.
- **WebKit selection/focus handoff:** only live unverified candidate if the user's actual symptom occurs after stationary long-press/release. Spec expressly records the guard-vs-selection issue as a device-check risk; no source evidence says it raises the keyboard.

## Candidate fixes (not applied)

1. If repro is long-press-and-drag showing arrows: clarify the intended gesture/ affordance (selection requires lift after haptic; use subsequent WebKit handles to extend) or change the gesture arbitration only if Jimmy wants direct drag selection. Do not change focus code based only on this reading.
2. If stationary long-press/release selects but WebKit shows caret/keyboard or no handles: reproduce on a real iPhone with keyboard initially up and down, then adjust `focus select` responder ownership/transfer in `FocusController`/`WebShellController` to satisfy WebKit while restoring the previous state. This is precisely the `ios-shell.md` open risk.
3. If a touch was on the dock field: separately verify/adjust the published line-field rect and lender timing; do not conflate it with terminal selection.

## Reproduction attempt and limitation

The app was built and launched on the dedicated `tether-keyboard-p6` simulator (iOS 26.3) with:

```sh
xcodebuild -project ios/Tether.xcodeproj -scheme Tether -configuration Debug \
  -destination 'platform=iOS Simulator,id=58631B31-3F9C-4562-AD4B-5C1404E9EB40' \
  -derivedDataPath /tmp/tether-p293-sim build
```

It launched successfully but displayed **Add a server**, so no terminal or text was available. The prober tried `xcrun simctl io <device> long-press 400 900`, `tap 400 900`, and `type x`; all returned usage (exit 117), since `simctl io` exposes no touch or type operation. It therefore did not enroll a host/start a daemon, and performed none of the requested long-press, long-press+drag, double-tap, keyboard-up/down matrix. Outcome is **not reproduced**, not a negative finding about the symptom. The run's temporary app install, simulator, build directory, and screenshots were cleaned up.

Before diagnosing what Jimmy actually saw, run with touch-capable Simulator/App automation or a real iPhone, a real daemon, and a dedicated private tmux `-L` socket; capture outcomes for all requested gestures with keyboard up and down. Do not use the default tmux socket or personal sessions. The project explicitly says to verify keyboard/focus on device (`ios/AGENTS.md`, “The Simulator can't verify input”).
