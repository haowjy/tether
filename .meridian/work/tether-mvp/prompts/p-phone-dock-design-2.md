# Follow-up: settle the open dock questions from Jimmy's later decisions

Your p110 work is uncommitted in the tree; build on it. Re-read `.meridian/work/tether-mvp/phone-input-decisions.md` in full: everything after its "Dock variations" section postdates your read. Visual reference for all of it: the canvas https://claude.ai/artifact/HqphCamD9rj2CbBnAS4sGJ (read it with the Artifact tool, action read; boards Main/Phone variant oneRow, Switcher, Gestures/GesturePhone). The repo mockup (`docs/design/client/mockups/index.html`) should match it.

## Now settled (resolve your open questions with these)
1. **Arrangement = variant 2, one row at rest.** Keyboard down: one dock row = tab chip (active tab name + open-tab count) · line field · keyboard toggle. Keyboard up: the fixed key row (esc ↑ ↓ ^R ^C tab ctrl alt | ~ / -, scrolls) appears above that row; the toggle stays at the right of the bottom row. Sizes from the canvas: 34px row items, 32px keys, 30px-class controls; line field font 16px (Safari zooms below 16). Tabs-on-top rejected ("hard to reach"); the three-row compact dock not chosen. Landscape: same model.
2. **The tab chip opens one switcher sheet** (Switcher board): open tabs as pills at the top (one tap switches and closes), then every tmux session on the host with its windows (labels "here"/"open", no dots), search field and new-session + at the BOTTOM of the sheet in thumb reach, search not auto-focused. This replaces the tabs row and the + button and MERGES with the existing "Open session picker" (browser-behaviors.md) on the phone; reconcile that section, Home's hierarchy and client-architecture rather than keep two pickers. Desktop is unchanged.
3. **Long-press confirmed** (Jimmy's words: "long press -> release -> highlight word -> can drag it further", and the Termius hold → vibration → arrow motion pad). Long-press fires with a haptic; keep holding and drag = arrow pad (direction sends arrows, repeating while held); release without moving = select the word with handles, drag to extend, edit menu with Copy. Same in mouse-mode apps (never a mouse event). Vertical swipe in alternate-screen apps still sends ↑/↓. No spacebar-trackpad mapping.
4. **Fixed key row** (no smart/context keys; deferred to FUTURE with rationale in the decisions file). Arrow use is "mostly recalling commands" → ↑ and ^R are in the row; no tether-side command history.
5. **Two openers, one closer**, as you specified, plus Termius's focus cues: terminal focused = solid block cursor, field shows placeholder, keyboard Return is plain; field focused = caret in field, terminal cursor becomes a hollow outline, keyboard Return is the blue send key (`enterkeyhint="send"` / `returnKeyType = .send`). Your keystroke-routing table stands (printable key-row keys into the field when it has focus is fine).
6. **Capitalization in the line field: off** (tech-lead call: commands first; dictation still capitalizes on its own). Autocorrect and dictation on as you had.
7. Deferred to FUTURE (record in the right `.context/FUTURE` or work FUTURE, not specs): smart keys, tab-chip swipe for prev/next tab, line-field command history, spacebar-trackpad arrows.

## Also
- Specify the daemon's paste confirmation (`pasted { req }` and the refusal carrying `req`, closing L4) precisely enough for a coder: protocol doc, daemon-core/hub change, client handling. It will be built as its own lane before/alongside P3a.
- Log each decision in `docs/design/decisions.md` (merge with your 11 entries where they now conflict: the arrangement entry must state the chosen one; specs state the current rule only).
- Update P3a/P3b rows: P3a = dock (variant 2), line field, owned input, toggle, focus cues, switcher sheet; P3b = gestures (long-press pad + selection), scrolling.
- Run one review (reviewer, fresh) over the whole uncommitted design change after your edits, fix what it finds, and report anything left.
- Do not commit. Don't edit `web/` source.

Report: what changed since p110, review findings and their fixes, anything still open for Jimmy (only if genuinely his call).
Spawn env: `TMPDIR=/tmp/tether-meridian-501`.
