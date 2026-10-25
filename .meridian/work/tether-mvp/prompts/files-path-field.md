# Build: Files finds folders with a path field and completion (lane 2)

The design is settled; build it. Spec: the Files section of
`docs/design/client/browser-behaviors.md` and `docs/design/fs.md` as they now stand in the
working tree (uncommitted design changes by the design lead; read, don't edit them — if
the spec is wrong or silent, say so in your report instead). Summary and plan:
`.meridian/work/tether-mvp/design-session-follow-and-folder-find.md` (section 2 and lane
2). Jimmy's decisions: `.meridian/work/tether-mvp/real-use-decisions.md` items 3 and 7
(the path field replaces the "Add folder" dialog — delete the dialog and its code).

Key rules (spec wins where this differs): one field at the top of Files; at rest the
current path; typing lists matching subfolders and ghost-text predicts the first; phone:
tap a row accepts and keeps the keyboard up, typing `/` after a partial name accepts the
prediction; hardware keyboard: Tab or →; Return/Go opens the folder the field names; no
request per keystroke (list a folder once after a 250 ms pause, cache 32 folders, page up
to 5 times with the scan-cap message); `~` outside roots lists the home folder with rows
marked "not added" and "Add this folder"; above the roots, the loaded root paths only;
hidden folders only when the typed name starts with `.` or the hidden toggle is on;
ordinary text keyboard (not URL); tap-browsing keeps working. Mobile first. No daemon change.

Constraints: `web/AGENTS.md` (completion model as a pure module in `web/files/` with unit
tests; raw inputs only in `ui/primitives/`; environment only in `platform/`; tokens;
CSS modules; every state: loading, empty, error, offline, scan cap, with harness fixtures
in both layouts). pnpm only. Another lane may later touch tabs/workspace; stay in
`web/files/`, `web/screens/files/`, the harness files fixtures and `ui/primitives/` only
if a primitive is truly needed (report it). Do not commit; keep throwaway scripts out of
`web/`.

Verify: `pnpm --dir web run check`, `pnpm --dir web run e2e` (files routes in Chromium and
WebKit, phone and desktop), the completion model's tests, and the spec's cost rule
(typing `~/repos/tether/web` issues at most 4 listings — assert it on the harness's fake
daemon). Before/after PNGs in `.meridian/work/tether-mvp/evidence/files-path-field/`.
Report: what changed, deleted code, verification, what Jimmy should check on the iPhone.
