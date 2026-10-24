# P3b: fix the reviews (p141 correctness, p144 structure). web/ and the docs you already touched; uncommitted

Read both reports: `meridian spawn show p141`, `meridian spawn show p144`. Lead's calls:
- **Restructure first (p144 S1), it ends p141 #2 / p144 H1 as a class:** pull the touch viewing pieces (HistoryView, ScrollControl, SelectionControl, TouchControl) out of `terminals.ts` into one object scoped to the shown tab (e.g. `screens/terminal/view.ts`) with narrow inputs (`send` bound to the tab id it began on) and one `reset()` that `Terminals` calls on a snapshot AND whenever the shown tab changes: stops momentum, cancels the recognizer and pad repeat, hides the ring, dismisses the selection, resets history. History rows reach selection by a method call, not a shared mutable field. Also cancel the gesture on `lostpointercapture` and `visibilitychange` (hidden).
- p141 H1: touches on the selection layer belong to native selection and scrolling: don't dismiss or preventDefault there; a collapsed selection already dismisses. Your e2e must drag a handle/extend by touch, not `addRange`, and scroll the layer by touch.
- p144 M1: delete `term/buffer.ts`, its test and `bufferText`; move its useful wrap cases onto `logicalLines`/`selectedText`; fix the CONTEXT line.
- p144 M2: `Row` carries cell boundaries (from `cell.getWidth()` for buffer rows; for history a width rule matching xterm's: Emoji_Presentation + East Asian Wide). `wordAt` and the prompt-row tap (p141 #6) use cells, so CJK/emoji/©-before-cursor is right.
- p144 M4: build the desktop half of §7.6: `scrolled` derives from the renderer's scroll state, and the wheel past xterm's top continues into the history view.
- p141 #3 wrap flags across chunk and history/buffer seams; #4 re-anchor history with one row of overlap (mismatch → reset the history view); #5 drop history rows on return to latest; #7 history retry waits for the next gesture or a short backoff.
- p144 Lows 1–5 as written (one mouse→InputEvent helper with the mode policy; rows renderer to `screens/terminal/rows/` with a CSS class; shadow and z-order tokens; delete `atOldest`, fix the stale §7.6 lines; fold `selecting` into the resting-mode calculation).
- Cache the cell size on resize instead of measuring per momentum frame (p141 hypothesis).
Another lane is editing `ios/` and possibly `docs/design/decisions.md` (append-only; re-read before editing). Don't touch `ios/` or `src/`.
Verify: `pnpm --dir web run check`; e2e gesture + terminal + dock on real tmux 3.4 and 3.7b (add a tab-switch-during-coast case and the touch handle-drag case); `scripts/preflight.sh full` (if it fails only on the other lane's files, say so). Don't commit. Short report per item.
Spawn env TMPDIR=/tmp/tether-meridian-501.
