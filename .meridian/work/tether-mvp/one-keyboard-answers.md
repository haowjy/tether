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

## Round 2 (2026-10-26, later)

- Quick actions: "dont we already have them...?" -> yes: the key row (esc, arrows, ^C, tab,
  ctrl, alt...) and the suggestion strip. So decision 1 = two openers as recommended: the
  keyboard toggle types to the terminal, the box is the optional composer. SETTLED.
- Selection in the box: "what? inside the text box? or terminal" -> re-asked, plain words.
- Sheets: "they probably aren't needed, this isn't normal texting" -> accept WebKit's
  keyboard with predictions in sheet fields. SETTLED (decision 4 = accept).
- Keyboard up: "idk... what do u think...? I think it could be either works" -> tech lead's
  call: keep tmux's size; pan so the LAST row sits above the keyboard, unless that would
  hide the cursor row (then cursor-align as today). Also verify the pan runs at all in the
  app (p290's geometry suspicion).
- Selection: "yes press to select turning into arrow key pad and the arrow key pad i can't
  even see anyhting". Confirms the long-press-drag = arrow pad rule (his 2026-10-24 call,
  plan.md "Cursor movement") is the problem, and the pad gives no visual feedback.
  Proposal put to him: drop the arrow pad; long-press-drag always selects; add ← → to the
  key row (↑ ↓ already there, repeating while held).

## Round 3

- Terminal selection: "selection - yes" -> SETTLED: drop the arrow pad; long-press-drag
  selects; add ← → to the key row. Reverses the 2026-10-24 arrow-pad call; log it.
- Box: "wait we don't have the blue handle to drag...?" (he doesn't see handles today
  either) and "maybe this box should grow up to a certain point to like 4-5 lines...?"
  Proposed: soft-wrap, grows 1 -> 5 lines then scrolls; Return still sends; no hard
  newlines typed. Affects the spike (hidden UITextField vs UITextView). Awaiting yes.
- Keyboard up: accepts "temporary" keyboard (tmux keeps its size, view slides). Asks for
  much better terminal touch controls, and: "if i clicked somewhere where I wanted to
  enter text, the keyboard should open on its own... but its kinda difficult ... because
  basically everything you can technically 'type' right...?" Proposed: a tap on the
  cursor's row (and the row either side) opens the keyboard to the terminal; elsewhere
  taps keep today's meaning. Awaiting yes.

## Round 4: correction on terminal selection

Jimmy: "i dont think i made that call... holding finger down and dragging turns into the
arrow pad IF YOU MOVE, but if you don't move i think it should select the text, and then u
can drag it with the things to the side (like termius)".

This IS the current spec (plan.md "Cursor movement", terminal-interaction-design.md): hold
still and release -> word selected with handles; hold and move -> arrow pad. The round-3
"drop the arrow pad" is WITHDRAWN; the lead misread the complaint as a rule problem. What is
broken is the implementation on the device: an attempt to select ends up as the arrow pad,
the pad shows nothing on screen, and he has not seen selection handles. Next: reproduce the
gesture layer with touch against a real daemon, check the 16 px dead zone against finger
jitter, check handles render and are draggable, give the pad a visible cue.

## Round 5: settled

Jimmy: "unless you think it would be better ur way to just remove the drag thing" -> tech
lead's call: REMOVE the arrow pad. Long-press highlights the word at once; dragging extends
the selection; release shows handles + Copy/Paste. ← → join the key row beside ↑ ↓,
repeating while held. Box grows (wrap, 1-5 lines, then scrolls; Return sends; no typed
newlines) and a tap on the cursor's row ±1 opens the keyboard to the terminal: both his own
suggestions, taken in the shape proposed. Keyboard-up pan: bottom-align, cursor-clamped.
