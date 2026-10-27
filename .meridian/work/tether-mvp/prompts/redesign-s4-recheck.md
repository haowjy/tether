# Re-check slice 4 after its fixes (`a1af637`)

You reviewed `ca0d42f`/`40d8bab` (your report:
`/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p347/report.md`). Fixes in
`a1af637` (writer's report: `meridian spawn show p349`): Home rows from `tabPills`/
`lookOf` via `pillMeta`; `hostOf` lone-host stand-in only while the id is unknown;
`hostsKnown` drops every tab of a gone host; `Persist.clearLocalData` excludes the tabs
open at clear time; `syncListing` keyed on the surface; `cardOf` in
`screens/home/card.ts`; `app.retryHost`; Home hides the unreachable banner; `Dialog`
placement-only with `DialogBars.tsx`; ServerSheet parses params and closes when its host
goes; Settings `Section`; `Row` meta yields first. The cross-server bug was the test
platform's `openSocket` giving every handle one id.

Read the frozen export `/tmp/tether-rev-s4b/` (= `a1af637`), not the live checkout.
Did each finding land as structure, did the round add special cases (the "clear-time ids"
set in Persist, the banner suppression on Home, `Row`'s shrink applied to every row),
and is the production identity path sound (tabId with host id, `rowOf`, `openSession`)?
Short report: fit to push yes/no; remaining findings with path:line and the move. Edit
nothing.
