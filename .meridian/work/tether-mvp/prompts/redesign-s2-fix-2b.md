# Slice 2 review fixes, then slice 2b (desktop + popover)

You built slice 2 (`c2086d4`). Since then `1c93d31` (Mermaid, another writer) landed on
top; don't touch `web/files/render/`. Reviews of your commit:
- correctness p335: `/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p335/report.md`
- harness probe p336: `.../p336/report.md` (screenshots in
  `.meridian/work/tether-mvp/redesign/s2/`)

## Commit 1: review fixes

- **p335 #1** (the same fact decided twice: which button opened the overlay vs which
  form it takes): the opener chooses the form. `CurrentTabButton` opens
  `{screen:"sessions", name:"sheet"}`, the top row's `+` opens `{screen:"sessions",
  name:"picker"}`, `Sessions` renders by `name` and stops reading `layout`. The sheet
  then can't open on Home, and a resize no longer swaps dialogs. Slice 4's full-height
  sheet will be a third name.
- **p335 #2**: `host = tab ? app.hosts.byHostId(tab.host) : hosts[0]`; when undefined or
  unreachable, New session / Browse files are disabled with the reason (as Home does),
  never acting on another server.
- **Empty copy** (p336): the sheet's empty state must not say "Create one from Home."
  beside +. Make the copy fit where it shows (the list shouldn't need to know it's in a
  sheet if the empty state can be passed in or the action named generically: pick the
  structure, not a flag).
- **p336 Files fixture**: the Files tab behind the sheet showed "It isn't there any
  more" after opening Files. Find out whether that is fixture data or a product defect
  and fix whichever it is.

## Commit 2: slice 2b, the desktop + popover

`browser-behaviors.md` "Session picker (desktop)": + opens a popover **under the top
row** (anchored to +, not a centred modal) with search (auto-focused), sessions grouped
by server with open marked, the active multi-window session's windows under its row
(same rows as the phone sheet: one row renderer), and New session / Browse files.
Selecting a session opens/activates its tab and closes the popover; Escape or an outside
click dismisses without changing the active tab; focus returns to the terminal, or to +
with no tab. Delete `WindowChoices` and the desktop `WindowsMenu` if the popover's
window rows replace them (p335 #3: one renderer for "index: name", "shown", and
"choosing the shown window does nothing"); if a desktop window switch must stay reachable
without opening +, say why and keep one renderer anyway.

Both commits: no UI tests; code structure over if statements; update unit tests that pin
replaced logic. Docs in the same commit (`browser-behaviors.md` if an open item settles,
`decisions.md`, `client-architecture.md` §7.4, CHANGELOG bullet for 2b). Gates:
`pnpm --dir web run check`, `scripts/preflight.sh full`. Exercise in the harness by hand,
phone 390x844 and desktop 1280x800 and a narrow desktop window (500 px, mouse): the
p335 #1 Home sequence (+ on Home, tap a row, Back, Back) must never reopen the sheet;
popover anchored, search focused, selection closes it, Escape/outside click, window
rows. Local commits only, do not push; stage only your files. Report SHAs and what you
exercised and saw.
