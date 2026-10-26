# Jimmy's answers to one-keyboard.md (2026-10-26, round 1)

Verbatim from the question round:

1. Openers: "idk... tbh, maybe we should have like quick action buttons and then "open
   keyboard" itself, and then if u want to u can type into the box instead of typing
   directly." Read as: the keyboard button is the primary opener and types to the
   terminal; the box is an optional place to compose. Close to "two openers"; not yet
   confirmed. "Quick action buttons" not yet defined (key row? chips?).
2. Selection: "what is sleection handles and loupe?" -> needs explaining, re-ask.
3. Return label: "Send / Return (Recommended)" -> SETTLED: Send in the line, Return in
   the terminal.
4. Sheet fields: "what sheet and where?" -> needs explaining, re-ask.

New device bugs reported in the same round (app build 4892fe9, before the 7eaba6e reinstall):

- "when the keyboard opens... i can't see the bottom of the tmux session meaning i cant
  see whats being typed normally in terminal harnesses." Spec: tmux is not resized; the
  renderer pans so the cursor row meets the bottom of the visible area (ios-shell.md "The
  pan", web/term/size.ts cursorPan, web/term/xterm.ts:101).
- "text selection doesn't work... be becomes the keyboard thing..." Likely: a long-press
  meant to select raises the keyboard instead. Unconfirmed reading.

App reinstalled from 7eaba6e at the start of this session (console was unlocked).
