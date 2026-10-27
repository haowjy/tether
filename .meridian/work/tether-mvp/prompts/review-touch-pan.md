# Review: phone terminal touch + keyboard-up pan (uncommitted, on main)

Review the uncommitted working tree in /Users/jimmyyao/repos/tether (`git diff`). Two
lanes landed together; briefs: `.meridian/work/tether-mvp/prompts/lane-a-touch.md` and
`lane-b-pan.md`; decisions behind them: `.meridian/work/tether-mvp/one-keyboard-answers.md`
rounds 3-5. Edit nothing; report findings with severity.

- Lane A: arrow pad removed; long-press highlights the word at once, drag extends,
  release shows menu; ← → in the key row; tap on cursor row ±1 raises the keyboard
  (also sends the click in mouse mode). Files: web/touch/*, web/screens/terminal/
  {touchControl,view,terminals}.ts, selection/*, dock/KeyRow.tsx, e2e gesture.real.ts.
- Lane B: pan anchors the last row, falling back to the cursor; Dock pan area refreshes
  on visibleHeight; a guard stops keyboard-transition measurements resizing tmux (the
  coder saw tmux go 52x43 -> 52x27 mid-transition before it). Files: web/term/{size,xterm}.ts,
  dock/Dock.tsx, terminals.ts.

Risks to check, beyond your own: the "stable-chrome guard" — is it the right owner of the
rule "a keyboard change never resizes tmux" (ios-shell.md), or a second path patching a
measurement that should never have included the keyboard? Does the tap-near-cursor focus
run inside a user gesture on iOS WebKit (it must, to raise WebKit's keyboard in the
browser; in the app native raises it)? Does `setFocus("select")` at long-press time
(instead of release) still drop and restore the keyboard correctly (ios-shell.md focus
table)? Dead code left from the pad (config, CSS tokens, haptic kinds, docs). Docs state
current rules only, the two lanes' doc edits don't contradict each other, and decisions.md
entries name what they supersede. React rules in web/AGENTS.md; `/react-architecture` lens.
