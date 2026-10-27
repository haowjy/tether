# Slice 3 fix round 1

You built `229bbe4` and `f141158`. Since then `ca0d42f`, `40d8bab` (slice 4, Home and
sessions; another writer) and `ced2437` landed on top: build on HEAD. Review p343:
`/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p343/report.md` (read in
full). One or two local commits on top, do not push, stage only your files. Another
writer may be reviewing; nobody else edits the dock now.

Fix:
- **#1 and #2 together, as the class:** one dispatch reads the live modifier state and
  commits it: `routeKey` returns `{route, armed}` (as `apply` does) and one method
  (e.g. `ArmedModifiers.route(key, owner)`) reads live `armed`, commits the new state
  and returns the route. KeyRow (including the repeat timer, which must route each tick
  against live state), LineField `beforeinput`, and the native text path in
  `terminals.ts` all call it; delete `chord()` and the callers' own `disarm()`. Narrow
  the owner type to `"terminal" | "line"` where only those can occur.
- **#3, lead's decision:** with the keyboard up and the box owning typing, a terminal tap
  does exactly one thing: it gives typing back to the terminal. No mouse click, no
  cursor move; the next tap clicks as usual. Express it as one pure `tapAction(...)`
  returning a single action, not a `return` added to a branch. Update
  `browser-behaviors.md` ("Terminal taps and sheets"), `terminal-interaction-design.md`
  (tap rows) and `ios-shell.md:710` to say so, and log it in `decisions.md`
  (2026-10-27, lead; rejected: tap both returns typing and clicks, since an unintended
  click in vim/htop mid-line is worse than one extra tap).
- **#4** and the stale dock e2e you flagged: update `web/e2e/home/home.real.ts` (drop the
  New window half) and `web/e2e/dock/dock.real.ts` (the line field is hidden at rest:
  raise the keyboard first) so they pass on the real stack (`TMPDIR=/tmp`, tmux 3.4).
- **Lows:** browser `step` drops during IME composition, like native; hardware Esc in
  the browser box goes through the same dispatch as native; no key repeat for a key whose
  route is focus-terminal (stop repeats on the mode change); the stale text
  (`HostSessionLists.tsx:16` if still there after slice 4, `daemon-core.md:1575`,
  `ios-shell.md:560`).
- **Visible Send** (the lead's addition; spec: line target shows "box ring and caret,
  visible Send"): a Send button in the compose box, shown while the line owns typing,
  acting exactly as Return (sends the line then Enter, keeps focus in the box). In the
  app native owns the text, so add a web → native `lineSubmit` message that makes native
  submit as its Return does; fold it into bridge **v6** (unpushed, so no new version):
  `bridge.ts`, Swift DTOs and fixtures together. The button must not take focus from the
  native responder or the textarea (use the existing DockButton no-focus pattern).

No UI tests; code structure over if statements; update unit tests that pin replaced
logic. Gates: `pnpm --dir web run check`, `ios/scripts/check.sh`, `scripts/preflight.sh
full`, and the two real e2e files on tmux 3.4. Re-run your real-stack checks (← → in the
box, esc, tap back, ^R, Return), plus: arm ctrl, hold ← in the box (one `C-Left` to tmux,
then caret steps, nothing else reaches tmux); tap htop with the box focused (typing
returns, htop unchanged); Send. Report SHAs and what you saw; list what is
Simulator-built and device-unverified.
