# Investigate: with the keyboard up, the bottom of the tmux session is hidden

Jimmy, on his iPhone in the tether iOS app: "when the keyboard opens... i can't see the
bottom of the tmux session meaning i cant see whats being typed normally in terminal
harnesses." Terminal harnesses here means TUIs like Claude Code / codex / opencode, which
draw an input box near the bottom with status lines under it, and often hide the real
cursor and draw their own.

Find the causal chain. Do not fix it; report the cause and the candidate fixes with their
tradeoffs.

## The rule as specified

`docs/design/ios-shell.md` "The pan" and the sizing bullet above it; `docs/design/plan.md`
"Layout" ("Keyboard opening does not resize tmux"). tmux is sized from `stableHeight` with
the keyboard down; when the keyboard is up the renderer slides the terminal so the cursor
row's bottom meets the bottom of the visible area (`web/term/size.ts` `cursorPan`,
`web/term/xterm.ts` ~line 101). The native shell shrinks the web view above the keyboard
(`ios/Tether/Web/WebShellController.swift` `keyboardWillChange`) and reports
`keyboardInset: 0`; see `.meridian/work/tether-mvp/keyboard-gap.md` for the last fix in this
area.

## Questions to answer with evidence

- Does the pan run at all in the app when the keyboard rises (is `panArea`/the container
  height updated after the native resize)? Check on the iOS Simulator app or the web client
  under the app's viewport messages, against a real daemon on a private tmux socket (`-L`;
  never the default socket, never Jimmy's sessions).
- With a TUI that parks or hides the cursor above its bottom lines (run Claude Code or a
  small script that draws a box at rows N-4..N-1 with the cursor in it and status lines
  below), what does the user see? Is following `cursorY` the wrong anchor for these apps?
- What does Termius / Blink do (resize the pty to the visible rows vs pan)? A quick look
  is enough.

Constraints: no permanent tests; delete scratch files you create. Edit no source. Write
findings to `.meridian/work/tether-mvp/keyboard-hides-bottom.md` with the excerpts that
carry them (no raw dumps).
