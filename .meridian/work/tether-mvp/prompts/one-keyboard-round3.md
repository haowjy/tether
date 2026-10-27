# Round 3 on c3cf4f2: the chord rule, plus the lows (review p306 in --from)

Root cause (tech lead): "which insert becomes a chord" is owned by two parts — the web's
`apply()` (only a single `[A-Za-z0-9 ]`) and whatever native decides to divert before the
web sees it. Round 1 had native guess by content; round 2 diverted everything. End it by
splitting on shape, not content:

1. **Native** (`KeyboardInput.swift` `shouldChangeCharactersIn`): while armed, divert only
   an insert of exactly one grapheme at a collapsed caret (`range.length == 0`,
   `string.count == 1`). Anything else (autocorrect/QuickType replacement, multi-char,
   replacement range, programmatic `insertLine`, dictation): clear `armedModifier` and let
   UIKit insert; the web disarms on the next `lineEdit` while armed (as the marked-text
   path already does in `NativeLineInput.edited`).
2. **Web**, for a diverted single character: `apply()` decides. Chordable → chord to the
   terminal as today. Not chordable (e.g. `.`) → disarm and put the character back into
   the line at the caret via `lineInsert`. Never send it to tmux bare.
3. **Browser `LineField` `onBeforeInput` and `KeyRow`:** back to "chord, or disarm and insert
   into the line" via `modifiers.chord()`; no bare send to the terminal.
4. Make ios-shell.md (~313), client-architecture.md (~1376-1379) and decisions.md (~3454)
   state this one rule identically.

Lows from p306, all to fix:
5. `nativeLine.ts` `adoptRestoredLine`: when the restored line can't be stored, skip the sync
   while `restored` is set (make the comment true); no note retry loop.
6. Delete the native adapter's dead pre-boot `pendingLineEvents` queue
   (`web/platform/native/index.ts`); the owner's `pending` is the one queue.
7. Remove the remaining "there is no …" sentences: ios-shell.md ~344, client-architecture.md
   ~1120-1121 and ~1394.
8. `WebShellController.keyboardInputLineReturn`: drop `requireReceiver: true` with nil
   completion, or act on failure by restoring the field's text — pick the one with no dead
   flag; say which.

Verify with a fake-native Playwright harness (then delete it): armed ctrl + `c` → ^C to
tmux, line unchanged; armed ctrl + `.` → `.` in the line, disarmed, nothing to tmux; armed +
a multi-char insert edit → text in line, disarmed; browser path and KeyRow the same. Gates:
`pnpm --dir web run check`, `./ios/scripts/check.sh`, `scripts/preflight.sh full`. Commit on
top (not pushed). Report each item and the hash.
