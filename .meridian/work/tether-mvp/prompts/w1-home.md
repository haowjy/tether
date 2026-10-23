# W1: Home, picker, Settings

Lane W1 of P2 (client-architecture.md §11). You own: `web/screens/home/`, `web/screens/picker/`,
`web/screens/settings/`, `web/sessions/`, `web/harness/home/`, `web/e2e/home/`.
Deliver: open tabs; the sessions list with search and expansion; creation dialogs; the picker as
dialog (desktop) and sheet (phone); listing states (loading, empty, offline, error, refused);
Settings (§4.3). Contract: §6.3 sessions listing and its screen rules, §6.4 refusals and limits,
§6.5 focus (Home search is the desktop focus target after the last tab closes: register
`homeSearch` so the navigate effect lands there), §6.6 routes. `app/listing.ts` already exposes
`subscribe` (listed, failed, renamed) and `refresh`; the controller owns the listing trigger
(`syncListing`); `sessions/` is the cache over those events.
Verifies (§11): `sessions/` unit tests (search, expansion, 24+ groups); Playwright through the
Vite dev proxy against a real tether daemon and isolated tmux servers on 3.4 and 3.7b
(`TETHER_TMUX=~/.cache/tether-tmux/3.4/bin/tmux` and `.../3.7b/bin/tmux`; if absent, the lead
is building them: wait or ask in your requests file): create, open, attachedElsewhere, pruning
after a kill under an off-screen tab, one `listSessions` per reconnect. Run that daemon fully
isolated: its own TMPDIR (runtime dir and sockets), its own --config with `tmux.socket_name`
private, its own state/auth directory; `tests/support/daemon.rs` shows how the Rust tests
isolate one; the dev proxy targets it with `TETHER_SOCKET` and `TETHER_DEV_TOKEN`.
Your `TETHER_E2E_PORT` is 5211; lane name for files: `w1`.

## Shared rules for every P2 lane

Read first: `.meridian/work/tether-mvp/design/client-architecture.md` rev 4 (the whole of §1–§3,
§6, §8, §11, §12, and the sections named for your lane), `docs/design/client/browser-behaviors.md`,
the mockup `docs/design/client/mockups/index.html` (a starting point, not a pixel spec: improve
on it, but log each deliberate departure), `docs/design/plan.md` "Code structure and standards",
and `.meridian/work/tether-mvp/w0-notes.md` "For the next lanes" (fixtures, `useApp()`,
`useAppView(select)`, overlays through the router, `attachDriver`). Jimmy's fixed choices stay:
no Files in `+`, no intermediate menu, no dot markers or separators, no custom browser keyboard
strip, local draft whose Insert sends no Enter.

Four lanes work in this one checkout at once. Write only the files your lane owns (listed
below). For a change in a W0-owned file (ui/, workspace/, app/, net/, platform/types.ts,
platform/browser/index.ts, harness/index.ts, package.json, configs), append the exact request
and why to `.meridian/work/tether-mvp/lanes/<lane>-requests.md`, keep working against a local
stand-in in your own files, and say so in your report. Keep your files compiling and lint-clean
at every save: the harness imports every lane's fixtures, so a broken file breaks others' pages.
Do not commit, stage, or push; the lead commits your work. The web client uses pnpm, never npm;
install nothing (package.json is W0's: request a dependency). Run Playwright with your lane's
`TETHER_E2E_PORT` (given below) and any Vite dev server on a port of your own.

Notes for docs the lead owns (decisions.md, browser-behaviors.md, plan.md, CHANGELOG.md): write
them to `.meridian/work/tether-mvp/lanes/<lane>-notes.md` (each departure, with alternatives
rejected).

Tests: build the tests your lane's "Verifies" column in §11 lists; no others. Verify in a real
browser, Chromium and WebKit, phone 390x844 and desktop 1440x900, light and dark, as well as by
tests, and check the anti-slop and design-craft rules for every screen. Never touch the installed
tether service, Tailscale's serve config, or real tmux sessions. Use
`TMPDIR=/tmp/tether-meridian-501/<lane>` for anything that makes sockets.

Report: what you built against each Delivers item, verification by type (with pass counts),
departures from the spec or mockup and why, open requests for W0-owned files, a suggested commit
split (one change per commit, with paths), and anything left undone.
