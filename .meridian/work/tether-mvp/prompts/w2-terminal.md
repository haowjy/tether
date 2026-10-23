# W2: Terminal and desktop input

Lane W2 of P2 (client-architecture.md §11). You own: `web/screens/terminal/` (except `draft/`
and `selection/`), `web/term/`, `web/tabs/`, `web/harness/terminal/`, `web/e2e/terminal/`, and
additions to `tests/fixtures/proto/keys.json`. Deliver: the tab strip, the terminal surface, sizing
from the stable box (§5.4), desktop direct input (§7.1, §7.2), paste and image paste interception
(§7.5), the status band including `limited` (the daemon sends `watchEnded { reason: "limit" }`
today). The paste acknowledgement (`paste { req }`/`pasted`) is not built: report "sent" (§10).
**For P3**, in `term/index.ts` and `tabs/keymap.ts`: `bufferText(rows)` (logical text by
`isWrapped`), `mouseMode()`, `cellAt(x, y)`, `setPanArea(px)`, and the owned-mode keymap branch
(Ctrl/Alt+printable, §7.3). Also read docs/design/client/terminal-interaction-design.md.
Hand-offs from W0 you finish: retarget `native/bridge.ts`'s `InputEvent`/`Viewport` importers
(`tabs/driver.ts`, `tabs/input.ts`, `term/size.ts` and its test) to `platform/types.ts` so one
type of each remains (W5 moves the file later); register each `TabDriver` with
`app.attachDriver(id, { cover, uncover })` (created drivers start covered unless shown); keep the
terminal mounted for the page's life: the admission screens must not unmount it (`Shell.tsx` is
W0's: request the change if needed).
Verifies (§11): keymap tests against `keys.json`. Playwright in Chromium and WebKit, against a real
daemon and isolated tmux (3.4 and 3.7b at `~/.cache/tether-tmux/<v>/bin/tmux` via TETHER_TMUX;
the lead is building them, wait or note it if absent): typing; named keys in vim and less;
Shift+Enter in `cat -v` shows `^[[13;2u` once; Japanese IME candidate selection with arrows;
paste with bracketed mode on and off, never double-bracketed; 300 KiB paste refused; the 4th session
refused with its message; reconnect after a socket kill; window drag resizes tmux once. Run that
daemon fully isolated: its own TMPDIR, --config with a private `tmux.socket_name`, its own
state/auth directory (see `tests/support/daemon.rs`); dev proxy via `TETHER_SOCKET` and
`TETHER_DEV_TOKEN`. Your `TETHER_E2E_PORT` is 5212; lane name for files: `w2`.

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
