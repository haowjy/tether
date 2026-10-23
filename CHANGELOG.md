# Changelog

All notable changes to tether are recorded here. CI promotes `[Unreleased]` to a
version section on release.

## [Unreleased]

- Use pnpm 10.23.0 to install, build and check the web client.
- Serve the browser/PWA shell from the daemon over private Unix sockets and admit
  browsers as enrolled tailnet nodes. Native device-token auth is unchanged; `tether
  device list/remove` now includes node devices. **Breaking upgrade:** run `sudo
  tailscale serve --bg --https=443 unix:/run/user/<uid>/tether/serve.sock` to replace
  the old loopback target; until then the iOS app gets HTTP 502. The old `port` config
  key is ignored.
- Rebuild the web client's skeleton: one Platform interface with browser and test adapters,
  admission read from the daemon at every launch, a design system of owned primitives with
  light and dark themes, and Playwright with axe over every route. `scripts/preflight.sh full
  --commit <sha>` now gates a clean export of exactly that commit, and the pre-push hook uses
  it. The shell build is held to size budgets.
- Preserve trailing spaces at soft-wrap boundaries when copying scrollback.
- Keep soft-wrap boundaries in scrollback that contains hyperlinks; one link no longer
  makes a whole history chunk copy as hard line breaks.
- Avoid joining scrollback chunks captured across a tmux history change.
- Repaint soft-wrapped snapshot rows when tmux and xterm disagree on glyph width.
- Add a startup memory budget (`memory_budget_mib`, default 72 MiB) that scales tmux
  session/socket caps and completion, plus a half-core CPU cap. Re-copy
  `contrib/tether.service` to apply `MemoryMax=72M`, no `MemoryHigh`, the 10 ms CPU
  quota period and exit-78 restart prevention. Session-limit messages name the host
  and tmux sessions holding the slots; uploads to tmpfs/ramfs are refused.

- Keep Meridian work notes and knowledge base in repo-local paths for cross-machine handoffs.

- Record Tailscale-first, public-HTTPS follow-up and multi-server settings roadmap.

- Document browser deployment research and required phone PWA installation, offline drafts, and update behavior.

- Save browser/iPhone design, interactive mockups, clipboard research, and Mac handoff in `docs/design/client/`.

- A window or session created from another tmux client (a laptop terminal) shows up
  in the window list right away.
- Tapping a URL in the terminal opens it in Safari. Window lists fail fast with
  "Can't reach …" and a Try again button when the connection drops.
- A hung disk (a dead NFS server, a stuck automount) no longer stalls the device
  check behind it: the daemon's blocking threads are split into lanes (file API 4,
  completion indexes 1, directory checks 1, auth and pastes 2), so a hung mount stops
  only the file manager and path completion. A new window or session whose start
  directory can't be checked within 300 ms is refused rather than left waiting, and an
  enrolment that gets no thread within 10 s answers `503 busy`.
- Every HTTP error code is one `HttpError` type, generated into
  `web/proto/generated/messages.ts` with `ErrorBody`. An oversized `POST /auth/enroll`
  body now answers `413 too_large`, as the other routes do (it said `bad_request`).
- Suggestion strip: history, command, flag and path suggestions above the
  keyboard at a shell prompt (needs the shell snippet).
- File manager: browse project folders and uploads from the tab's folder; view
  code, Markdown, images and file details; manage folders in Settings.
- Completion for the suggestion strip (`POST /complete`): chips from shell history
  (bash, zsh or fish, ranked by recency and frequency), commands on `PATH`, carapace
  for subcommands, flags and values, and directory listings for paths. A chip only
  extends what is typed and never holds a control character, and a command, file or
  carapace value is escaped so the shell reads exactly that name (`~` and `=`
  included); history lines go in as written. Under systemd each
  carapace run gets its own transient scope, so its memory never counts against
  tether's; everything completion holds is freed five idle minutes after the last
  request. `[complete]` in `config.toml` sets the history file, the interactive
  shell's `PATH` and the carapace binary. The unit now pins glibc's mmap threshold
  so freed memory returns to the kernel.
- Uploads flush every 2 MiB instead of 8 MiB, so far less dirty page cache sits in
  tether's memory limit during an upload.
- The fs and completion request and response types are generated into
  `web/proto/generated/messages.ts`.
- The file API (`/fs/*`): project roots and an uploads folder set from the app and
  saved in `config.toml` (comments and unknown keys kept, a symlinked file written
  at its target, a symlink to nothing refused and left alone), directory listings and a
  `$HOME` folder picker, file bytes with Range for the viewers and the native video
  player, and photo uploads. Every path is checked against the roots on the descriptor
  actually opened, so `..`, symlinks out of a root and FIFOs are refused. A new window
  or session's start directory must be an existing absolute directory. Every accepted
  socket uses 64 KiB kernel buffers, and shutdown no longer waits on a stalled
  response.
- The app restores the last tab on screen and keeps the cursor row visible when
  the keyboard opens, without resizing tmux.
- Visual web UI: tab bar with connection states, session sheets, new window and
  session, jump to bottom, dark and light themes, bundled Nerd Font.
- Added `tmux::Session`, the pure tmux control client: startup and client size,
  reply matching with the in-flight cap, pausing panes nobody watches, snapshots that
  are retried when a tmux hook tears or changes the pane mid-list, gaps, layouts, cwd
  subscriptions, and typed commands for locate, votes, history, input and paste (a
  failed paste leaves nothing in tmux's buffers). Tested against recorded tmux 3.4
  streams.
- Added the snapshot restore-byte composer (`tmux::snapshot::compose`): bytes that
  rebuild a pane's screen (primary and alternate), cursor, modes, scroll region and
  tab stops in a freshly reset terminal, so clients carry no restore logic.
  `Event::Snapshot` now carries the pane size and these bytes. Checked against
  `vt100` and tmux's own capture on recorded styled, scroll-region and
  alternate-screen panes.
- Added the tmux bridge's I/O: the control-client pump (`tmux::pump`), which moves
  bytes between a `tmux -C` process and the hub and closes it on request, and one-shot
  commands (`tmux::oneshot`) for the session listing, Locate, and new windows and
  sessions, with a 2 s timeout and a "no server" answer. Every invocation passes `-N`
  (never starts a server) and `-u` (names and paths stay UTF-8 whatever the locale).
  Tested against a real tmux with `TETHER_TMUX_TESTS=1`.
- Added the wire protocol (`proto`): the JSON messages, binary frames, version range
  and close codes, with the web's TypeScript types generated into
  `web/proto/generated/` and checked for staleness by `cargo test`.
- Added the hub: the daemon's core that turns the phone's watches into tmux work. It
  finds each watched window's session and attaches one control client per session,
  follows windows that move between sessions, catches a tab up by snapshot on open,
  resize, pane change or overflow, and reports closed windows, sessions and servers.
  A detached control client ends its tabs; a crashed one is restarted once. Every byte
  to a connection is bounded by its credit, so a slow phone starves only its own tab,
  which catches up by snapshot.
- The control-client pump reads tmux's output in batches: a pane flooding short lines
  costs the daemon about 2% of a core instead of 47%. Typing echo is unchanged when
  idle, and up to about 3 ms later while a pane floods.
- A history request whose rows exceed tmux's 1 MiB reply cap is retried by the hub
  with half the rows, down to one row, so the client gets a shorter `historyChunk`
  instead of an error and asks again from where it ends.
- tether runs as a daemon: `tether serve` listens on `127.0.0.1` (port 7850 by
  default, from `~/.config/tether/config.toml`) for `tailscale serve` to publish, and
  serves the WebSocket the web UI drives tmux through. It refuses to start if Funnel
  exposes its port, accepts only your Tailscale login, and requires an enrolled
  device's token on everything but enrolment. Idle with no phone connected it uses
  about 4 MB and no CPU. `docs/running.md` covers setup; `contrib/tether.service` is
  the systemd user unit. Stopping it lets each tmux control client exit on its own
  rather than killing it.
- Added phone enrolment: `tether enroll` prints a one-time code (10 minutes, 5 wrong
  tries) for the app's Add host, and `tether device list|add|remove` manages enrolled
  devices. A removed device's open sockets close within 10 s. The daemon keeps only
  hashes, in `~/.local/state/tether/`. If `auth.toml` can't be read or parsed (a hand
  edit gone wrong), every token check fails until it is fixed, but as "auth
  unavailable" (close 4503, HTTP 503), which the app retries with the token it has,
  not as a revoked token.
- Tabs for windows closed or moved outside tether now update promptly even when they
  aren't on screen: the daemon sends `sessionsChanged` when tmux closes a window no
  tab is watching (once per burst, so killing a session sends one), and the web
  re-lists.
- History requests report tmux's true clamped line numbers, stop cleanly above retained
  history, and detect a changed history range around the capture.
- Preserve soft wraps across snapshots and scrollback for copy: snapshot restore rebuilds
  xterm's wrap state in the daemon, and history chunks carry a packed wrap map that the
  client uses to join wrapped rows.

## [0.0.1] - 2026-10-22

- Minimum supported Rust version is 1.85 (edition 2024).
- Project scaffold: `tether --version`, CI, and label-driven releases that publish
  static Linux (x86_64, aarch64) and macOS arm64 binaries to GitHub Releases.
