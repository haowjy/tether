# W3: Files

Lane W3 of P2 (client-architecture.md §11). You own: `web/screens/files/`, `web/files/`,
`web/platform/browser/uploads.ts` (a W0 stub you replace), `web/harness/files/`, `web/e2e/files/`.
Deliver: folder list, preview with the kept viewers, inline video, upload, the insert-path offer
(§5.7 uploads and file pick; the daemon's /fs contract in docs/design/fs.md). Keep the existing
`files/` tests green. Verifies (§11): Playwright: browse, preview, Back through folders and preview,
upload then insert the quoted path into the captured tab, the target gone mid-upload, a fifth queued
upload refused. The test platform's fake fs (`platform/test/fs.ts`) is W0's; extend fixtures in
`harness/files/`. Your `TETHER_E2E_PORT` is 5213; lane name for files: `w3`.

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
