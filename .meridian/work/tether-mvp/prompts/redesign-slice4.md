# Build slice 4 of the client redesign: Home server cards, full-height sheet, Settings

Repo `/Users/jimmyyao/repos/tether`, `main`, primary checkout (no branches/PRs; read
`AGENTS.md`, `web/AGENTS.md`). Local commits only, **do not push**; stage only your files
(`git add <paths>`). Another writer may be fixing the dock (`web/screens/terminal/dock/`,
`web/touch/`, `web/app/focus.ts`, `web/platform/native/`, `ios/`): stay out of those.
Load `/ui-implementation` and `/react-architecture`.

## Commit 1: enabling refactors from strict review p342

Report: `/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p342/report.md` (read
in full). Do findings 1, 3, 4, 5, 6, 7 (2 is done in `229bbe4`):
- **#1** mount `Picker` in `Shell` beside `Sessions`, so every overlay name always has a
  renderer; the anchor comes from the focus registry's `plus` target; no anchor → centred.
- **#3** one anchored menu primitive in `ui/primitives/` (or `Dialog`'s popover with a
  placement side) for the sheet's + menu, which slice 4's full-height sheet reuses; real
  menu semantics (focus moves in, arrows, focus returns) or plain buttons, not a
  `role="menu"` without them.
- **#4** `HostSessionLists` passes one `rowOf(session) => { state: "here"|"open"|null }`
  (slice 7 adds `bell`); `NewActions(host)` becomes the one renderer of New session /
  Browse files, dropping `SessionList`'s `creation`.
- **#5, #6, #7** as written (discriminated `Dialog` variant type, re-place on resize,
  tokens instead of raw `28rem`/`62svh`, stale comments and `plan.md:762-770`).

## Commit 2: Home, the full-height sheet, Settings

Behaviour: `docs/design/client/browser-behaviors.md` "Home", "Visual treatment" (44 pt
header row with back icon and 17 pt title, no large titles; Home centred column
`min(720px, 100% - 2 gutters)` on desktop), "Session picker ... Phone" (full-height sheet
from Home: Back instead of Home, no tab strip, + beside its search, that server only).
Mockups: `.meridian/work/tether-mvp/phone-redesign-mockups/` (spec wins). Round notes:
`.meridian/work/tether-mvp/phone-redesign-brief.md` rounds 2-4.

- **Home is server-first.** One card per server: name and status (live, or offline with
  when last reached + Retry); rows for that server's open terminal and Files tabs (tap
  returns to the tab); "All N sessions ›" opens the full-height sheet for that server
  (a third overlay name, e.g. `{screen:"sessions", name:"server", params:{host}}`; per
  p342, keep it "close, then act" like the picker so the router repair isn't needed for a
  Home base); "Files ›" opens a new Files tab at its roots. One and several servers use
  the same card; a single server does not auto-navigate. States: no servers (enrolment
  instructions + Add server), live server with no sessions (New session), tmux not
  running (say so, no action that starts it), offline. Phone Safari Home offers the Add
  to Home Screen instructions. Restored tabs read "Checking…" / "Reconnecting…".
- **Settings behind a gear** in Home's header: its own screen (a route or overlay: pick
  what the router models more simply and say why), Back to Home, sections: appearance
  and terminal text size (placeholders wired in slice 5: show the controls only if
  cheap to stub honestly, else leave the section out and say so), this device/browser,
  local data (Clear local data, confirmed), server management (Add / remove /
  re-enrol), the keyboard help that exists today. Remove this device only where the host
  admits this device as a tailnet node. Move today's Settings overlay content; delete
  the Settings row on Home.
- **Multi-server in the browser**: the browser/PWA is bound to its page origin
  (`browser-behaviors.md` "Product boundaries"; `connection-roadmap.md`): the card
  structure must take several servers (the app has a host registry), but the browser
  shows its one origin and no Add server until the origin/auth design exists. Don't
  relax the browser boundary.

No UI tests (Jimmy: "code structure over if statements"). Update unit tests that pin
replaced logic; add none. Harness fixtures for every Home state, both layouts (for
looking at). Delete what's replaced. Docs in the same commit (`browser-behaviors.md`
open items it settles, `decisions.md`, `client-architecture.md`, CHANGELOG bullet).

## Verify

`pnpm --dir web run check`, `scripts/preflight.sh full`. In the harness, phone 390x844,
320 px, and desktop 1280x800, dark and light: every Home state; All N sessions → full
sheet → Back; tap a row in the full sheet (opens the tab, Back returns Home, never
reopens the sheet); Files ›; gear → Settings → Back; Clear local data confirm/cancel.
Report SHAs and what you exercised and saw.
