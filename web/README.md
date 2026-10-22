# tether web UI

Preact + xterm.js, hosted by the iOS app's web view. `npm --prefix web run check` runs
typecheck, lint, tests and the build.

## Desktop dev mode

Drives the real UI in a desktop browser against a daemon on this box. The dev server
proxies `/ws` and `/auth/*` to the daemon and adds the owner's `Tailscale-User-Login`
(dev server only, never in a build; the daemon still wants a loopback peer). A dev shim
(`dev/`, loaded only under `import.meta.env.DEV`) stands in for native: it keeps a device
token, reports a fixed 390×700 viewport, and turns keys typed in its textarea into
bridge `input` events.

1. Run a daemon. To keep clear of your own tmux, point it at a private server:

   ```toml
   # /tmp/tether-dev/config.toml
   port = 17850
   [tmux]
   socket_name = "tether-dev"
   ```

   ```bash
   tmux -L tether-dev new-session -d -s dev
   XDG_STATE_HOME=/tmp/tether-dev/state cargo run -- --config /tmp/tether-dev/config.toml serve
   XDG_STATE_HOME=/tmp/tether-dev/state cargo run -- --config /tmp/tether-dev/config.toml device add dev
   ```

   The daemon reads your login from tailscaled but changes nothing there; no `tailscale serve`.
2. Start the dev server: `TETHER_PORT=17850 npm --prefix web run dev`. It finds the login
   from `tailscale status --json`; set `TETHER_DEV_LOGIN` to override it.
3. Open `http://localhost:5173/#token=<token from device add>`. The token is kept in
   localStorage, so later loads need no hash; without one the page asks for it. A 4401
   from the daemon forgets it.
4. `+` lists the windows on the daemon's tmux; tap one to open a tab. Click the dev textarea
   and type. Tabs persist in localStorage.

Drive the page from a script with `window.__tether.receive([...])` to send the messages
native would (`lifecycle`, `network`, `viewport`, `lock`).

Clean up: stop the dev server and the daemon, `tmux -L tether-dev kill-server`, remove
`/tmp/tether-dev`.
