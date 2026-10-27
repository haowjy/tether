# Round 2 on c43797d (one keyboard), from review p304 (in --from context)

Amend on top of c43797d (a new commit or amend; not pushed — the lead pushes). Tech-lead
decisions per finding:

1. **One sync rule for the native editing copy:** whenever the draft store's text for the
   bound tab differs from the last text native reported, the web sends `lineSet`. Delete the
   per-transition `loadNative` calls (send, clear, refused edit). Verify: a refused send's
   `restore()` reappears in the box AND survives the next keystroke; a `remote` draft change
   likewise.
2. `focus.ts` `restingNow()`: `isSelecting` before the `line` check; the owner stays `line` so
   release restores it.
3. `KeyboardInput.swift`: while `markedTextRange != nil`, `deleteBackward` and Return go to
   `super` and send nothing, in every target.
4. **Restructure** to the reviewer's simpler shape: native-line handling (generation check,
   applying edits, Return → send) lives in one non-React owner beside `LineDrafts`, created
   at app start and subscribed to platform events; it waits for drafts itself. Delete the
   controller's and LineField's line-event queues and the triple-held restored snapshot (one
   holder). LineField/LineMirror become renderers. Swift: Return while the page isn't ready
   is refused via the existing warn-and-keep-the-line path; delete `pendingLineReturns`, the
   byte accounting, attempt ids and the `pageReady` wedge. The Boot `lineSnapshot` keeps
   the text.
5. **One chord authority: the web.** Keep `modifiers {armed}`; while armed, native does not
   insert the next committed character in `line` — it routes it, whatever it is, to the web
   on the terminal-key path where `modifiers.chord`/`apply()` decides. Delete
   `canBeChordCharacter` and the web's lineEdit revert-and-chord fallback.
6. **Native owns the generation alone.** The web never bumps it; after a Return native has
   cleared the field, so the web sends no `lineSet` for it. Delete the dead `setLine(...)`
   calls in `send()`.
7. Docs state current rules only: ios-shell.md ~238 and ~340, client-architecture.md's
   "There is no line-field rect…" sentence; focus.ts:128's stale justification (route the
   stand-in through `rest()` if that's now correct).
8. Note in ios-shell.md's device checklist: dictation into the terminal target (revisions
   after send-and-clear), whether WebKit handles/Copy need `select`, IME candidate Return.

Re-run the fake-native Playwright checks for 1, 2, 4, 5, 6 (then delete them), all gates
(`pnpm --dir web run check`, `./ios/scripts/check.sh`, `scripts/preflight.sh full`). No new
permanent tests. Report each item with what you observed and the final commit hash.
