# tether web client

One Preact app for the desktop browser, the phone browser or installed PWA, and the native
iPhone app's web view. The design is
[client-architecture.md](../.meridian/work/tether-mvp/design/client-architecture.md); behaviour
comes from the [interaction contract](../docs/design/client/browser-behaviors.md) and the
[mockup](../docs/design/client/mockups/index.html). [AGENTS.md](AGENTS.md) has what a lane
needs to know before editing.

```bash
pnpm --dir web install --frozen-lockfile
pnpm --dir web run check     # typecheck, lint, source checks, unit tests, build, budgets
pnpm --dir web run e2e:real  # end-to-end scripts against a real daemon and tmux (below)
pnpm --dir web run e2e:stack # that isolated stack alone, to drive by hand (below)
```

## The harness

`/harness/index.html?fixture=<name>&layout=phone|desktop&scheme=dark|light&density=touch|compact#/route`
runs the real app on the in-memory `test` platform, with a fake daemon behind `/auth/*` and the
socket. It is for looking at each screen and state; there are no UI tests on it. Every state has a
fixture in `harness/<lane>/`; `gallery` shows every primitive in every state. Start
it with `pnpm --dir web run dev -- --mode harness`. It is never in
a production build: the build fails if its module graph holds `platform/test/` or `harness/`.

## Developing against a real daemon

The browser adapter has no dev mode. `vite.dev-proxy.ts` is the only dev-only code: Vite's dev
server proxies `/ws`, `/auth`, `/fs` and `/complete` to the daemon as a local peer, presenting a
native token that never reaches page code, answers `/auth/node/session` itself and rewrites
`/auth/info.browserOrigin` to the dev server's origin. It refuses callers that did not come
through Tailscale Serve.

1. Run a daemon against a private tmux, never your own sessions:

   ```bash
   tmux -L tether-dev new-session -d -s dev
   cargo run -- --config /tmp/tether-dev/config.toml serve
   cargo run -- --config /tmp/tether-dev/config.toml device add dev   # prints the token
   ```

2. `TETHER_DEV_TOKEN=<token> TETHER_PORT=17850 pnpm --dir web run dev` (`TETHER_SOCKET=<path>`
   instead of `TETHER_PORT` once the daemon listens on `local.sock`).
3. Publish the dev server with `tailscale serve` and open that address. Enrol and the admission
   problems can't be reached this way; the harness drives them.

Phone layouts are checked in a real phone browser or the iOS Simulator: there is no fake keyboard.

## End to end against a real daemon

The `*.real.ts` scripts (`e2e/terminal/`, `e2e/home/`, `e2e/dock/`, `e2e/gesture/`) are
Playwright scripts that exercise full behaviour end to end, and are where performance recording
will live (not built yet). Each describe block runs the app against a real tether daemon and a
private tmux on its own isolated stack (`e2e/shared/stack.ts`): a
daemon started with `--allow-login e2e`, Vite's dev server with the dev proxy, and a small front
proxy that stands in for Tailscale Serve and answers `/auth/info` itself, since a daemon on this
machine has no tailscaled to ask. Nothing touches the installed service, Tailscale or your tmux
sessions; everything lives under `<tmpdir>/e2e-<port>/`.

They are opt-in, never part of preflight. They need a debug build of the daemon
(`cargo build`), tmux builds at `~/.cache/tether-tmux/3.4/bin/tmux` and
`~/.cache/tether-tmux/3.7b/bin/tmux`, and Playwright's browsers
(`pnpm --dir web exec playwright install chromium webkit`, once):

```bash
cargo build
pnpm --dir web run e2e:real                       # both tmux versions, both browsers
TETHER_E2E_TMUX=3.4 pnpm --dir web run e2e:real   # one version
TETHER_E2E_PORT=5220 TMPDIR=/tmp/some/dir pnpm --dir web run e2e:real   # keep a run's files elsewhere
```

`TETHER_E2E_KEEP=1` leaves a stack's directory (daemon, Vite and tmux logs) after the run.

To drive the app by hand on the same isolated stack, `pnpm --dir web run e2e:stack` starts one
(`TETHER_E2E_TMUX=3.7b` picks the tmux), prints its URL and runs until Ctrl-C.

## PWA checks that need a real box

The service worker runs only in the built bundle. What needs
the daemon itself and Tailscale Serve's HTTPS origin, from a second enrolled machine, is by
hand:

1. `cargo build` embeds `web/dist`. Open the Serve URL in Chromium: `/sw.js` is `no-cache`, the
   manifest `name` is "tether <host>", and DevTools > Application > Manifest shows no errors and
   three icons.
2. Install from the address-bar button; the installed window opens standalone at `/#/`.
3. Stop the daemon and launch the installed app: Home opens from cache with the host banner.
4. The precache against the daemon's real caps (4 at once, 16 queued, `503 Retry-After: 1`):
   the first visit installs every file.
5. Ship a second build in the daemon binary and tap Update in one of two windows; repeat for
   two updates in a row.
6. After a session with a terminal open, Cache Storage holds no `/auth`, `/ws` or `/fs` entry.
7. iPhone Safari and the installed app: Add to Home Screen shows the icon and "tether <host>";
   standalone launch; offline launch.

## Fonts

`assets/fonts/` holds subsets of JetBrains Mono NL Nerd Font (OFL.txt). `scripts/subset-fonts.py`
makes them (its header says how); the build needs no Python.

## Budgets

`scripts/checks.mjs build` enforces §8.4 on the gzipped output: initial JS 190 KB, initial CSS
15 KB, terminal fonts 120 KB each, symbols 150 KB, the whole shell 1.5 MiB in at most 64 files
(every emitted file counts, 44-byte stubs included). A budget is raised only with its
measurement in the commit.
