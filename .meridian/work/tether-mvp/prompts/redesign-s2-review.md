# Review slice 2 of the client redesign (`c2086d4` on main, local)

Repo `/Users/jimmyyao/repos/tether`. `c2086d4` built the phone resting bar (current-tab
button + Show keyboard) and merged the `picker` and `switcher` overlays into one
`sessions` overlay: the phone half-height sheet (Home + search, sessions grouped by
server with the active session's windows under its row, strip + `+` at the bottom) and
the desktop picker dialog. It also changed `Router.popped`: leaving an overlay repairs
the landed entry to the overlay entry's tab and place. Review the code at HEAD.

Intent: `docs/design/client/browser-behaviors.md` (Platform layout, Session picker and
switcher, Window switcher, Phone dock: current-tab button), `.meridian/work/tether-mvp/redesign/plan.md`
D2 and "Open details" (Jimmy: row tap keeps the sheet open, list not grid, windows under
the active row). Writer's report: `meridian spawn show p334`. Slice 1's reviews, for
recurring concerns: p330 and p333 (`/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/<id>/report.md`).

Jimmy's rule: no UI tests; code structure over if statements. So report states the
code can represent that it shouldn't, and the structural move, not "add a test".

Risks to check, beside anything else:
- the `popped` repair: Back/Forward sequences with the sheet open across row taps,
  strip taps, closing tabs from the strip, Browse files, + menu, Escape and backdrop;
  overlay entries from before a reload; does Back always close the sheet first and then
  go Home, never to a stale tab?
- the line field hidden but mounted at rest: draft survival, that nothing can focus it,
  native line ownership (`nativeLine.ts`) and `focus.ts` modes when the sheet opens
  (keyboard lowers) and closes (native restores the held target; the browser
  refocuses inside a closing tap, leaves the keyboard down after Back/Escape).
- the active tab's server for + and grouping; `hosts[0]` fallback.
- window rows: `selectWindow` on the active session only; "shown" from `watching`.
- desktop: the windows menu still opens and works after the `variant` removal; the
  dialog closes on choice; focus returns per spec.
- the listing fetch on open (`syncListing` names the new overlay), no request per
  keystroke in search.

Edit nothing. Findings ranked by severity with path:line, a concrete failure scenario
and the structural fix.
