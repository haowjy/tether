# Look at slice 5's Settings and themes in the harness

Use the frozen export `/tmp/tether-rev-s5/` (= commit `31cb04e`), not the live checkout:
`pnpm --dir /tmp/tether-rev-s5/web install --frozen-lockfile`, then
`pnpm --dir /tmp/tether-rev-s5/web exec vite --configLoader runner --mode harness --port 5251`
(pnpm only). Open `/harness/index.html?fixture=<name>&layout=phone|desktop&scheme=dark|light`
with the `settings` and `settingsApp` fixtures, a terminal fixture (`dock`), Home
(`homeTabs`), the sessions sheet (`sessions`) and Files. Load `/agent-browser`, `/probe`.

Spec: `/Users/jimmyyao/repos/tether/docs/design/client/browser-behaviors.md` "Visual
treatment". Check phone 390x844 and 320 px, desktop 1280x800: Settings shows
Appearance (System/Light/Dark), Text size, and (app fixture only) Face ID relock with
1 hour selected by default; choices are clear, 44 px targets, selected state distinct,
focus ring; switching appearance re-themes everything (terminal true black in dark, no
blue tint in greys; light readable); the sheet, popover, cards and dock look right in
both; no horizontal scroll at 320; no middle dots. Compare with
`.meridian/work/tether-mvp/redesign/before/`. Save viewport screenshots under
`/Users/jimmyyao/repos/tether/.meridian/work/tether-mvp/redesign/s5/` with a README.
Edit nothing else; stop the server. Report pass/fail per check with evidence.
