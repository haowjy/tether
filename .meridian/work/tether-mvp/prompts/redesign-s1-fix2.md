# Slice 1, fix round 2 (last round on this concern)

Strict review p330 of HEAD `a484cd1`:
`/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p330/report.md`. Read it in
full; its repro spec is in `/tmp/p330/drill.spec.ts`.

The blocking bug (finding 1: after any tab switch, tapping a folder in a Files tab does
nothing) comes from a record trusted as an owner: the router entry's `tab` copies the
workspace's active tab and goes stale. Fix the class, not the guard, with the reviewer's
move: **on a tab route, the current history entry always names the active tab** (the
controller replaces the current entry with `{tab, place}` whenever the active tab changes
while a tab is on screen; replace adds no history entry). Then delete the stamp in
`pushPlace` (plain push), the entry clause in `shownFiles`, and the reducer's
`event.tab === state.active` guard if the stale-pop skip already covers it.

Same commit:
- **#2** one cancellation: the pane's per-place effect, used for the Markdown link
  resolve too; `openPlace`/`resolvedPlace` act on the active Files tab like `toPlace`;
  delete `shownFiles` and the `mounted` ref.
- **#3** `Entry` as a union (`{route:"home"} | {route:"tab"; tab; place}`), `isEntry`
  checks `place` with the exported `isPlace` from `saved.ts`, delete `Navigated` and emit
  `Entry`.
- **#4** one bounded per-folder record `{names, first}` in `Folders` (one eviction, one
  drop; document what clears what), and bound `FilesSession.scroll` (a `Recent`, or prune
  on tab close: pick the simpler).
- **#5** pass `activeTab` to the router at construction, or move the stale decision to
  the controller, whichever the move makes simpler.
- **#6** `samePlace` next to `FilesPlace`, narrowing on `kind`.
- **#7** docs: `client-architecture.md` glossary and §6.6 and the FileBrowser ownership
  lines, p329's stale items (`session.test.ts:10`, `IconButton.tsx:13`,
  `FolderDialogs.tsx:1`).

Before finishing, run p330's repro (`/tmp/p330/drill.spec.ts` against the harness) and
show it reaches "tether" after the switch; also exercise by hand: switch via the top
row and the phone switcher, Insert path then return, the path field's find overlay
after a switch, then drill and Back in each. Re-run p325's real-stack request count
(zero requests on A ↔ B switches and Back through loaded folders). Gates: `pnpm --dir web
run check`, `pnpm --dir web run e2e`, `scripts/preflight.sh full`. No new permanent tests
(the reviewer proposes one; the lead will put it to Jimmy). One local commit on top, do
not push. Report SHA, per-finding changes, what you ran and saw.
