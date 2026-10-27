# Client redesign: build plan

Status: reviewed (p320), slice 1 ready (2026-10-27, tech lead c312). The behaviour is settled
in `docs/design/client/browser-behaviors.md` and `terminal-interaction-design.md`; this
plan only orders the build and names the structural moves. Handoff:
`../handoff-redesign-build.md`. Before-state screenshots: `before/README.md`.

Jimmy's constraint: "this is a lot of reworking". Every slice below is one or a few
coherent commits on `main`, preflighted, pushed, and leaves all three surfaces usable.
Web changes reach the iPhone app only when Jimmy reinstalls it, so each slice that
touches the app lists what he should look at on the device.

## Structural decisions

Revised after structure review p320 (request changes; all findings accepted, report:
`meridian spawn show p320`). Rejected alternatives are noted per decision.

### D1. One tab model: terminal tabs and Files tabs (slice 1)

- **Types.** `workspace.Tab = TerminalTab | FilesTab`, both with a stable `id` and a
  `host`. `TerminalTab` is today's tab (`id = tabId(key)`, so drafts keep their keys);
  `FilesTab` is `{kind:"files", id, host, place}` with an id generated outside the pure
  reducer (passed in on the `opened` event). Every terminal consumer (dock, paste,
  terminals, WindowsMenu, lineDrafts, nativeLine, ...) is typed on `TerminalTab`,
  narrowed once where it reads the workspace. `hostsKnown` prunes both kinds;
  `listing`, `serverExited`, `sessionClosed` narrow to terminal tabs.
- **One owner for a Files tab's place: the workspace.** Only `navigated` writes it, as
  only `navigated` writes the route flag today. History entries carry `{tab, place}` as
  a record so Back returns to an earlier folder without a new request (spec,
  browser-behaviors.md "Browsing by tap"); they do not own it. Before pushing a
  drill-in the router stamps the current entry with `{tab, from}` (replaceState), then
  pushes `{tab, to}`. A pop landing on an entry whose tab is gone or not active goes
  back to Home's entry in one `go(-n)` computed from the in-memory stack, announcing
  nothing for the stale entry; an entry from before a reload is replaced with the tab
  entry. `FileBrowser` stays one per host and shows the active Files tab's place; it
  reports the daemon's canonical path back to the workspace. Scroll positions key by
  tab and path. Deleted: the router's `lastFiles`, the constructor's place, `Entry.parent`,
  `Persist.provideFiles`. Rejected: per-tab `FileBrowser` instances (a lifecycle that
  tracks tab open/close for no gain: the per-host 32-folder cache already restores
  listings); Back as the in-app parent only (misses the spec's history rule).
- **One derived screen.** Routes become `home | tab`. The controller derives
  `screen: home | terminal | files` from the route and the workspace; Shell, focus
  (`screenChanged` fires on a `screen` change, not a route change), `shownTab` and
  `syncListing` read it. `onTerminal` becomes `onTab`. Switching between a terminal and
  a Files tab adds no history entry (log in decisions.md: the spec states it for
  terminal tabs only).
- **Insert target.** `WorkspaceState.lastTerminal` per host, updated on activation,
  cleared when that tab closes; preview insert and uploads target it, not `active`.
- **Saved workspace v3** saves tabs in order (terminal as today; files with id, host,
  place) and `active` by id. One web parser takes `unknown` (the trust boundary: an
  older build wrote it) and returns v3 or null; version handling leaves the adapters.
  v2 and v1 are discarded whole; drafts are not touched (they are keyed by `TabKey` and
  return when the session is reopened). Rejected: converting v2 (a compatibility branch
  for one tab list per device, which a clean launch to Home makes cheap to rebuild).
- **Swift stores the workspace opaque.** `BridgeTypes.swift` decodes `WorkspaceTab`
  strictly and `saveWorkspace` would drop a v3 save; native reads none of its fields.
  Store the `workspace` field as raw JSON and delete `SavedWorkspace`, `WorkspaceTab`,
  `FilesPlace`, `SavedFilesPlace` from Swift. Bridge bytes unchanged (v5 stays);
  fixtures and their tests change.
- **Chrome that slice 1 must carry.** Pull D3's desktop top row (no + popover yet) into
  slice 1 and delete `Rail`; tab labels and pills handle both kinds
  (`workspace/labels.ts`, `screens/terminal/tabView.ts`), so the phone switcher's strip
  shows Files tabs without new UI; Home's Files opens a new Files tab at the host's
  roots; phone Files gets the dock's current-tab button. Clean launch opens Home
  (it depends on the router's first-entry restore, which slice 1 rewrites).
- **Native `activeTab`** stays `TabKey | null`; a Files tab reports null.

### D2. One sessions overlay (slices 2 and 4)

Grow the existing shared `HostSessionLists` (used by Switcher, Picker, Home) rather
than adding a component. Merge the `picker` and `switcher` overlays into one `sessions`
overlay whose presentation follows layout: phone sheet (half height over a tab, strip
and + at the bottom), desktop + popover (slice 2b). The phone sheet takes "the active
tab's server" instead of `hosts[0]`. Its `full(host)` mode is built with Home in slice 4,
the only place that opens it. Window choices move into the active session's row.

### D3. Desktop chrome: one top row (slice 1 row, slice 2b popover)

### D4. Dock layout states and key routing (slice 3, bridge v6)

The Dock renders resting (current-tab button + Show keyboard) or typing (compose box,
key row with Hide keyboard) from the focus owner. Key-row routing is a pure function
of `(key, owner, armed)` → terminal input | caret step | focus terminal | line insert.
A caret step calls a dock callback, like `insertIntoLine`: the browser textarea steps
by grapheme with `Intl.Segmenter`; native gets a new `lineCaretStep(-1|1)` message and
steps with UIKit's own positions (native owns the text and caret, already handles
hardware arrows, and a web-computed index would race the 33 ms repeat against the
`lineEdit` echo and break marked composition). esc and a keyboard-up terminal tap use
the existing `setFocus("terminal")`. Rejected: web-computed caret index for native.

### D5. Preferences: one owner per environment (slice 5, bridge v7)

Unchanged by review. `platform.preferences` (get/set/subscribe): appearance, terminal
text size, and an optional `relock` only the app has. Browser: localStorage, folded
with `matchMedia` into `Viewport.scheme`. Native: Swift owns them (UserDefaults),
applies `overrideUserInterfaceStyle` and relock before the web loads, and keeps
reporting the effective scheme in `Viewport.scheme`. Bridge v7: preferences in boot,
`setPreference`, fixtures. Dark terminal true black, neutral greys. Rejected: web owns
and pushes to native (two stores that disagree at boot).

### D6. Bell (slice 7, after Jimmy's tmux restart)

As specified in plan.md "Bell attention". Before building, slice 7's daemon-core.md
pass weighs p320's hypothesis: polling `#{window_bell_flag}`/`#{session_alerts}`
instead of a hook (no tmux modification, but misses a bell in another client's current
window, which the hook catches). Probes on `tmux -L` sockets only until Jimmy's restart.

## Slices

| # | Slice | Surfaces | Commits | Device check for Jimmy |
|---|---|---|---|---|
| 1a | Swift stores the workspace opaque; one web parser for the saved workspace | iOS + web | 1, behaviour-preserving | none |
| 1b | Tab union, Files tabs, workspace v3, routes `home \| tab`, derived screen, insert target, desktop top row (Rail deleted), clean launch opens Home | web | 1 | two Files tabs, reload, both remember; launch opens Home |
| 2 | Phone current-tab bar + keyboard; one `sessions` overlay as the half-height sheet with strip and +; row tap keeps the sheet; windows under the active row | web | 1-2 | bar, sheet, tap keeps sheet |
| 2b | Desktop + popover from the same overlay | web | 1 | – |
| 3 | Keyboard-up layout; key routing; `lineCaretStep` | web + iOS, bridge v6 | 1-2 | one cursor; ← → in box; esc and tap back |
| 4 | Home server-first cards, full-height sheet from "All N sessions", Settings behind gear, 44 pt headers | web | 1-2 | Home cards, gear |
| 5 | Preferences: appearance, true-black dark, text size; Face ID relock | web + iOS, bridge v7 | 1-2 | appearance, relock options |
| 6 | Mermaid in Markdown previews | web | 1 | a diagram renders |
| 7 | Bell attention | daemon + web + running.md note | 2+ | dot from another session |

Order: 1a → 1b → 2 → (2b, 3, 6 in parallel where files don't overlap) → 4 → 5 → 7.
Writers stay sequential on any shared file (primary checkout, no worktrees per
AGENTS.md); 6 touches only `web/files/render/` and can run beside 2b/3.

## Open details: lead's calls (to log in decisions.md with the slice that builds them)

- Sessions as a list, not a grid. (Jimmy, 2026-10-27: "List".)
- A session-row tap opens/activates that tab behind the sheet and keeps the sheet open,
  the same as a strip tap. (Jimmy, 2026-10-27: "it should open the tab, not close the
  sheet? (be consistent with tabs?)".) Dismissal stays tap outside, swipe down, Back,
  Escape. The desktop popover still closes on selection (spec).
- Window switch: the active tab's row, when its session has more than one window,
  shows its windows beneath it ("index: name", shown marked); other rows show a window
  count. On desktop the same rows sit in the popover. Creating a window stays tmux's
  `prefix c` (no button this pass). (Jimmy, 2026-10-27: "Under the active row".)
- New session / Browse files with several servers: the active tab's server; from the
  full-height sheet, that sheet's server.
- Files insertion target: `lastTerminal` for the Files tab's host (D1), named on the
  action; none, disabled with "Open a terminal tab first".
- Mermaid: rendered fit to width, scrolls horizontally when wider; no zoom/pan this pass.
- Keyboard button on Files/preview: not shown (spec: Files show only the current-tab
  button).

## Gates per slice

Preflight (`scripts/preflight.sh full`) on a clean export, which runs
`pnpm --dir web run check` (unit tests, no UI tests); review lanes per
`/agent-staffing` reviewers; a prober looks at the result in the harness and, where the
slice changes what the daemon or tmux sees, on the isolated real stack; CHANGELOG
bullet; docs/design and `client-architecture.md` kept accurate in the same commit.
No UI tests (Jimmy, 2026-10-27). The real-daemon e2e scripts are opt-in and never run on
every slice ("it shouldn't be running all the time either"): run them only when a
change alters the terminal stream, protocol or tmux interaction, or to record
performance. Review findings get a structural fix before a guard.

## Staffing (Jimmy, 2026-10-27)

"use sonnet coders btw, deepseek explorers, grok or terra proberss / browser use /
checkers": spawn `@coder`/`@frontend-coder` with `-m sonnet`, `@explorer` with
`-m deepseek`, `@prober` and browser/check lanes with `-m terra` (or `grok`). Reviewers
keep their default (opus). Frontend: "probably sonnet is enough, maybe we need opus": Sonnet first; move a lane to Opus when review shows its work falling short.

## Progress

- Slice 1: `da1373b` (1a), `450b454` (1b) local. Review round 1: p322 correctness
  (7 findings, all accepted), p324 probe (re-listing on tab switch/Back fails the
  spotty-network rule). Lead call for p322 #3: the per-host cache holds real listings
  (first pages of 32 recent folders), not per-tab browsers. Fixes: p325. Next: dead-code
  explorer (p323 on deepseek failed, 401 invalid API key; rerun on default), then the
  thermo lane, then preflight and push.
- Round 1 fixes `a484cd1` (p325): zero requests on Files tab switches and Back. Strict
  review p330: blocking, the router entry's `tab` copied the active tab and went stale
  (Files taps lost after any tab switch). Move: the current entry always names the
  active tab; deletes the stamp and `shownFiles`. Round 2: p331 (last round on this
  concern; a third would go to root-cause and whole-system review). p330 proposes a
  permanent harness spec "switch away and back, then drill and Back": put to Jimmy.
- 443 on pop-os: see ../serve-443-coexistence.md (tether down there until
  meridian-flow#1167 merges and portless restarts; restore needs Jimmy's sudo).
- Jimmy, 2026-10-27, on the proposed spec: "we shouldn't have any ui tesets, u should
  just make the code strong enough that it shouldn't happen or we shouldn't be able to
  question it in the first place (code structure over if statements)". No new UI test;
  review findings get a structural fix (make the state unrepresentable) before a guard.
  Asked whether the existing Playwright suite should go too: pending.
