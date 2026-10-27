# Slice 1, fix round 1

You built slice 1 (`da1373b`, `450b454`, local on main). Two lanes reviewed it at HEAD:
- correctness review: `/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p322/report.md`
- real-browser probe: `/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p324/report.md`

Read both in full. Fix all seven p322 findings as it recommends, with these lead
decisions:

- **#1 late Files continuations**: scope `openPlace` / `resolvedPlace` to the pane's tab
  id, act only when that tab is active, `screen === "files"` and the router entry is
  that tab; drop link resolution and `onResolved` when the pane unmounts.
- **#3 re-listing (also p324's failing checks)**: don't add per-tab browsers. Make the
  per-host cache hold real listings: the first pages of the 32 most recently loaded
  folders per host (keyed by path and hidden flag), so showing a folder that is in the
  cache, on a tab switch, a Back/Forward or returning to a preview's folder, makes no
  request. That is the spec's existing rule (browser-behaviors.md "Cost on a spotty
  network": "Listings are cached per host for the Files session (the 32 most recent
  folders)"; pull-to-refresh and tether's own uploads drop the affected ones). Fold the
  completion names cache into it if that removes a second structure; keep the cache
  bounded. Returning to a file preview must not re-probe if its result is held for that
  tab. Fix the D1 reasoning in `decisions.md` (the rejected per-tab FileBrowser stays
  rejected; the reason becomes "the per-host listing cache restores it").
- **#2 v1 drafts**: validate records in `drafts.list()` at the storage boundary, drop any
  whose key isn't a session `TabKey`; correct the decision text and
  `browser-behaviors.md:228`.
- **#4** dedupe/reject duplicate ids in the parser. **#5** save `lastTerminal` in v3
  and delete the seeding special case. **#6** one rule in `step()`: tabs empty while
  `route === "tab"` navigates Home. **#7** router keeps the full stack with a cursor.

Then repeat p324's failing checks yourself against the real stack (`TMPDIR=/tmp`,
tmux 3.4, `web/README.md` "End to end against a real daemon"; throwaway scripts in
`/tmp`, never the repo): the A → B switch and Back sequence must issue no request for a
folder already loaded, and Forward after Back keeps working.

Amend nothing: add one commit on top ("Slice 1 review fixes ..."), local, do not push.
Run `pnpm --dir web run check`, `pnpm --dir web run e2e`, `scripts/preflight.sh full`;
`ios/scripts/check.sh` if Swift changed. No new permanent tests. Report the SHA, what
changed per finding, and what you exercised and saw.
