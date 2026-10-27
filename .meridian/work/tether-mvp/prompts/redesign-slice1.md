# Build slice 1 of the client redesign: Files tabs and one tab model

Repo: `/Users/jimmyyao/repos/tether`, branch `main`, primary checkout (project policy: no
branches, worktrees or PRs; read `/Users/jimmyyao/repos/tether/AGENTS.md`). You are the
only source writer. Make two local commits, in order; **do not push** (the lead
preflights and pushes).

## Why

tether's client is being redesigned (`docs/design/client/browser-behaviors.md` is the
settled behaviour). The first slice is the enabling refactor every later slice builds
on: Files becomes any number of tabs in the same tab model as terminal tabs. The plan
and its structural decisions are in
`.meridian/work/tether-mvp/redesign/plan.md`; build **slices 1a and 1b exactly as D1
describes** (read D1 in full, and the review behind it: `meridian spawn show p320`,
transcript `meridian session log p320`). Those decisions were made after a structure
review against the code; if the code contradicts one, stop and report rather than
inventing a different structure.

Read before editing: `web/AGENTS.md` (state owners, lint rules, the hand-off protocol
for W0-owned files: you have the lead's authority to edit `workspace/`, `app/`,
`platform/types.ts`, `ui/` as this slice needs), `.meridian/work/tether-mvp/design/client-architecture.md`
§6 (it describes today's owners; update it in the same commit to describe the new
ones), `ios/AGENTS.md`, and the inventory `/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p317/report.md`.

## Commit 1 (slice 1a): the saved workspace is opaque to Swift; one web parser

Behaviour-preserving. Swift stores the bridge's `workspace` field as raw JSON and never
decodes it; delete `SavedWorkspace`, `WorkspaceTab`, `FilesPlace`, `SavedFilesPlace`
from Swift (`ios/TetherKit/Sources/TetherKit/BridgeTypes.swift:123-163`,
`WebShellController.swift:297`, `AppModel.swift:111`). Bridge bytes and version (v5)
unchanged; update the fixtures in `ios/TetherKit/Tests/Fixtures/bridge/` and their Swift
and web tests as needed. On the web side, move saved-workspace version handling out of
the adapters (`web/platform/browser/storage.ts:171-179` and native's equivalent) into one
parser taking `unknown` that returns the current version or null. Keep v1's existing
draft-clearing behaviour exactly as it is today in this commit.

## Commit 2 (slice 1b): the tab union and Files tabs

As D1 says: `TerminalTab | FilesTab` with stable ids and `host`; the workspace owns
each Files tab's place, written only from `navigated`; history entries record
`{tab, place}` with stamp-before-push and the stale-entry skip to Home; one
`FileBrowser` per host reporting canonical paths back; routes `home | tab` with a
derived `screen: home | terminal | files` that Shell, focus, `shownTab` and
`syncListing` read (`focus.screenChanged` on screen changes, including terminal ↔ Files
tab switches with no navigation); `lastTerminal` per host as the insert target for
preview insert and uploads; saved workspace v3 (tabs in order, files tabs with id,
host, place; `active` by id), v2 and v1 discarded whole by the parser, drafts untouched
(this replaces commit 1's v1 draft-clearing: log the change in decisions.md).

Chrome this slice must carry so all three surfaces stay usable:
- Desktop: one top row (⌂ Home, tabs of both kinds with × on the active one, +, server
  context) above whichever screen shows; delete `web/screens/shell/Rail.tsx` and the
  terminal screen's own tab strip. + still opens today's picker (the popover is slice
  2b).
- Tab labels and pills for both kinds (`web/workspace/labels.ts`,
  `web/screens/terminal/tabView.ts`): a Files tab is labelled by its folder or file name
  (roots: the spec's top-level label; pick "Files" and say so). The phone switcher's tab
  list shows Files tabs through the same labels.
- Home's Files action opens a new Files tab at that host's roots (every time, per spec);
  the phone Home Sessions/Files nav (`HomeNav.tsx`) goes if nothing else needs it.
- Phone Files screen shows the dock's current-tab button (opens today's switcher), no
  keyboard control. Files gets a "‹ parent" first row (parent folder name), absent at a
  root and at the roots list.
- A clean launch opens Home even with saved tabs; returning from background keeps the
  screen (spec: browser-behaviors.md "Home", last paragraph).
- Native `activeTab` reports null while a Files tab is active.

Delete what this replaces (`lastFiles`, the Router constructor's place, `Entry.parent`,
`Persist.provideFiles`, Rail, HomeNav if orphaned, the old `files`/`terminal` routes) in
the same commit; no fallbacks. Update unit tests and Playwright specs that pin the old
behaviour; delete ones that only pin removed layout. Add no new permanent tests (Jimmy's
standing rule); write temporary checks if you need them and delete them before the
commit, reporting what they showed.

Docs in the same commit: `docs/design/client/browser-behaviors.md` only where this
slice settles something it marks open (e.g. the Files tab's top-level label),
`docs/design/decisions.md` (2026-10-27 entries: workspace v3 discards v2 and v1 without
touching drafts, rejected: converting v2; Files tabs owned by the workspace with history
as a record, rejected: per-tab FileBrowser and Back-as-parent-only; terminal ↔ Files tab
switches add no history entry), `client-architecture.md` §6, `web/AGENTS.md` if an
owner rule changes, and a `CHANGELOG.md` `[Unreleased]` bullet (Files opens as tabs, any
number; desktop navigation moved to one top row; launch opens Home).

## Verify

- `pnpm --dir web run check` (pnpm only, never npm) and `pnpm --dir web run e2e`
  (harness, Chromium and WebKit, both layouts).
- `ios/scripts/check.sh` for commit 1 and again after commit 2.
- `scripts/preflight.sh full` passes in the checkout.
- In the harness, run the flows by hand in a browser (phone and desktop layouts): open
  two Files tabs on one host at different folders, switch between them and a terminal
  tab, drill in and use Back (it walks out of the folder in the tab it was opened in;
  after a tab switch, Back from a stale entry lands on Home), reload (both Files tabs
  and their folders come back, launch shows Home), close tabs (neighbour activation),
  preview insert targets the last terminal tab of that host. Say what you exercised and
  what you saw.
- MSRV is unaffected (no Rust changes expected); if you touch Rust, `cargo +1.85 check
  --locked --all-targets`.

Report: the two commit SHAs, what changed per commit, deletions, anything in D1 the code
forced you to adjust (and why), the failure modes you exercised and their results, and
anything left open.
