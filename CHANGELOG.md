# Changelog

All notable changes to tether are recorded here. CI promotes `[Unreleased]` to a
version section on release.

## [Unreleased]

- Mermaid diagrams render in Markdown previews, in the app's light or dark theme. A wider
  diagram scrolls inside its own box; one that doesn't parse stays as a code block with the
  reason under it. The diagram code downloads the first time a document has a diagram.
- On the phone, the terminal's bar is now the current tab's name, the open-tab count and
  Show keyboard; the tab strip and + moved into the sessions sheet. The button opens a
  half-height sheet over the tab with Home, search, every server's sessions, the open
  tabs and + (New session, Browse files) at the bottom. Tapping a session or a tab opens
  it behind the sheet and the sheet stays; Back, Escape or a tap outside closes it. The
  active session lists its windows under its row, with the shown one marked.
- Files opens as tabs, any number of them, each remembering its own folder or preview
  across a reload. Home's Files button opens a new one at that server's folders, and a
  folder's first row goes up to its parent. On the desktop, navigation is now one top row
  (Home, every tab, +, the server) above whichever screen shows, in place of the left
  rail. The app opens on Home even with saved tabs. Tabs saved by earlier builds are not
  restored once; their drafts are kept.
- Files and completions work in the iOS app again: the app no longer says a server
  "speaks a different version" when both use the same protocol.
- On the phone, a long-press on the terminal now highlights the word under your finger
  at once, and dragging while held extends the selection; the arrow pad is gone. ← and →
  join ↑ and ↓ in the key row, repeating while held. A tap on the cursor's row, or the
  row above or below it, opens the keyboard.
- With the keyboard up, the terminal now keeps bottom status and footer rows visible; a
  cursor near the top remains visible instead of being pushed off-screen.
- A tab whose tmux client can't start no longer sits on `Connecting...`: after one retry
  it ends with an error naming the cause, including a version mismatch when known.
- Enrolling in the browser asks for the code as eight cells, `▢▢▢▢ – ▢▢▢▢`, with the
  dash drawn rather than typed, and asks for the device name on the next screen.
- An enrolled phone can mint the app's native token without spending another code;
  removing the node revokes that token too.
- A setup link opened in Safari on the phone hands its host and code to the tether app
  before anything else happens in the browser, and the app enrols the phone: one code
  admits the app, Safari and the PWA on that phone. Add server waits for Next and Add.
- The phone now has one keyboard: the dock toggle types directly to tmux, while tapping
  the line box edits the draft through the same native responder. Predictions are off for
  the app's line; Return is Send for the line and Return for the terminal. The box grows and
  wraps to five lines before scrolling inside, while remaining one logical line.
- An armed ctrl or alt sends a chordable single-character line insert to tmux; punctuation
  and multi-character inserts stay in the line instead of becoming bare terminal input.
- A native line restored after a refused send or a remote draft change now stays intact
  as you keep typing.
- The app no longer leaves a keyboard-height gap under the dock: the native shell moves
  its web view above the keyboard, so it reports no covered page and the web stops
  rising by the keyboard a second time. Sheets and toasts sat in the same gap.
- Setup's link, QR code and terminal clipboard now include the one-time enrolment code
  in the URL fragment, so scanning or opening the link enrols a browser without typing
  the code. `tether enroll` prints the bare MagicDNS name for the iOS app and a
  code-bearing browser link.
- Tabs follow tmux sessions. Home and pickers list sessions; the window switcher selects
  or creates a window, and laptop window changes move the tab too. Typing, pasting or
  Fit takes the window at tether's size, even when the laptop is smaller. The sizing
  band shows differences in either direction.
- Update the daemon and clients together: this build requires daemon protocol 2 and
  native bridge 5. Old window-based tabs, drafts and saved workspace are discarded
  on first launch; enrolled servers and credentials remain.
- Files finds folders by typing a path: one field at the top completes the folders as you type
  (ghost text, tap a row or press `/`, Tab or → to accept, Go to open), without a request per
  keystroke. `~` outside your folders lists your home folder with rows marked "not added", and
  opening one offers "Add this folder". This replaces the "Add a folder" dialog.
- The "Update ready" and "Reload" banners now sit inside the app shell, so showing one no longer
  makes the page scroll or pushes the bottom of the screen out of view.
- `tether setup` publishes tether on your tailnet and prints its link, a QR code of it and
  an enrolment code. On Linux it runs tether in the terminal until Ctrl-C, leaving the
  Serve entry in place; `tether setup --background` installs the systemd user service, or
  the LaunchAgent on a Mac, where plain setup refuses. Every check runs before it changes
  anything, and a rerun changes only what differs.
- `tether teardown` removes an installed service and only tether's Serve handler, keeping
  enrolled devices and configuration; with no service installed it withdraws the handler.
- tether can host on a Mac with the Tailscale app (`tether serve --publish`, from a LaunchAgent).
  When it can't publish, it names the conflict (Funnel, a TCP forward, or another app's handler).
- Serve refusals on Linux name the actual conflict too.
- An iOS app: the web UI bundled in a native shell that holds each server's token behind
  Face ID (one unlock for every server, locking after five minutes away), owns the keyboard
  (hardware keys go straight to the terminal: Esc, Ctrl and Option as Meta, held arrows
  repeat), rides the dock on the keyboard, and adds photos, the camera and pasted images to
  uploads. Settings > Servers, or "Add a server" with none, opens the native server sheet.
- Touch gestures on the phone terminal. A swipe scrolls with momentum, through tmux's history
  past what the phone holds, with a "Jump to latest" button; in `less`, `vim` and other
  full-screen applications it sends ↑/↓ or mouse wheel events. A tap clicks in an application
  that asked for the mouse and otherwise does nothing (it never raises or lowers the keyboard).
  Press and hold buzzes: keep holding and drag for an arrow pad that repeats while held, or let
  go to select the word under your finger, drag its handles further, and Copy (the lines you
  copied, not the screen's wraps) or Paste from the menu. Horizontal swipes are left to the
  system back gesture. On a desktop the mouse wheel carries on past the top of what the browser
  holds into tmux's history, and "Jump to latest" shows there too.
- Phone dock and session switcher: on a touch phone Terminal ends in one row (tab chip, line
  field, keyboard toggle) with a key row (esc, arrows, ^R, ^C, tab, ctrl, alt, | ~ / -) above
  it while the keyboard is up. Return in the line field sends the line and Enter together,
  each tab keeps its own draft across tab switches and reloads, a refused line comes back
  marked "Not sent", and the tab chip opens a sheet with the open tabs, every session, the
  current session's windows with New window, search and New session.
- A window takes the size of whichever terminal acted on it last. Opening or returning to
  a tab, typing, pasting and rotating size it to the phone; typing in another terminal (the
  laptop) takes it back, and a reconnect after a network blip leaves it with the laptop
  unless the phone still held it. A window sized for another terminal, larger or smaller, is
  drawn at the phone's own font from the left edge (wider content cut off at the right, taller
  content following the cursor); after about a second the terminal's top edge says "Sized for
  another terminal" with Fit, which sizes the window to the phone.
- Home, the session picker and Settings: open tabs, a search over sessions,
  New session (with an optional start directory), every listing state
  (loading, offline, refused, no tmux server, stale with Retry), and Settings with Remove
  this device, Clear local data and Add to Home Screen steps. An offline launch says "Can't
  reach <host>" and its tabs read "Reconnecting…".
- Terminal: a tab strip and terminal surface sized from the window, desktop keyboard input
  by tmux key name (Shift+Enter, named keys, IME), paste and image paste, a status band
  with Retry, and a "session limit" state that shows the daemon's message and retries.
- Terminal paste now reports "Not sent" for refusals and "May not have been sent" when tmux
  or the connection stops before confirming it; paste is never retried automatically. A
  paste with Enter quits pane modes first so Enter reaches the program.
- Files: browse folders, preview code, Markdown, images, video and audio, upload several
  files with progress, and "Insert path into <tab>" for an upload or an open file. Adding a
  root now means editing `config.toml` on the host.
- PWA: install tether from Chromium or Safari, open Home offline from the cached shell, and
  see "Update ready" on Home; a new version waits for your tap and only that window reloads.
- Closing a tab now ends its watch on the daemon, so tabs no longer stop connecting after
  two closes; a failed watch backs off and shows the daemon's message; a resize while a tab
  is connecting is sent once it connects; a create on a slow connection waits for its reply
  instead of failing at 5 s.
- Files: Markdown is cut down to an allowlist and cannot navigate the page, a second Upload
  tap no longer uploads files twice, files over 128 MiB are refused before sending, names with
  control characters are never inserted, Insert path is disabled while the tab is
  reconnecting, and `mailto:` links open the mail app.
- PWA: a missing cached file falls back to the network, Update works after a hard reload, and
  the page is not cached with a CSP that omits the socket's origin.
- Files: opened first (at `#/files` before the host's name is known), its messages name the host
  ("Can't reach pop-os") instead of staying "the server" for the page's life.
- Image paste and Files' Insert path follow one rule: a tab still connecting takes the path and
  types it once it is watching (image paste used to refuse it), and a reconnecting, limited or
  closed tab refuses it with one notice.
- A host at its connection cap (the daemon's close code 4005) shows "Too many connections to
  pop-os" with Retry on the host banner, as the spec says; tabs used to read only "Reconnecting".
- Terminal: Ctrl+Shift+F leaves a focused terminal for the tab strip, so a keyboard user can
  reach the rail-less controls; Enter on a tab returns. Settings lists it under Keyboard.
- Terminal keyboard shortcuts match their physical letters, so Ctrl+Shift+C/F work on non-Latin layouts.
- Terminal: the selected tab's watch pauses while a native screen covers Terminal and resumes
  with a fresh snapshot when Terminal returns.
- Settings: a finished Remove this device or Clear local data closes Settings in Safari too.
- The session-limit message says "1 tmux session" when the limit is one.
- Show refused auth row names in device listing, list nodes by stored ID, and send
  the native welcome and manifest without waiting for a tailnet refresh.
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
