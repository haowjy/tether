# W4: PWA

Lane W4 of P2 (client-architecture.md §11, §9). You own: `web/sw/` (including `vite-plugin.ts`, a W0
stub you replace), `web/public/`, `web/platform/browser/pwa.ts` (stub), `web/harness/pwa/`,
`web/e2e/pwa/`. Deliver: the service worker and its build plugin (entry, precache list, manifest
link and `theme-color` metas injected into index.html), `updates` and `install`, the Update
banner's state, offline Home (§9.1–§9.4). The daemon now serves the shell and a templated manifest
named "tether <host>" (`src/http/shell.rs`, commit 47b4d93 and d1d4bc8): the manifest content is the
daemon's; read shell.rs and align with it, and put any daemon change you need in your requests file
(src/ is not yours). The embedded shell is built by `build.rs` from `web/dist` with per-file and
total caps; keep the precache inside the shell budgets (`web/scripts/checks.mjs`).
Verifies (§11, §12): the multi-window update, two-updates-in-a-row and IndexedDB-schema-upgrade gates
and "no API response in Cache Storage", run against the built bundle served locally (vite preview or
the daemon's shell over its local socket through the dev proxy). The served gates through Tailscale
Serve from a second enrolled machine (install in Chromium, offline launch) need Jimmy's Linux box:
list exactly what remains for that in your report. Your `TETHER_E2E_PORT` is 5214; lane name for
files: `w4`.

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
