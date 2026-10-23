# tether web client

One Preact app for the desktop browser, the phone browser or installed PWA, and the native
iPhone app's web view. The design is
[client-architecture.md](../.meridian/work/tether-mvp/design/client-architecture.md); behaviour
comes from the [interaction contract](../docs/design/client/browser-behaviors.md) and the
[mockup](../docs/design/client/mockups/index.html). [AGENTS.md](AGENTS.md) has what a lane
needs to know before editing.

```bash
npm --prefix web ci
npm --prefix web run check     # typecheck, lint, source checks, unit tests, build, budgets
npm --prefix web run e2e       # Playwright (Chromium and WebKit) on the harness
npm --prefix web exec playwright install chromium webkit   # once
```

## The harness

`/harness/index.html?fixture=<name>&layout=phone|desktop&scheme=dark|light&density=touch|compact#/route`
runs the real app on the in-memory `test` platform, with a fake daemon behind `/auth/*` and the
socket. Fixtures live in `harness/<lane>/`; `gallery` shows every primitive in every state. Start
it with `npm --prefix web run dev -- --mode harness`. Playwright starts it itself. It is never in
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

2. `TETHER_DEV_TOKEN=<token> TETHER_PORT=17850 npm --prefix web run dev` (`TETHER_SOCKET=<path>`
   instead of `TETHER_PORT` once the daemon listens on `local.sock`).
3. Publish the dev server with `tailscale serve` and open that address. Enrol and the admission
   problems can't be reached this way; the harness drives them.

Phone layouts are checked in a real phone browser or the iOS Simulator: there is no fake keyboard.

## Fonts

`assets/fonts/` holds subsets of JetBrains Mono NL Nerd Font (OFL.txt). `scripts/subset-fonts.py`
makes them (its header says how); the build needs no Python.

## Budgets

`scripts/checks.mjs build` enforces §8.4 on the gzipped output: initial JS 190 KB, initial CSS
15 KB, terminal fonts 120 KB each, symbols 150 KB, the whole shell 1.5 MiB in at most 64 files
(every emitted file counts, 44-byte stubs included). A budget is raised only with its
measurement in the commit.
