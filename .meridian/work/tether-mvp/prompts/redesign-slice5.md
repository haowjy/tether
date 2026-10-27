# Build slice 5 of the client redesign: preferences (appearance, text size) and Face ID relock

Repo `/Users/jimmyyao/repos/tether`, `main`, primary checkout (no branches/PRs; read
`AGENTS.md`, `web/AGENTS.md`, `ios/AGENTS.md`). Local commits only, **do not push**;
stage only your files. Build on HEAD.

## Commit 0 first: notes from re-check p352

Report: `/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p352/report.md`
(finding 1 is already fixed in `fddb534`). Do:
- **#2** a listing overlay refreshes only the hosts it shows (the server sheet's
  `params.host`; all hosts for the picker), and returning from an overlay to the screen
  under it is not "entering" (`app/controller.ts` `syncListing`). Every listing is a
  round trip on a spotty link.
- **#3** Clear local data also resets in-memory drafts: Persist owns clearing and
  `LineDrafts` registers a clearer with it (as `onFlush` is registered), so an open
  field's draft is cleared in the same call and never written back.
- **#4** Home owns its hosts' notices: no Home-only rule in Shell; either Shell renders no
  host banners on Home and the card's attention body carries the reason, or the card's
  body renders the banner itself. Pick the one with fewer owners.
- **#5** the card's `checking` body gets its own label.
- The leftover from #1: put `host` and `kind` on `Pill` so Home stops zipping pills
  against `workspace.tabs[i]`.

## Behaviour (settled)

- `docs/design/client/browser-behaviors.md` "Visual treatment" and "Home": Settings
  offers **System / Light / Dark** on every surface (System follows the system
  appearance); **Dark uses a true-black terminal (`#000`) and neutral greys**, no
  blue-tinted terminal surfaces; native and web appearance agree. Settings offers
  **terminal text size**. The app also offers the **Face ID relock** setting; the phone
  browser has none.
- `docs/design/auth.md` "When the app asks for Face ID": **5 min**, **1 hour**
  (default), **At launch** (unlock once per launch, no time-based background relock);
  the timed check runs first thing on foreground against the time the app entered the
  background.
- A text-size change resizes the shown window to this screen (it changes the column
  count; `plan.md` "Reading on a small screen" counts it among deliberate resizes). Pick
  a small set of sizes around today's defaults (12 px touch, 13 px compact) and say why.

## Structure (decided, plan D5 in `.meridian/work/tether-mvp/redesign/plan.md`)

- `platform.preferences` (get / set / subscribe): `appearance`, `textSize`, and an
  optional `relock` that only the native platform has (absent in the browser, matching
  the interface's pattern for capabilities only some environments have).
- Browser: `localStorage` (wrapped: it can throw or be empty; a failure falls back to
  defaults and the control still works for the session), folded with `matchMedia` into
  the existing `Viewport.scheme`, so the theme keeps one input.
- Native: Swift owns the preferences (UserDefaults), applies appearance with
  `overrideUserInterfaceStyle` to native chrome (lock screen, sheets, keyboard
  appearance) before the web loads, applies relock in the existing lock logic, and keeps
  reporting the effective scheme in `Viewport.scheme`. Bridge **v7**: `preferences` in
  `Boot`, a web → native `setPreference`, native → web change events if native can change
  them on its own; `bridge.ts`, Swift DTOs and fixtures in one commit; `ios-shell.md`
  message table and version.
- Rejected (log in decisions.md): the web owns the preferences and pushes them to native
  (two stores disagree at boot, and native must apply appearance and relock before or
  without the web).
- Settings sections use the `Section` component slice 4 added.

Read: `web/ui/theme.ts`, `web/ui/tokens/semantic.css`, `web/platform/browser/viewport.ts`,
`web/platform/types.ts`, `web/platform/native/bridge.ts`, `web/screens/settings/`,
`web/term/` (font size, cell measure), `ios/Tether/` (AppModel, auth/lock, WebShell),
`ios/TetherKit/Sources/TetherKit/BridgeTypes.swift`.

No UI tests; code structure over if statements; update unit tests that pin replaced
logic. Delete what's replaced. Docs and decisions in the same commit; CHANGELOG bullets.

## Verify

`pnpm --dir web run check`, `ios/scripts/check.sh`, `scripts/preflight.sh full`. Harness,
phone and desktop: System/Light/Dark switch the whole app and the terminal (true black
in dark, no blue tint), System follows an emulated `prefers-color-scheme` change; text
size changes the terminal and sends one resize; a reload keeps both; storage throwing
falls back. Real stack (`TMPDIR=/tmp`, tmux 3.4): a text-size change resizes the tmux
window once (`tmux display -p '#{window_width}'`). iOS: Simulator build; say what is
device-unverified and add device checklist rows to `ios-shell.md` (appearance across the
lock screen, keyboard and web; each relock choice across a background trip shorter and
longer than its interval; At launch never relocks on foreground). Report SHAs.
