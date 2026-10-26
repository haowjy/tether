# Investigate: text selection on Terminal does not work in the iOS app

Jimmy, on his iPhone in the tether iOS app: "text selection doesn't work... be becomes
the keyboard thing..." Probable reading: a long-press (or the gesture meant to select
terminal text) raises the keyboard or turns into a keyboard/caret interaction instead of
selecting. Confirm what actually happens before trusting that reading.

Find the causal chain. Do not fix it; report the cause and candidate fixes.

## The rule as specified

`docs/design/plan.md` "Select, copy and paste"; `docs/design/ios-shell.md` the focus mode
table (`select` mode), the "Selection" bullet (~line 377: WebKit selection may need the
content view as first responder; `focus select` drops the guard, keyboard goes down,
native restores after), the risk "The guard vs WebKit's selection", and the checklist row
"Selection". Code: `ios/Tether/Input/{FocusController,LineFieldLender,TerminalInputView}.swift`,
`ios/Tether/Web/WebShellController.swift`, the web selection layer and touch gestures under
`web/term/` and `web/screens/terminal/`. Note `LineFieldLender`'s passive touch recognizer
and the long-press that opens the arrow pad (`haptic rigid`) as suspects, not conclusions.

Reproduce in the iOS Simulator app (build with `./ios/scripts/check.sh` or the commands in
`ios/AGENTS.md`) against a real daemon on a private tmux socket (`-L`; never the default
socket, never Jimmy's sessions), with some text on screen. Exercise long-press, long-press
and drag, and double-tap, with the keyboard down and up. Record what each does.

Constraints: no permanent tests; delete scratch files. Edit no source. Write findings to
`.meridian/work/tether-mvp/selection-opens-keyboard.md` with the excerpts that carry them.
