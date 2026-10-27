# Lane A: terminal touch — no arrow pad, long-press selects, ← →, tap-near-cursor opens keyboard

Jimmy's decisions (2026-10-26; record: `.meridian/work/tether-mvp/one-keyboard-answers.md`
rounds 3-5, quote them in decisions.md):

1. **Remove the arrow pad.** Today a long-press (380 ms) gives a haptic and *nothing on
   screen*; the word is selected only on release; moving past the 16 px dead zone turns
   into an arrow pad that also draws nothing (`web/touch/gesture.ts` `held`/`padding`,
   `web/screens/terminal/touchControl.ts`). Jimmy's symptom: "press to select turning into
   arrow key pad and the arrow key pad i can't even see anything"; he also has not seen
   selection handles on his iPhone.
2. **Long-press selects, visibly, like iOS / Termius:** when the long-press fires, the word
   under the finger highlights at once (haptic as today). Dragging while still held extends
   the selection to follow the finger (by cell, across rows, autoscrolling at the edges if
   the selection layer already supports it — check `web/touch/selection.ts`,
   `web/screens/terminal/selection/`). Release shows the handles and the edit menu
   (Copy / Paste; Paste alone over a blank cell) — reuse the existing selection layer and
   EditMenu, don't build a second one. Over a blank cell a long-press still offers Paste.
3. **← and → join the key row** beside ↑ ↓ (`web/screens/terminal/dock/KeyRow.tsx`), go to
   the terminal, repeat while held exactly as ↑ ↓ do. Order: esc, ←, ↑, ↓, →, ^R, ^C, tab,
   ctrl, alt, |, ~, /, - (adjust if the existing row's reasoning says otherwise; say why).
4. **A tap on the cursor's row, or the row directly above or below it, opens the keyboard
   for the terminal** (the same as the dock's keyboard toggle: `focus terminal` in the app,
   the terminal input in the browser) when the keyboard is down. In application mouse mode
   the tap still sends its click as today. Taps elsewhere keep today's meaning. A tap never
   lowers the keyboard. Cursor row = the tmux cursor (xterm buffer `cursorY`, viewport-
   adjusted; no opening while scrolled back into history where the cursor is off screen).

Keep: vertical swipe scrolling/momentum, alternate-screen ↑/↓ swipes, no mouse event from a
long-press, pointercancel handling, "Selection consumes its gestures".

## Specs to update in the same change (state current rules only)

`docs/design/plan.md` ("Cursor movement", "The key row", "Select, copy and paste", the
touch rules near "Keyboard behaviour" — the line "Terminal taps never change focus or the
keyboard" changes), `docs/design/client/browser-behaviors.md` (Key row, the selection
paragraph ~line 278), `docs/design/client/terminal-interaction-design.md` (line 11 and the
checklist row ~81), `docs/design/ios-shell.md` wherever the arrow pad or taps-never-focus
appear, and a dated 2026-10-26 entry in `docs/design/decisions.md` that supersedes the
arrow-pad rule ("Phone input follows Termius" section, ~line 3154 and ~3633) with Jimmy's
words and the rejected alternative (keep the pad and add visuals). CHANGELOG `[Unreleased]`
bullet. Vocabulary entry ~decisions.md:3493 drops "arrow pad".

## Constraints

- A parallel lane (Lane B) is editing `web/term/size.ts`, `web/term/xterm.ts` and the pan
  code in `web/screens/terminal/dock/Dock.tsx`. Do not edit those files' pan logic; if you
  must touch Dock.tsx (e.g. for the keyboard-open call), keep the edit minimal and say so.
  Both lanes edit plan.md/ios-shell.md: edit only your sections.
- Delete what the change replaces: the pad states, its config (`padDeadzone`, `padRange`,
  repeat speeds if only the pad used them), `arrowPad`/`padEnd` actions and their handling.
  Existing unit tests for removed behaviour are deleted or rewritten to the new rule; no new
  permanent tests beyond that (Jimmy's standing instruction). React rules in `web/AGENTS.md`.
- pnpm only. Gate: `pnpm --dir web run check`. Do not commit; the lead commits.

## Verify on the running app

Against a real daemon and a private tmux socket (`-L`; the e2e stack in
`web/e2e/shared/stack.ts` does this), drive the terminal with **touch** in Playwright
(mobile viewport, `hasTouch`): long-press still → word highlighted before release; drag →
selection extends; release → handles + menu, Copy puts the text on the clipboard; ← → keys
reach tmux (`capture-pane` or the screen); tap on the prompt row with keyboard down raises
the terminal input; tap far from the cursor doesn't; mouse-mode app still gets its click.
If you can also exercise it in the iOS Simulator app, do; say what you could not check. Any
scratch e2e file is deleted afterwards. Report what changed, each failure mode and what you
observed, gate results.
