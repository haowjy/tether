# Slice 4 fix round 1

You built `ca0d42f` and `40d8bab`. Since then `ced2437`, `f86cef7`, `7f954c3` (slice 3
fixes: dock, routing, e2e) landed on top; build on HEAD. Reviews:
- correctness + strict p347: `/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p347/report.md`
- harness probe p348: `.../p348/report.md` (screenshots `.meridian/work/tether-mvp/redesign/s4/`)
Read both in full. One local commit (two if the identity fix is cleaner alone); do not
push; stage only your files.

**First, the identity bug (p348 #1, blocking):** in `homeTwoServers`, the second
server's full sheet marks `tether` and `notes` "open" and tapping one activates the first
server's tab. Tabs are identified by server/session identity, never by name
(`browser-behaviors.md` "Terminal": "Implementation identity must use server/session
IDs, not mutable display names"). Find where host identity is dropped (`rowOf`,
`openSession`, the reducer's `opened`, the fixture's host ids) and fix the cause so a
session on one server can't match a tab on another by construction; if the fixture
itself gives both servers one identity, fix the fixture and say so, and still check the
production path.

Then p347:
- **#1** Home's tab rows come from `tabPills`/`lookOf` (one derivation of a tab's state
  and label for the top row, the sheet strip and Home); delete Home's `waiting` rule.
- **#2** the lone-host fallback only while `hosts[0].hostId === null`; when the host list
  is complete, `hostsKnown` drops every tab of a host that is gone, not only restoring
  ones.
- **#3** Clear local data per spec ("deletes drafts and the saved workspace on this
  device, leaving currently open tabs until closed"): one owner (Persist) treats the
  tabs open at clear time as unsaved, so a later save never writes them back; tabs
  opened after the clear save normally. Make the copy say exactly that.
- **#4** listing fetched on entering each listing surface: key on the surface identity
  (route + overlay name), not a boolean.
- **#5** one pure `cardOf(host, sessions) → {status, body, files}` with impossible pairs
  unrepresentable.
- **#6** one retry function; one Retry on screen per fact (spec puts it on the card:
  suppress the host banner's Retry on Home, or explain why not).
- **#7** `Dialog` variants mean placement only; `TitleBar` / `PageBar` header
  components; delete `backLabel`, the page branch, ServerSheet's own Back, the duplicated
  CSS, and the `as "sheet"` cast.
- **#8** the server sheet closes when its host is gone; no cast on router params (parse
  them).
- **#9** stale "tap Home search" in `client-architecture.md`.
- **Slice 5 prep**: a `Section({title, detail, children})` in Settings so the next
  sections don't repeat markup.
- **p348 320 px note**: on narrow screens the tab row's status ("Reconnecting…") yields
  width to the session name, which the spec keeps visible.

No UI tests; code structure over if statements; update unit tests that pin replaced
logic. Gates: `pnpm --dir web run check`, `scripts/preflight.sh full`. In the harness,
re-run p348's two-server sequence (second server's sheet marks nothing open, tapping
`tether` opens a tab on that server), an offline host with a live tab (its Home row
reads "Reconnecting…"), Clear local data then background (`visibilitychange`) then
reload (cleared tabs don't come back), and All N sessions after a session was created
elsewhere (the sheet lists it). Report SHAs and what you saw.
