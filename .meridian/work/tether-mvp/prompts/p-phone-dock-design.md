# Redesign the phone input layout: Termius-style dock, single-line box, one keyboard toggle

Jimmy ran the keyboard spike on his iPhone today and changed the phone input design. Turn his decisions into settled specs before P3a/P3b are built. You own the structural calls below that he left open; record each in `docs/design/decisions.md` with the alternatives rejected (follow that file's format; specs state the current rule only — AGENTS.md).

## Jimmy's decisions (settled; quotes are his)
Read `.meridian/work/tether-mvp/phone-input-decisions.md` first; it is the record. In short:
1. A tap on the terminal never opens the keyboard; only the keyboard button does ("like termius").
2. "there should only be 1 place to click to open and close the keyboard": a single toggle.
3. Layout A, a Termius-style dock always at the bottom of Terminal on touch: tabs bar, a one-line text box, and a key row (esc tab ctrl alt / | ~ - and arrows, scrollable) with the keyboard toggle at its right end. It is visible with the keyboard up or down and rides on top of the keyboard when up. Terminal full-bleed above. His reference is a Termius screenshot: bottom-up keyboard; key row with the toggle at the right; always-visible "Use voice typing here..." field with Paste and AI chips; host bar (back, host pill with close, +, grid).
4. "edit should be a single line editor". Return sends the text + Enter to the terminal and clears the box. This replaces the multiline local draft with Insert-without-Enter (terminal-interaction-design.md, client-architecture.md §11, P3a row).
5. The phone browser/PWA gets the same dock and key row. This reverses the earlier "no custom browser keyboard strip" decision; log the reversal.
6. Build P3a/P3b next against real tmux. Jimmy: the spike shows "a shit ton of ui issues ... which is why the spike is useless". UI quality is the bar.

## Structural calls for you (tech-lead lean given; confirm or overrule with reasons)
- **Web owns the dock on both platforms.** One implementation; the browser needs it anyway. Native drops its `inputAccessoryView` key row and the compose `UITextView`, and only owns first responder + reports keyboard geometry. Work out what this does to ios-shell.md's FocusController states (`compose` likely goes; `terminal`/`hidden`/`webText`), the bridge (`focus` messages, viewport/keyboard geometry), and Ctrl-armed handling (now web-side).
- **Where keystrokes go when the one-line box has focus vs the terminal.** In native the box is a web text field (the `webText`-style borrow) while the terminal input stays native's responder; in the browser it's the owned input vs a textarea. Define it so the single toggle opens/closes the keyboard for whichever owns input, and taps on the terminal never change it.
- **Retire the keyboard spike?** Lean: yes — delete `ios/spikes/keyboard/` and `docs/design/spike-1-keyboard.md` now, and move its still-relevant questions (keeping first responder over WKWebView through sheets/rotation/process kill, keystroke-to-page latency, Face ID Keychain item) into the G3/P4 native checklist (client-architecture §12 / ios-shell.md). Its native accessory/compose design is obsolete. Decide, and make the deletion part of this change if you agree.
- Selection (long-press) and scrolling (P3b) are unchanged in intent; just make sure no rule still says a tap focuses input, and that a tap with no mouse mode does nothing.
- Hardware keyboard: whether the dock's key row collapses when one is attached.
- Safari/PWA: iOS's form accessory bar (Done, ⌃⌄) appears over a focused web input and can't be removed; note how the dock coexists with it.

## Files
Specs: `docs/design/plan.md` (UX spec, "Still open"), `docs/design/client/browser-behaviors.md` (interaction contract), `docs/design/client/terminal-interaction-design.md`, `docs/design/ios-shell.md`, `.meridian/work/tether-mvp/design/client-architecture.md` (§7 input, focus table ~957, "Raising the keyboard" ~1144, gesture table ~1242, P3a/P3b rows ~1546, G3 checklist ~1588, §11–12), `docs/design/client/mockups/index.html` (update the mobile mockup to show the dock — Jimmy needs to see it), `docs/design/decisions.md`.
Note: a cancelled coder (p109) left partial uncommitted edits in browser-behaviors.md, terminal-interaction-design.md, ios-shell.md and plan.md implementing points 1–2 with the toggle in the web toolbar and the key row's hide key removed. Reconcile them: keep what still fits, rewrite the rest. Leave `ios/spikes/keyboard/Spike/Info.plist`'s key-reorder alone (or it goes with the spike deletion).
Web client source to read for what exists: `web/src/` (P2 shipped; `touch/`, `screens/terminal/`, `ui/primitives/`, keymap from W2).

## Done
Specs consistent with each other and stating the new rule; decisions logged; mobile mockup shows the dock keyboard-up and keyboard-down; P3a/P3b rows in client-architecture.md rescoped (P3a = dock + one-line box + owned input + key row + toggle; P3b = gestures/scroll/selection). Do not commit; don't edit `web/src` or Swift beyond a spike deletion. Report: decisions made (with your reasoning where you overruled the lean), files changed, open questions for Jimmy (keep them few), and anything risky for implementation.
Spawn env: `TMPDIR=/tmp/tether-meridian-501`.
