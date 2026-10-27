# Look at slice 4 (Home, full-height sheet, Settings) in the harness

Use the frozen export `/tmp/tether-rev-s4/` (= commit `40d8bab`), not the live checkout
(another writer edits it): `pnpm --dir /tmp/tether-rev-s4/web install --frozen-lockfile`,
then start its harness with `pnpm --dir /tmp/tether-rev-s4/web run dev -- --mode harness
--port 5241` (pnpm only). Open
`/harness/index.html?fixture=<name>&layout=phone|desktop&scheme=dark|light`. Fixtures:
`homeCards`, `homeTabs`, `homeTwoServers`, `homeNoServers`, `homeInstall`, `settings`,
`settingsApp`, `serverSheet`, `unreachable`, `offlineTabs`, `emptyServer`, `noServer`.
Load `/agent-browser` and `/probe`.

Behaviour: `/Users/jimmyyao/repos/tether/docs/design/client/browser-behaviors.md`
(Visual treatment, Home, Session picker ... Phone). Mockups (spec wins):
`/Users/jimmyyao/repos/tether/.meridian/work/tether-mvp/phone-redesign-mockups/`. Before
screenshots: `.../redesign/before/`.

Check phone 390x844 and 320 px, desktop 1280x800, dark and light: each fixture's state
reads right and is distinct (loading, offline with last reached + Retry, tmux not
running, empty, no servers, two servers, install instructions); 44 pt header with back
icon and 17 pt title, no large titles; desktop Home centred at ≤720 px; All N sessions →
full sheet (Back, search, + beside it, that server only, no strip) → Back; row tap opens
the tab and Back returns Home, never the sheet; Files ›; gear → Settings → Back; Clear
local data cancel/confirm; no horizontal scroll at 320; touch targets ≥ 44 px; no middle
dots in copy. Save viewport screenshots under
`/Users/jimmyyao/repos/tether/.meridian/work/tether-mvp/redesign/s4/` with a README (URL,
what each shows). Edit nothing else; stop the server. Report pass/fail per check with
evidence.
