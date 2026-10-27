# What grew the initial JS, and what could leave it

tether's web client (`/Users/jimmyyao/repos/tether/web`, Preact + Vite/rolldown) has an
initial-JS budget in `web/scripts/checks.mjs`. Across the redesign it went 196 → 197 →
198 → 199 → 200 KB gzipped (see the 2026-10-27 entries in `docs/design/decisions.md`
mentioning the budget). The product runs on spotty phone links ("every byte and round
trip costs the user").

Use the frozen export (you may write anywhere under /tmp) `/tmp/tether-rev-s5/` (= commit `31cb04e`; don't build in the live
checkout). Build it (`pnpm --dir /tmp/tether-rev-s5/web install --frozen-lockfile`, then
`pnpm --dir /tmp/tether-rev-s5/web run build`; pnpm only) and, for comparison, build
`b847e18` the same way in `/tmp/tether-rev-b847/` (`git -C /Users/jimmyyao/repos/tether
archive b847e18 | tar -x -C /tmp/tether-rev-b847`). Report: the initial chunk(s) and their
gzipped sizes at both commits; which modules account for the growth (rolldown/vite
manifest, source-map-explorer or a module size listing); which screens or code in the
initial chunk are not needed for the first paint of Home or a terminal tab and could be
lazy (Settings, the server sheet, Files previews, dialogs, Mermaid loader stub...),
each with its gz size and the import that pulls it in. Edit nothing in the repo; delete
the /tmp builds after.
