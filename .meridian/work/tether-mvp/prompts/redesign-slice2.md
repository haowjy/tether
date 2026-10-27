# Build slice 2 of the client redesign: the phone bar and the sessions sheet

Repo: `/Users/jimmyyao/repos/tether`, branch `main`, primary checkout (no branches,
worktrees or PRs; read `AGENTS.md`). You are the only source writer. One local commit
(two if the overlay merge is cleaner on its own first); **do not push**.

## Context

The redesign's behaviour is settled in `docs/design/client/browser-behaviors.md`
("Platform layout", "Session picker (desktop) and session switcher (phone)", "Window
switcher", "Phone dock": the current-tab button). The build plan is
`.meridian/work/tether-mvp/redesign/plan.md`: read D2 and the "Open details" list
(Jimmy's 2026-10-27 answers are binding). Slice 1 (commit(s) just before yours, see
`git log`) made Files tabs and one tab model; build on its owners, don't work around
them. Read `web/AGENTS.md` and `.meridian/work/tether-mvp/design/client-architecture.md`
§6, §7.4. Before-state screenshots: `.meridian/work/tether-mvp/redesign/before/`.
Mockups (the spec wins where they differ): `.meridian/work/tether-mvp/phone-redesign-mockups/`.
Load `/ui-implementation` and `/react-architecture` before writing UI.

## Build

- **Phone resting bar** (terminal, keyboard down): the current-tab button (active tab's
  label: bold session, regular window, truncating the window first; Files: folder/file
  name; open-tab count; a slot for the attention dot, not wired yet) and Show keyboard.
  No tab strip or + on the terminal. The phone Files/preview screens show the current-tab
  button only. Leave the keyboard-up layout as it is today (slice 3 changes it), but
  the chip/strip on the terminal goes.
- **One `sessions` overlay** replacing the `picker` and `switcher` overlays (D2): grow
  the shared `HostSessionLists` rather than adding a parallel component. Phone presents
  it as the half-height sheet over the current tab (tab remains visible above): top row
  Home button + search (not auto-focused); sessions grouped by server, rows marked
  "here" (active tab's session) and "open"; at the bottom the tab strip (terminal and
  Files tabs in order, next tab peeking, swipe scrolls, tap switches the tab behind the
  sheet and the sheet stays, × on the active tab only, closing never kills tmux) and +
  (New session, Browse files: a new Files tab at the server's roots). A **session-row
  tap opens or activates that tab and keeps the sheet open** (Jimmy). Dismiss: tap
  outside, system back, Escape. Opening the sheet lowers the keyboard. With the
  search field's keyboard up, the sheet sits above it and the list scrolls. The sheet
  uses the active tab's server, not `hosts[0]`. Loading, empty, offline, refused states
  distinct.
- **Windows under the active row**: when the active tab's session has more than one
  window, its row lists them beneath it as "index: name", the latest `watching` window
  marked "shown"; tap runs the existing `selectWindow`; choosing the shown one does
  nothing. Other rows show a window count. Delete `WindowChoices`' old placement and the
  desktop `WindowsMenu` only if the desktop popover replaces it in this commit;
  otherwise keep desktop's window access working until slice 2b.
- Desktop keeps today's picker contents through the merged overlay until slice 2b
  builds the popover; it must keep working.
- Full-height sheet from Home is slice 4; don't build it.

Delete what's replaced (Switcher, the old overlays, the dock chip/strip pieces, their
styles) in the same commit. Update stale unit/Playwright tests; add no new permanent
tests (Jimmy's rule), and delete temporary ones before committing. Update harness
fixtures so the sheet renders with several sessions, a multi-window session, a Files
tab and the empty/offline states, in both layouts.

Docs in the same commit: `browser-behaviors.md` (the dismissal-after-row-tap open item
is now settled: keeps the sheet; list not grid; windows under the active row; log each
in `decisions.md` as 2026-10-27, Jimmy's words in the plan), `client-architecture.md`
§7.4, a `CHANGELOG.md` `[Unreleased]` bullet.

## Verify

`pnpm --dir web run check`, `pnpm --dir web run e2e`, `scripts/preflight.sh full`. In
the harness (phone 390x844 and desktop), exercise by hand: open the sheet from the
current-tab button; tap a row (tab opens behind, sheet stays); tap and swipe the strip;
close the active tab from the strip; + New session and Browse files; switch windows in
a multi-window session; Back/Escape/tap-outside dismissal; sheet with the search
keyboard. Compare against the before screenshots and the mockups. Report SHAs, what
changed, deletions, what you exercised and saw, and anything left open.
