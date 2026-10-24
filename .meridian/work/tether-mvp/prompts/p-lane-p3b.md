# Lane P3b: touch gestures — long-press arrow pad, word selection, edit menu, touch scroll

Build P3b exactly as `.meridian/work/tether-mvp/design/client-architecture.md` specifies: its P3b row in §11, §7.6 (the gesture recognizer and its resolution table), the section around line 1381 and 1498 ("P3b owns this", its §12 gates), and the logical-copy row (soft wraps from L3 snapshots and `wraps` on history chunks). Product rules: `docs/design/client/terminal-interaction-design.md`, `docs/design/client/browser-behaviors.md`. Jimmy's words are in `.meridian/work/tether-mvp/phone-input-decisions.md`: long-press fires with a haptic; keep holding and drag = arrow pad under the finger (direction sends arrows, repeating while held); release without moving = select the word under the finger with handles to drag further, edit menu with Copy (and Paste; Paste alone over a blank cell); same in mouse-mode apps (never a mouse event on long-press); taps with app mouse mode send a click; taps without do nothing (never focus); vertical swipe scrolls history on the normal screen with momentum, and sends wheel/↑↓ in alternate-screen or mouse-mode apps; horizontal swipes do nothing (system back gesture). Copy preserves logical lines, not visual wraps.

Built on: P3a (2a5c401; dock, `touch/`, FocusController, the temporary `pointerdown` guard that P3b's recognizer replaces) and PS-web (just before you: pane can be larger than the tab, pinned left, cursor pan; coordinate mapping must handle a pane wider and taller than the tab). Also handle `web/.context/TODO`'s P3b items (iPad touch tools row blurring the owned input; toast gap).

Jimmy cares about feel: he judged the spike useless because nothing worked. Scrolling must have real momentum; the arrow pad must feel like Termius's.

## Verify
- Unit tests the spec names (recognizer resolution table as a pure core).
- Playwright with touch emulation, real daemon on scratch tmux 3.4 and 3.7b: long-press-hold-drag sends arrows to `cat -vt`; release selects a word and Copy yields the logical line across a soft wrap (clipboard read); tap in `vim` with mouse on sends a click, tap in bash does nothing; vertical swipe scrolls history and in `less` sends ↑/↓; horizontal swipe sends nothing.
- Add the device-only checks (haptic, momentum feel, selection handles, system back gesture coexisting) to `$MERIDIAN_ACTIVE_WORK_DIR/g3-iphone-checklist.md`.
- `scripts/preflight.sh full`. Don't commit; report files, spec → implementation, verification, divergences.
Spawn env TMPDIR=/tmp/tether-meridian-501.
