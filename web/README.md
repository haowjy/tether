# tether web UI

Preact + xterm.js, hosted by the iOS app's web view. `npm --prefix web run check` runs
typecheck, lint, tests and the build.

## Desktop dev mode

Drives the real UI in a desktop browser against a daemon on this box. The dev server
proxies `/ws`, `/auth/*` and `/fs/*` to the daemon and adds the owner's
`Tailscale-User-Login` (dev server only, never in a build; the daemon still wants a
loopback peer). On `/fs/*` it also adds `Authorization: Bearer` with the dev token, as
native's scheme handler does in the app: the shim keeps the token in a `tether_dev_token`
cookie scoped to `/fs`, which the proxy turns into the header and strips.

A dev shim (`dev/`, loaded only under `import.meta.env.DEV`) stands in for native: it
keeps a device token, gives its one host the page's own origin as `baseURL`, reports a
fixed viewport, turns keys typed in its textarea into bridge `input` events, answers
`prompt` with `window.prompt`, and saves the tabs and the one on screen in localStorage.
When `[⌨]` asks for focus it does what native does: shortens the page's web view by the
keyboard's height, draws a grey block where the keyboard and accessory would be, and
sends a `keyboard` viewport, so the terminal pans without resizing tmux. Clicking the grey
block hides it again, as the key row's hide key does. The file manager's native calls
have stand-ins too: `pickMedia` opens a file chooser and posts the file to `/fs/upload`,
reporting it in `upload` messages (so the path is typed into the tab); `playVideo` and
`openURL` open a browser tab. The viewport defaults to
an iPhone in portrait (393×852, safe area 59/0/34/0, keyboard 424); set it from the query
string, e.g. landscape: `?w=852&h=393&safe=0,59,21,59&kb=244` (safe area is top, right,
bottom, left; `kb` is the keyboard plus accessory height).

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
   and type. Tabs, and which one is on screen, persist in localStorage. `prefers-color-scheme` picks dark or light.
5. Files: Home's Files row, or `[⊞]` while the keyboard shows. Add a root under Folders
   (the gear); `roots` in the config above works too.

Drive the page from a script with `window.__tether.receive([...])` to send the messages
native would (`lifecycle`, `network`, `viewport`, `lock`).

Clean up: stop the dev server and the daemon, `tmux -L tether-dev kill-server`, remove
`/tmp/tether-dev`.
