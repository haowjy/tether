# Dock follow-up from re-check p350

You built slice 3 and its fixes (`f141158`, `7f954c3`). Re-check p350:
`/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p350/report.md` (fit to push;
four findings). Since then `a1af637` (slice 4 fixes) landed; build on HEAD. One local
commit, do not push, stage only your files; nobody else edits the dock now.

- **#2 + #3 + #1 as one move:** one native line editor value (e.g.
  `nativeLineEditor(platform)`), LineField owns the browser `LineEditor` beside its
  textarea and composition flag, and one `TerminalsController.key(key, editor)` reads the
  live owner, calls `modifiers.route` and carries out every route kind including
  `focusTerminal`. KeyRow, LineField's Esc and the native input path each become one call;
  delete KeyRow's `keyOwner === "none"` guard, LineField's hard-coded `"line"` and
  `.to === "focusTerminal"` check, Dock's `composing`/`inputRef` props. Browser Send then
  drops while composing where the flag lives, as native does.
- **#4:** log in `decisions.md` that with the sheet unable to open while the keyboard is
  up, and the desktop picker returning focus to `+`, the old "keyboard comes back to the
  input that held it after a sheet" behaviour no longer applies; adjust the spec line
  (`browser-behaviors.md` "Terminal taps and sheets": "On sheet close, native restores the
  held target...") to what is true now.

No UI tests; code structure over if statements. Gates: `pnpm --dir web run check`,
`ios/scripts/check.sh`, `scripts/preflight.sh full`; re-run the real-stack dock checks
(ctrl+hold ←, esc, tap, Send, ^R) on tmux 3.4 (`TMPDIR=/tmp`). Report the SHA.
