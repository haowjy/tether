# Round 2: touch + pan, from review p301 (in --from context)

Apply to the uncommitted working tree (both lanes' changes; Lane B's report is p299). Do
not commit. Tech-lead decisions on each finding:

1+2. **Chrome is measured from the chrome, not derived per resize.** Replace
   `stableHeight − surface` on every ResizeObserver tick (terminals.ts ~360-374) with what
   client-architecture.md §5.4 says: chrome = the in-flow tether chrome (the dock's
   resting slot, the tab bar), measured when layout, density, width or safe area change;
   a keyboard change is none of those. Then delete all three guards (`!viewport.keyboard`,
   `touchInputHeld`, `visibleBoxIsKeyboardShortened`) and the "Stable chrome is not
   measured…" sentence in decisions.md, and state the rule once in §5.4 / ios-shell.md.
   Re-verify Lane B's transition run (tmux size constant through 16 frames each way, app
   viewport sequence with keyboardInset 0) AND the review's repro: desktop Chromium at
   `--force-device-scale-factor=1.1` connects and paints.
3. Selection drag onto another row: `Math.max(at.to, anchor.to)` only when
   `row === anchor.row`. Re-verify with a cross-row drag on the real stack.
4. Bring `.meridian/work/tether-mvp/design/client-architecture.md` (lines ~77, 126, 154,
   1354, 1478, the §7.6 tap row) and `.meridian/kb/client-design-handoff.md:41` to the new
   rules.
5. decisions.md "Supersedes" for Lane A names the real entries by title: "The key row's
   keys, and arrows by long-press", "Two keyboard openers, one closer", "Touch scroll is
   JS momentum…" (exact titles as in the file).
6. Stale comments: components.css:38, view.ts:5, terminals.ts:244, touchControl.ts:23.
7. Dock.tsx: restore `terminals.element.getBoundingClientRect().top`, drop the offsetParent
   branch and its false comment; keep `visibleHeight` in the effect deps.
8. Delete the new "← and → in the key row…" e2e test (no new permanent tests). Leave the
   rewritten long-press test.
9. **Send `focus select` to native at release, not when the long-press fires.** The web
   still draws the highlight at once and extends it during the drag; keep the selection
   layer inert (no `user-select`/callout, pointer-events as needed) until release so
   WebKit's own long-press can't take the touch. ios-shell.md focus table/Selection bullet
   say so.
10. The tap that raises the keyboard must not also move the cursor: decide "keyboard was
    already held" before focusing. Tap-to-move-cursor applies only when the terminal input
    already had the keyboard before the tap.
11. Note in ios-shell.md / the device checklist that the near-cursor tap raising WebKit's
    keyboard from `pointerup` in Safari/PWA is unverified (ios-web.md lists pointerdown,
    touchend, click as safe). If moving the focus call to the `touchend` of the same
    gesture is trivial and keeps one path, do it; otherwise leave the note.

Gates: `pnpm --dir web run check` (including build), real gesture e2e on 3.4 and 3.7b
(`TMPDIR=/tmp`). Report each item with what you observed.
