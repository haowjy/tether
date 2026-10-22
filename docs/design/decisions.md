# Decision log

Every design decision behind tether's specs: what was decided, why, the alternatives
rejected, when, and who decided. The specs ([plan.md](plan.md),
[daemon-core.md](daemon-core.md), [ios-shell.md](ios-shell.md), [auth.md](auth.md))
state only the current rule; this log keeps the reasoning and the history.

**Who decides.** *Jimmy* owns product calls, and his decisions are marked as his.
*Tech lead* decisions settle reviews. *Design* decisions were made by the spec's
author while writing it; the spawn that wrote each spec is named for traceability
(daemon core p7, iOS shell and auth p8 and p15, review round 2 revision p21; the
`tmux::Session` build p25, the restore-byte composer p30, the pump and one-shot
runner p33, and the hub and wire protocol p35, whose builds corrected the daemon-core
spec; the HTTP layer, auth, CLI and config build p40, commit b1dcb8c; the web host
layer p42, commit a43014f). Reviews:
round 1 of the plan is [plan-review.md](plan-review.md); round 1 of the subsystem specs
was p10–p14; round 2 was p16 (structure) and p17 (correctness).

A later entry that changes an earlier one says so; the earlier one keeps its text.

## Jimmy's decisions

All 2026-10-21, decided by Jimmy.

### Device: iPhone 17 Pro only

- **What:** one target device, iOS 26. The layout stays responsive for rotation and a
  future iPad.
- **Rejected:** none recorded.

### tmux setup

- **What:** tmux 3.4 on the server and 3.7b on the Mac, `window-size latest`, default
  prefix `C-b`, the laptop sometimes attached at once. Jimmy adds the recommended
  tmux.conf lines ([plan.md](plan.md#sending-keys-and-tmuxconf)).
- **Corrected by the plan review:** tether resizes a window only when a tab opens and
  on rotation or font change, never when the keyboard opens or closes (a SIGWINCH per
  keyboard toggle reflows the app and the laptop). `allow-passthrough on` is not
  recommended: OSC 133, 7 and 52 reach control mode with it off
  ([probe-tmux.md §1](research/probe-tmux.md)).

### Tabs: one per tmux window

- **What:** 1 tab = 1 tmux window, showing its active pane full screen. Tabs never
  close on network loss.
- **Why:** Jimmy doesn't split panes.

### Shell integration

- **What:** shell-agnostic, with one OSC 133 snippet in his dotfiles and carapace for
  flag completion.
- **Rejected:** fish's `complete -C` and zsh capture via zpty: shell-specific and
  heavier.

### Files: view and upload now, three write operations in v2

- **What:** project roots picked in the app; one uploads folder; HEIC converted on the
  phone; no video thumbnails; no file watcher. Write operations are edit, new file and
  rename, in v2.
- **Rejected:** the plan review's rename/move/mkdir/delete-to-trash set. Move, mkdir and
  delete are done in the terminal.

### Auth: a device token behind Face ID

- **What:** the Tailscale login check, a Face ID lock on the phone, and a random
  per-device token enrolled once with a code printed on the server
  ([auth.md](auth.md)). This replaced Jimmy's first choice, a Face ID passkey.
- **Why:** a native app can use a passkey only for a relying party in its associated
  domains, which iOS verifies through Apple's CDN, and the CDN can't reach a
  tailnet-only host ([ios-native.md §1](research/ios-native.md)).
- **Rejected:**
  - A Secure Enclave key per phone with signed challenges and short session tokens:
    over a `ThisDeviceOnly` token behind Face ID it adds only protection against the
    token being copied off the phone, which isn't worth a challenge protocol, a
    signature format in two languages and a session-token scheme for one user.
  - Tailscale plus Face ID with no token: any device on the tailnet would get a shell
    without proving anything.
  - Passkeys (above).

### Scratch shell: kept

- **What:** a shell outside Jimmy's tmux sessions, from the "+" sheet. A native
  fallback via TestFlight or Xcode is acceptable.
- **Changed 2026-10-21 (Jimmy, review round 2):** the scratch shell is a tmux session on
  a private server (`tmux -L tether-scratch`), started with `systemd-run --user
  --scope` so it lives outside tether's cgroup, and reusing the one stream path. It
  lands after the core MVP.
- **Rejected:** a raw pty per scratch shell (portable-pty): a pty has no snapshot, so
  "stays alive across reconnects" had no repaint path without a server-side emulator,
  and its tab couldn't be addressed by the protocol. Dropping it from the MVP.

### Scope: no agent status or notifications

- **What:** tmux tabs, a session list, cheap reconnect, a Termius-grade keyboard with
  tool completion, a file manager.
- **Why:** Jimmy's agent harness already handles notifications.
- **Rejected:** agent dashboards and agent-wrapping apps (studied in
  [research/prior-art.md](research/prior-art.md)).

### Keyboard: native Swift shell first

- **What:** a native iOS app, a WKWebView hosting the web UI with a native first
  responder owning the keyboard ([ios-shell.md](ios-shell.md)). Xcode installs until a
  paid account brings TestFlight.
- **Why:** iOS shows the keyboard only from a user gesture in a web page, and the
  system accessory's Done button closes it and can't be hidden
  ([ios-web.md §1](research/ios-web.md)).
- **Rejected:** the installable web app with the system keyboard (iOS can't hold it
  open); a keyboard drawn in HTML (no haptics, worse prose typing); a thin WKWebView
  wrapper without a native input view (shares Safari's keyboard behaviour).

### Multi-host: the app connects to each host directly

- **What:** the app keeps a host list and a token per host; each host runs its own
  single-host daemon; tabs from several hosts share one UI. One host in the MVP.
- **Why:** for a native app, a hub daemon would add a single point of failure on a box
  that already crashes, an extra hop, and daemon-to-daemon auth.
- **Rejected:** a hub daemon proxying the other hosts (the answer only while the
  client was a web app, where each `*.ts.net` origin needed its own install, cookies
  and passkey); one app per host.

## Product and architecture

### Rust for the daemon

- **Decided:** 2026-10-21, design (first plan).
- **Why:** idle memory of a few MB with no garbage collector, predictable under bursts,
  bounded channels for explicit backpressure, one static binary
  ([research/rust-vs-go.md](research/rust-vs-go.md)).
- **Rejected:** Go: faster to write, but more idle memory and GC behaviour under load
  on an overloaded box.

### No server-side terminal emulator

- **Decided:** 2026-10-21, design (first plan).
- **What:** tmux holds each pane's screen; xterm.js on the phone is the only emulator.
- **Rejected:** a `vt100` or `alacritty_terminal` model per viewed pane: a second
  emulator that can disagree with tmux and xterm.js, memory per pane, and it still
  needs the same snapshot boundary. It comes back only if a feature needs screen
  contents on the server.

### WebSocket transport

- **Decided:** 2026-10-21, design (first plan).
- **Rejected:** WebTransport/QUIC (uneven WebKit support, a QUIC server, and no help
  while the app is suspended; later, behind feature detection); mosh-style UDP (raw
  UDP isn't available to the web UI, and libmosh is GPL; its "sync state, not bytes"
  idea is what snapshots borrow).

### The web UI is bundled in the app

- **Decided:** 2026-10-21, design (iOS shell).
- **Why:** one UI talks to several daemons, checked per host by the handshake; instant
  offline launch; no web assets in the daemon.
- **Rejected:** loading the UI from each daemon: which host serves the UI that shows
  every host's tabs, each origin needs its own storage and auth, and a cached copy is
  of unknown age. A Debug-only dev-server switch keeps web iteration fast.

### The WebSocket lives in the web UI

- **Decided:** 2026-10-21, design (iOS shell).
- **Why:** output reaches xterm.js without crossing the bridge; keystroke to echo
  crosses the bridge once either way.
- **Fallback, not rejected:** a native `URLSessionWebSocketTask` behind the same
  interface, if spike 3 finds WKWebView's socket unreliable after resume.

### Snapshot is the only catch-up

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #1).
- **What:** every watch, reconnect, resize and overflow repaints from a snapshot.
  Frames carry no generation or sequence number.
- **Why:** resume replay was a second catch-up path beside snapshots, and the only
  reason for generations, sequence numbers, rings, `daemon.instance`, stream linger,
  the replay cap and the outbox's sequence filter. Two review rounds landed on
  in-flight snapshots versus generation breaks; one fewer state dimension removes that
  class. Resume saved only one capture list; the network round trip is the same.
- **Rejected:** replay from a 256 KiB ring per stream with `(gen, seq)` positions;
  frame counters; a generation per snapshot. Adding an optional `resume` later needs no
  protocol bump.
- **Cost:** a reset and repaint on every tab switch (spike 3 checks for a flash), and
  xterm.js's local scrollback is cleared on each snapshot.

### Completion is HTTP, and cwd comes from tmux

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #3, p17 #6).
- **What:** `POST /complete {line, cursor, cwd}` in `src/complete/`, never through the
  hub. cwd comes from a tmux format subscription on `#{pane_current_path}` for the
  watched window, sent in `watching`. The "⧉ 2 panes" badge and `selectPane` are
  dropped: Jimmy doesn't split, and the tab follows the active pane.
- **Why:** one mechanism that works without the shell snippet and inside TUIs; the hub
  never runs carapace or the PATH index.
- **Rejected:** OSC 7 from the snippet (no cwd without the snippet, none inside TUIs);
  a `PaneFacts` query through the hub (no wire path, and completion would make the
  hub run carapace); a pane-listing exchange for the badge.

### The daemon is single-host on the wire

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #5).
- **What:** daemon routes are `/ws`, `/fs/*`, `/auth/*`, `/complete`; no message
  carries `host`. `welcome.host.id` and `/auth/info.hostId` bind tokens to hosts.
- **Why:** one socket per host already routes by host; every `host` field was a
  `badRequest` path that only a bug could hit; the proxy that justified it was
  rejected.
- **Rejected:** a host id in every URL and message.

### One protocol version on the client, a range on the daemon

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #14).
- **Why:** client-side ranges make the web UI carry old message shapes; only the
  daemon needs to accept several.
- **Rejected:** ranges on both sides with the highest common version; a single
  version with a reload on mismatch (the UI is bundled, so a reload fetches nothing
  new).

### ts-rs for TypeScript, hand-written Swift

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #10). Changes the design's
  earlier choice of typeshare.
- **Why:** Swift needs only the three `/auth/*` bodies, and the larger bridge is
  already hand-written twice against shared fixtures.
- **Rejected:** typeshare (a Swift generator and a preflight check for three types);
  specta (a runtime type model plain DTOs don't need); JSON Schema plus quicktype (two
  tools and a schema artifact for one producer).
- **Changed 2026-10-22 (p35):** how and where ts-rs output is rendered; see "One
  generated TypeScript file, rendered by a test" below.

## Daemon core

### Snapshot boundary: one atomic command list

- **Decided:** 2026-10-21, design (daemon core), from probes p3 and p5.
- **What:** `continue`, state, captures in one list; the snapshot is emitted at its
  replies' position in the stream; torn lists are retried.
- **Rejected:** pause → capture → marker → continue (pausing discards output; p3
  measured a gap); a private marker command (the list is already atomic); a
  server-side `vt100` (a second emulator, still needing the boundary).

### Torn: the snapshot's own pane, or a changed size

- **Decided:** 2026-10-22, design (p25, from tmux 3.4 probes; the size check by the
  `src/tmux/` lane). Changes the torn rule of "Snapshot boundary: one atomic command
  list" above, which counted any `%output` or flag-0 block in the list.
- **What:** a snapshot group is torn when `%output` for its own pane arrives between its
  first and last reply, or when the full `<STATE>` re-read by the list's last command
  isn't byte-identical to the first state reply (about 150 bytes per snapshot).
  Rejected: re-reading only the size, which accepts a hook's `send-keys -R` (screen
  cleared, cursor moved, keypad off, size unchanged). It is re-sent, 3 attempts in all.
- **Why:** a hook that doesn't wait (`after-display-message 'display-message -p
  HOOKED'`) puts a flag-0 block between the replies but lets no output in, so the old
  rule would have failed every snapshot for anyone with such a hook. A waiting hook
  (`run-shell 'sleep 0.3'`) shows pane output arriving outside any block between the
  state and the capture replies, which the new rule catches.
- **Rejected:** any flag-0 block or any `%output` in the list as torn (the old rule,
  above); output for other panes cannot be in this pane's capture.

### A Release invalidates snapshot attempts

- **Decided:** 2026-10-22, design (the `src/tmux/` lane).
- **What:** `Release` for a pane abandons its outstanding snapshot attempts: none is
  re-sent, and a reply that still arrives produces no `Snapshot`.
- **Why:** every snapshot list starts with `continue`; a retry after the pane was
  released would resume a pane the session just unwanted and paused.

### The daemon composes restore bytes

- **Decided:** 2026-10-21, design (daemon core).
- **Rejected:** structured state each client applies: the web and Swift clients would
  both carry restore logic, and only the daemon can test it against tmux with a `vt100`
  oracle.

### `Session` composes them: `Event::Snapshot { tag, pane, size, restore }`

- **Decided:** 2026-10-22, design (p30). Replaces the draft event shape
  `PaneSnapshot { pane, size, restore }` and p25's typed `PaneSnapshot` event.
- **What:** `Session` runs `snapshot::compose` over the five typed replies and emits the
  composed bytes with the pane's size. `PaneSnapshot` and `PaneState` stay inside
  `tmux/snapshot.rs`.
- **Why:** the hub never needs tmux's state format, so hub tests feed recorded streams
  and see only bytes; `compose` is pure, so it is tested where the recordings are.
- **Rejected:** the event carrying the typed replies and the hub calling `compose`
  (the hub would depend on tmux's state format).

### Restore bytes: what the probes settled

- **Decided:** 2026-10-22, design (p25 and p30), from tmux 3.4 recordings.
- **What:**
  - `?1003h` comes from `mouse_all_flag`.
  - Each tab stop is a CUP to its column and `ESC H`.
  - Empty rows are skipped.
  - Tab stops, region and origin mode apply to the screen in use only.
  - A cursor past the last column (tmux's pending wrap) is clamped.
  - Every position is clamped to the pane.
- **Why:** in tmux's `format.c`, `mouse_any_flag` means that some mouse mode is on (a
  fixture that sets only `?1000h ?1006h` reports `mouse_any_flag=1`), so a restore
  keyed on it would switch on any-motion tracking for every mouse application.
  `ESC H` sets a stop at the cursor's column, so a bare run of them sets one stop.
  tmux 3.4 reports `cursor_x == cols` at a pending wrap, and xterm.js clamps a cursor
  at `cols` to the last column, so restore clamps it itself and loses the wrap.
- **Rejected:** `mouse_any_flag` for `?1003`; a bare `ESC H` per stop.

### How the composer is tested

- **Decided:** 2026-10-22, design (p30).
- **What:** the recorded snapshots' restore bytes are fed to `vt100` 0.18 and compared
  with tmux's capture and state; the modes `vt100` lacks (autowrap, insert, tab
  stops) are pinned on the bytes; a continuity check restores snapshot 1, feeds the
  live output and compares with snapshot 2; and every composer change is cross-checked
  against `@xterm/headless` 6.0.0 by hand ([daemon-core.md §8](daemon-core.md#8-testing)).
- **Why:** the renderer is xterm.js, so `vt100` alone is a second emulator's opinion.
  Seventeen deliberate breaks of `compose` were all caught by these tests; the xterm.js
  run flagged a stripped `CSI 4 h` and a stripped tab-stop section, which `vt100`
  cannot see.
- **Rejected:** `vt100` as the only oracle, since it has no autowrap, insert mode or
  tab stops.

### One control client per session, fixed for life

- **Decided:** 2026-10-21, design (daemon core).
- **Rejected:** one client that switches sessions (saves 5.3 MB only during the linger
  overlap, but invalidates every stream on a switch, fires `client-session-changed`
  hooks, and makes the client `latest` in each session it visits); reusing an idle
  client by switching (same costs). Spawning takes about 2 ms.

### Pause unviewed panes on their first output

- **Decided:** 2026-10-21, design (daemon core).
- **Rejected:** client-wide `no-output` (silences the viewed pane too); `'%P:off'`
  (crashes tmux 3.4 with output queued); listing panes on every layout event to pause
  them up front (more commands, same result).

### Sans-IO cores

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #2).
- **What:** `tmux::Session::{feed, request}` and `hub::State::handle(input, now)` are
  pure; the pool folds into the hub state; the I/O tasks are pumps and effect
  executors.
- **Why:** the subtlest rules (wanted and paused panes, gaps, torn snapshots, the
  first-vote rule) sat in the I/O file, testable only against real tmux.
- **Rejected:** a pure parser and correlator beside an I/O task that holds the rules; a
  separate `pool.rs`.

### The hub owns every Session; the pump only moves bytes

- **Decided:** 2026-10-21, design (p21).
- **Why:** one pure value holds all state, so capacity, ownership and wanted panes are
  read in one place, and a hub test can feed recorded tmux bytes end to end. The
  runtime is single-threaded, so parsing on the hub task costs nothing extra.
- **Rejected:** the Session inside the control-client task, sending typed events to the
  hub: the hub would then have to mirror the session's in-flight count to know its
  capacity.

### Maintenance is desired state

- **Decided:** 2026-10-21, tech lead (review round 2, p17 #5).
- **What:** snapshots needed, releases, votes and clears (and, in this revision, cwd
  subscriptions and Locates) are derived from the hub state and reconciled when a
  control client has capacity. Only user requests get `busy`.
- **Why:** a maintenance request refused as `busy` had no one to retry it: a stream
  stayed resyncing forever, a vote never cleared.
- **Rejected:** one-shot maintenance requests sharing the user path.

### Capacity: a user threshold and capture slots

- **Decided:** 2026-10-21, design (p21).
- **What:** 32 groups in flight per control client, user requests only below 24;
  snapshots and history share 2 capture slots daemon-wide.
- **Why:** reserved headroom means user traffic can't starve maintenance, and the
  capture slots bound reply memory for the ceiling.
- **Rejected:** a separate priority queue inside the control client (a second queue
  the decision set out to remove); per-request retry timers (polling).

### Locate and a single owner per watched window

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #6, p17 #2, #3).
- **What:** `Locate {window} → (session, pane, size)`, empty meaning gone, on any live
  control client or as a one-shot. Each pane stream has one owner; other clients'
  output for it is ignored and paused. A move or link change gives a new owner and a
  snapshot. When a control client exits, its watched windows are located again before
  any watch ends.
- **Why:** the closed-window concern reached its third review round. The old existence
  check relied on `display-message` failing for a missing window, which tmux 3.4 never
  does (it succeeds with empty fields), and pane streams had no single producer: a
  linked window watched from two sessions had two, a moved window had none, and moving
  a session's last window ended its watches.
- **Rejected:** resolving inside the hinted session with `list-windows`, an `Exists`
  check, a listing fallback and a `session` hint on `watch`.

### How ownership and Locate interact

- **Decided:** 2026-10-21, design (p21).
- **What:** a window is `Locating` or `Bound`; one Locate per window is in flight, and
  a trigger during it re-runs it afterwards. The owner is the control client of the
  located session. A new owner or pane moves the watches to that stream, which breaks
  and takes a snapshot from the new owner. Only the owner's `Output`, `ActivePane`,
  `Layout` and `Cwd` count; a non-owner's copy of a linked pane is paused by its own
  session's unwanted-pane rule, and a former owner gets `Release` from reconciliation.
  On a client's exit the session check runs first; then its windows locate again, and
  a window still in the same live session follows the detach or crash rule, so a
  Locate never reattaches by itself. Work in flight on a client that exits, and a
  one-shot that fails or times out, becomes needed again. The Locate format includes `#{pid}` and `#{start_time}`, which expand even for a
  missing target, so every Locate also checks the server instance.
- **Rejected:** carrying a stream's continuity across owners (needs the sequence
  numbers just removed); de-duplicating two producers' bytes; a separate exit
  classifier that tested whether `display-message -t '$S'` failed (it never fails);
  running the session check and the windows' Locates independently (a Locate that
  finds the session alive would spawn its client again, reattaching after a detach
  and skipping the crash delay); holding in-flight work as bare tags (a tag on a
  client that exits is never answered, leaving its window locating forever).
- **Found by:** the review of this revision (p23).
- **Changed 2026-10-22 (p35):** a bound window stays bound during a re-Locate, a window
  binds only from its owner's own answer, and a Locate that fails ends the watches;
  see "A window binds only from its owner's own Locate answer" below.

### `tmux -N` on every invocation

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #7). Probe:
  [probe-locate-subscriptions.md](research/probe-locate-subscriptions.md).
- **What:** every tmux command tether runs fails instead of starting a server. New
  windows and sessions are one-shots.
- **Rejected:** `-f /dev/null` so a started server exits at once, attaching only to
  sessions just seen in a listing, and spawning a control client on the first listed
  session for `newSession` (which also made it `latest` there).

### `-u` on every invocation

- **Decided:** 2026-10-22, tech lead (review of p33, from a tmux 3.4 probe).
- **What:** every tmux process tether runs, control client and one-shot, is
  `tmux -u -N …`, built in `Endpoint::command`.
- **Why:** when the client's locale isn't UTF-8, tmux 3.4 replaces non-ASCII characters
  and line breaks in format output (window names, `display-message`, listings) with `_`.
  A systemd unit's locale may not be UTF-8. With no locale set and no `-u`, a window
  named `中w` came back as `__w`, and the real-tmux tests catch the missing flag.
- **Rejected:** relying on the inherited locale.

### Both no-server messages are `NoServer`

- **Decided:** 2026-10-22, tech lead (review of p33).
- **What:** with `-N`, a stale socket prints `no server running on …` and a missing
  socket file prints `error connecting to … (No such file or directory)`. Both map to
  `TmuxError::NoServer`.
- **Why:** both mean no server is running, and the hub answers both with `serverExited`
  and `notRunning`.
- **Rejected:** matching only `no server running`: a missing socket file (tmux never
  started, or its socket removed) would surface as a generic `tmux` error.

### One-shots are arguments, not command lines

- **Decided:** 2026-10-22, tech lead (review of p33, from a tmux 3.4 probe).
- **What:** a one-shot is an argv vector. A user's `name` or `dir` gets every `#`
  doubled, a trailing `;` sent as `\;`, and control characters refused.
- **Why:** tmux takes each argument literally, so the single-quote quoting of a
  control-client line would put quote marks into names. The exception is a trailing
  `;`, which ends the command: `-n 'x;'` produced `unknown command: -c`. `#` is
  format-expanded in `-n` and `-c`. A control character is refused as on a control-client
  line, and a name with a line break would also garble the listing.
- **Rejected:** building the same quoted string a control client takes and passing it
  to tmux as one command; sending a trailing `;` unescaped.

### One reply type for control-client and one-shot answers

- **Decided:** 2026-10-22, tech lead (review of p33). Replaces the draft
  `OneShotResult`.
- **What:** a one-shot answers `Result<Reply, TmuxError>`, like `Event::Done`. `Reply`
  gained `Listing` and `Created`; `TmuxError` gained `NoServer`, `Timeout` and
  `Spawn(String)`.
- **Why:** the hub handles a Locate answer the same way from a control client and from a
  one-shot.
- **Rejected:** a separate `OneShotResult` type: the hub would carry two shapes for one
  answer.

### `pump::spawn` can't fail

- **Decided:** 2026-10-22, tech lead (review of p33). Replaces
  `Result<_, SpawnError>`.
- **What:** `spawn` returns the line sender and the task handle. A failure to start
  tmux arrives as `PumpMsg::Exited` with `stderr_tail` `can't run tmux: …` and no bytes
  before it.
- **Why:** the hub has one path for a client that ended, whether it never started or
  died later.
- **Rejected:** a `SpawnError` at the call: a second exit path beside `Exited`.

### The pump's file is `pump.rs`

- **Decided:** 2026-10-22, tech lead (review of p33).
- **What:** the module is `src/tmux/pump.rs`, `tmux::pump`, as the spec's task table
  says.
- **Rejected:** `client.rs`, which the build brief named: the spec, the task table and
  `src/tmux/AGENTS.md` all say `pump`.

### The listing and creation formats

- **Decided:** 2026-10-22, tech lead (review of p33).
- **What:**
  - `list-clients` prints `#{session_id}` rather than `#{client_session}`, and comes
    before `list-windows`.
  - The window line puts `#{window_name}` last, after `#{session_name}`.
  - `new-window` and `new-session` print `#{pid}\t#{start_time}\t#{session_id}\t#{window_id}`,
    replacing `#{window_id}` and `#{session_id}\t#{window_id}`.
- **Why:** the session id joins client lines to window lines directly. tmux 3.4 allows
  raw tabs and line breaks in a window name set with `-n`, so a name goes last to be
  split with `splitn`, and clients come first so a name with a line break garbles only
  window lines. A session name can't hold either (tmux escapes it). `created` carries a
  `WindowRef`, which needs the server instance, and the hub may not know one for the
  endpoint when it asks to create.
- **Rejected:** `#{client_session}` (a name, not an id); windows before clients; a
  creation format without the server instance, leaving the hub to guess it.

### "Nothing is lost" holds only for stalls shorter than `pause-after`

- **Decided:** 2026-10-22, tech lead (review of p33, from the Gap tests). Changes the
  rule in §2 and §3.3 that with only control clients attached nothing is lost.
- **What:** with only control clients attached, a stall shorter than `pause-after`
  (3 s) loses nothing and sends no `%pause`. A longer stall can still end in a Gap.
- **Why:** when a control client falls behind, tmux stops reading the pane, but the
  blocks it had already queued keep ageing and are paused at 3 s. That explains the
  1-in-3 Gap p25 saw with control clients only. The hub's inbox (2 MiB) sits in front of
  tmux, so tmux notices a stall only once the inbox is full. The real-tmux test uses a 2 s
  stall for the no-Gap case and a terminal client with a 7 s stall for the Gap case.
- **Rejected:** keeping the unconditional claim, which the tests contradict.

### The client size is set at startup

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #8); the mechanism by design
  (p21).
- **What:** the session's startup line reports the current window's size, and the
  session sets it as the client size before reporting `Ready`, so no vote reaches tmux
  first.
- **Why two lines:** `refresh-client -C` doesn't expand formats, so the size can't be
  read and set in one command group.
- **Rejected:** "the first `Vote` also sets the client size" (a second mode in the
  vote path); a one-shot size query before spawning (an extra process per attach).

### Sizing: client size at attach, a vote per watched window

- **Decided:** 2026-10-21, design (daemon core), verified on 3.4.
- **Rejected:** a pin on the session's current window (capped the laptop's window for
  the client's whole life and was lost once the phone viewed that window); client size
  = the phone's size (shrinks every window where the client is `latest` or alone);
  votes only (the default 80×24 client size resizes other windows); `attach -f
  ignore-size` (the phone could never size a window while the laptop is attached);
  `window-size manual` (changes a global option and the laptop's behaviour).
- **Two phones with different sizes** (tech lead, review round 2): last resize wins;
  not designed for.

### A watch exists only while its tab is on screen

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #8).
- **What:** a covered or hidden terminal sends `unwatch`; `watch` carries a required
  size.
- **Rejected:** a `visibility` message with per-connection and per-watch visible state
  and re-sent votes: a second way of saying "on screen".
- **Cost:** returning from a settings screen costs one snapshot.

### The cwd subscription's shape

- **Decided:** 2026-10-21, design (p21). Probe:
  [probe-locate-subscriptions.md](research/probe-locate-subscriptions.md).
- **What:** one window subscription per watched window on its owner, named `w<W>`,
  `@W:#{pane_current_path}`; the value goes in `watching.cwd`, and `watching` is
  re-sent when it changes. `cwd` is null until tmux first reports, within about a
  second.
- **Why:** a window subscription follows the active pane by itself, reports its first
  value on subscribing, and is active only on the owner's session, which matches
  ownership.
- **Rejected:** one session-wide `%*` or `@*` subscription per control client at
  startup (reports every pane or window, and the hub would have to cache values for
  windows nobody watches); a separate `cwd` message (`watching` already carries a
  watch's changing facts); holding `watching` until the first value (delays the
  screen).

### Closure is a broadcast fact

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #11).
- **What:** `windowClosed`, `sessionClosed`, `serverExited` are broadcasts;
  `watchEnded` carries only `detached` or `error`.
- **Rejected:** `watchEnded { windowClosed | sessionClosed | serverExited }` beside a
  `windowClosed` broadcast: closure reported twice, and tabs on a killed session that
  weren't watched never closed.
- **Design note (p21):** tabs close on `windowClosed` and `serverExited` only. A
  session's windows may have moved before it died, so `sessionClosed` closes no tab;
  it is sent when a control client's session is found gone.

### No automatic reattach after a detach

- **Decided:** 2026-10-21, design (daemon core).
- **What:** when another client detaches tether's control client (`attach -d`,
  `detach-client`), its watches end with `watchEnded { detached }`; a tap reattaches.
- **Why:** the user who detached tether meant it.
- **Rejected:** auto-reattach: fights `attach -d`, and reattaching makes tether
  `latest`, shrinking the laptop's window right after the user took it.

### Input: hex for text, names for keys

- **Decided:** 2026-10-21, design (daemon core).
- **Rejected:** `send-keys -l '…'` (needs quoting, can't carry newlines); raw bytes for
  named keys (wrong in application-cursor mode).

### Input before `watching` is refused

- **Decided:** 2026-10-21, design (p21).
- **What:** `input` and `paste` for a watch that isn't bound get `busy`; the client
  sends input only after `watching`.
- **Why:** with Locate before binding there may be no control client yet, and the
  screen isn't shown until the snapshot anyway.
- **Rejected:** routing early input through any live control client (none may exist
  on a cold start); buffering it in the daemon (another queue).

### Watches: client-chosen ids, targeting a window

- **Decided:** 2026-10-21, design (daemon core).
- **Rejected:** server-assigned ids (a round trip per tab); reusable ids (a stale frame
  for an old watch could reach the new one); watching a pane (the client would track
  active-pane changes it can't see).

### One hub task

- **Decided:** 2026-10-21, design (daemon core).
- **Rejected:** a task per pane stream (more channels and routing for a single-user
  load); streams inside the control-client task (tangles protocol parsing with
  fan-out policy).

### Backpressure: one budget, starve every watch, pull snapshots

- **Decided:** 2026-10-21, design (daemon core); simplified by the tech lead (review
  round 2, p16 #14).
- **Rejected:** a snapshot pushed on every overflow (captures at the pane's output
  rate during a flood); a hub-side starved flag (duplicates the outbox); replay for
  slow consumers (a few-KB snapshot beats 256 KB of `yes` on cellular); unbounded
  queues; in round 2, dropping only the largest watch queue and coalescing JSON
  messages (a connection normally has one watch), the control client's 256-request
  internal queue (the hub never awaits it), and close 4008 for a JSON overflow (folded
  into wedged).

### Credit-based flow control per connection

- **Decided:** 2026-10-22, tech lead, from the verification review of the round 2
  revision (p24). Replaces the outbox budget, the outbox's starved state and snapshot
  pull, and the JSON FIFO and hub → connection message caps as memory bounds, from
  "Backpressure: one budget, starve every watch, pull snapshots" above.
- **What:** the hub holds a byte credit per connection (2 MiB) and debits it for every
  `ToConn`; the connection returns credit over `FromConn::Credit` once a frame is
  written or discarded. A snapshot or history capture reserves 1 MiB before its group
  is issued: a snapshot that can't stays desired, a history request gets `busy`, and
  the reply is charged at its encoded size. Output that doesn't fit starves that watch
  alone, which catches up by snapshot, no sooner than 250 ms after its last one.
  Control JSON is never refused and may overdraw by 64 KiB; past that the connection
  is wedged (4002). The outbox keeps ordering, replacement and coalescing, and no
  limits ([daemon-core.md §4.6](daemon-core.md#46-credit-and-the-outbox)). The memory
  ceiling drops from about 62 MB to about 59 MB.
- **Why:** count-bounded queues carrying variable-size payloads escaped the byte
  budget. A legal 200-row history capture at 500 columns encoded to 134 KB, so 256
  queued in one JSON FIFO were 34 MB; snapshots and output in the 256-message
  `ToConn` channel had the same gap. One number in the hub, which already decides what
  to send, bounds production, transit, outbox residence and the frame being written,
  and keeps the no-shared-state rule: the connection only reports bytes.
  Starvation moves into the hub, reversing the earlier rejection of a hub-side starved
  flag: with the credit in the hub, the outbox no longer tracks it, so nothing is
  duplicated. Wedged (4002) now means control JSON past its overdraft or a full
  channel, no longer a JSON FIFO overflow.
- **Rejected:** end-to-end permits (a response permit object carried from the capture
  to the socket and dropped on delivery: the same bound, but shared state across
  tasks, which the hub/connection split forbids); per-message byte caps (each message
  bounded, but the count still multiplies them: 256 × a capped `historyChunk` is the
  failure above); keeping the outbox budget beside the credit (two limits on the same
  bytes, and the outbox would starve watches the hub thinks are live).

### Wedged closes with 4002

- **Decided:** 2026-10-21, design (p21).
- **What:** a connection dropped because the hub's channel to it is full, or because
  its JSON FIFO overflowed, closes with 4002; the client reconnects.
- **Rejected:** a separate code per cause, such as the former 4008 for a JSON
  overflow: the client does the same thing for both.

### Every watch the daemon ends gets `watchEnded`

- **Decided:** 2026-10-21, design (p21), from the review of this revision (p23).
- **What:** apart from the closure broadcasts, a watch ends only with `watchEnded`,
  including a watch refused for the connection's watch cap or the control-client cap.
  `error` refuses one request and never ends a watch; the outbox forgets a watch only
  on `unwatch` and `watchEnded`.
- **Rejected:** `error { tooManyWatches | tooManySessions }` ending a watch, and the
  outbox forgetting a watch on any `error` naming it: a `busy` history request would
  have orphaned a live watch.

### Paste slots

- **Decided:** 2026-10-21, design (p21), from the review of this revision (p23).
- **What:** at most 4 paste files exist at once daemon-wide; without a free slot the
  connection answers `busy` before writing anything. Deleting the file frees its slot.
- **Why:** `$XDG_RUNTIME_DIR` is tmpfs, charged to tether's cgroup; with only the
  queue bounds, about 150 pastes could wait as files, close to 38 MiB.
- **Rejected:** counting only in-memory payloads.

### Paste: a file on receipt, deleted on the group's reply

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #13, p17 #4).
- **Why:** with payloads in a queue, 256 queued pastes of 256 KiB were 64 MiB, the
  whole memory limit; a probe showed tmux has read the file by the time the group
  replies.
- **Rejected:** deleting on `%paste-buffer-deleted` or after a 5 s timer.

### Paste buffers: a window check first, a separate delete on failure

- **Decided:** 2026-10-22, design (p25 for the check and the names; the `src/tmux/`
  lane for the delete).
- **What:** the paste group is `load-buffer ; paste-buffer -p -d`, the buffer is
  `tether-<tag>`, and a failed group is followed by a separate `delete-buffer -b
  tether-<tag>` group whose error is ignored. Tags are unique across control clients.
- **Why:** `paste-buffer -d` deletes only on success, so a failure after `load-buffer`
  would leave the pasted text in tmux's buffer list. A leading `send-keys -t @W` guard
  was tried and dropped: it covered only a missing window, and the cleanup covers every
  failure point. tmux skips the rest of a failed
  list, so the delete can't ride in the same group. Buffer names are server-wide, so
  two control clients sharing a tag space would collide. A missing file doesn't fail
  `load-buffer` on 3.4 (the error is printed outside any block); the group fails at
  `paste-buffer` instead.
- **Rejected:** `paste-buffer -d` alone (leaves the buffer on failure).

### An oversized reply fails its group, not the control client

- **Decided:** 2026-10-21, design (p21).
- **What:** a partial line or a group's replies over 1 MiB are discarded and the group
  fails `TooLarge`.
- **Why:** a legal, very large screen made the old 4 MiB limit kill the control
  client, which would respawn and fail again.
- **Rejected:** treating any limit breach as fatal.
- **Changed 2026-10-22 (design, p25):** the parser caps only the length of a line
  (`TooLong`, never an error). The 1 MiB reply cap is `Session`'s, per group, because
  only `Session` knows the groups; replies to hooks and the attach are never held. The
  4 MiB block limit is gone.
  - **Rejected:** a block cap in the parser, which doesn't know the groups.

### `Session::new()` takes no session id

- **Decided:** 2026-10-22, design (p25).
- **What:** `Session::new()` takes no argument. The pump's `attach-session -t '$S'`
  is the only place the id is used.
- **Why:** the protocol never uses it: `display-message` without `-t` targets the
  attached session.
- **Rejected:** `Session::new(SessionId)` as the earlier spec had it.

### Notification choices in `Session`

- **Decided:** 2026-10-22, design (p25), where the spec was silent.
- **What:**
  - `%session-renamed` becomes `SessionsChanged`, like `%sessions-changed`.
  - `Layout` takes pane sizes from the visible layout, so a zoomed pane reports its
    full window size.
  - The client-size line at startup produces a `%layout-change` even when no size
    changes; it is reported like any other, and a `Layout` that repeats a stream's
    size is not a break.
  - `%exit` follows a detach, `kill-server` and a closed stdin alike, so
    `LocateSession` keeps running first in the exit path.
- **Rejected:** the window layout for sizes (it is the unzoomed layout).

### Caps sized for the memory ceiling

- **Decided:** 2026-10-21, design (p21), from tech lead review round 2 (p17 #4:
  recompute the ceiling from simultaneously reachable states, and count pre-handshake
  sockets).
- **What:** 3 connections counted from the upgrade, 3 control clients, 2 watches per
  connection, 1 one-shot, 1 MiB per reply group, 2 capture slots
  ([daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling)).
- **Why:** with the earlier caps (4 connections, 4 control clients, 8 streams, 4 MiB
  blocks) the reachable total exceeded `MemoryMax=64M` before counting carapace.
- **Rejected:** keeping the caps and raising `MemoryMax`.

### Logs carry framing metadata only

- **Decided:** 2026-10-21, tech lead (review round 2, p17 #9).
- **Rejected:** logging the last 4 KiB of control-client input on a parser error: that
  stream holds terminal output and captured screens, the contents the logging rule
  forbids.

### Server instances name their endpoint

- **Decided:** 2026-10-21, design (p21).
- **What:** `WindowRef.server` is `"<endpoint>:<pid>-<start_time>"`, `main` or
  `scratch`, so the hub routes a window to its tmux server from the id alone.
- **Rejected:** a separate endpoint field on every ref; a lookup from instance to
  endpoint (empty after a daemon restart, before anything is attached).

### A window binds only from its owner's own Locate answer

- **Decided:** 2026-10-22, tech lead, accepted from the hub build (p35). Changes "How
  ownership and Locate interact" above
  ([daemon-core.md §4.2](daemon-core.md#42-windows-owners-and-locate)).
- **What:** a window binds only from a Locate answered by the control client that will
  own it. An answer from another client or a one-shot only names the session; the hub
  finds or spawns that session's client and Locates again on it. A bound window stays
  bound, and its stream live, while a re-Locate runs, and changes owner only if the
  answer names a different owner or pane. So the old state diagram's `Bound →
  Locating: unlinked` is gone.
- **Why:** tmux orders a control client's replies with that client's own notifications
  and with nobody else's. After the owner's answer, any later `ActivePane` or unlink
  reaches the hub behind it; after another client's answer, one the owner had already
  reported could be missed and the window bound to a stale pane. A `WindowUnlinked`
  from an unrelated session of a linked window is common, and it must not cost the
  watched window its stream.
- **Rejected:** binding from any answer (the race above); returning a window to
  `Locating` on every unlink (a live stream broken, and a snapshot paid, for a change
  that names the same owner and pane).

### A failing Locate or session check ends the watches

- **Decided:** 2026-10-22, tech lead, accepted from the hub build (p35). Changes "How
  ownership and Locate interact" above
  ([daemon-core.md §4.2](daemon-core.md#42-windows-owners-and-locate)).
- **What:** a Locate or session check answered with anything but `NoServer` (tmux can't
  run, a timeout, an unexpected reply) ends the window's watches with `watchEnded {
  error }`. `NoServer` still means the server is gone. Work lost because its control
  client exited is still needed again.
- **Why:** needed-again work is sent on the next `reconcile`. When tmux can't be run at
  all, a one-shot fails at once and every `handle` would spawn a failing process.
- **Rejected:** "needed again" for one-shot failures and timeouts, as the earlier entry
  had it.

### The reply timeout is a progress deadline; every unplanned exit gets a session check

- **Decided:** 2026-10-22, tech lead, accepted from the hub build (p35). Changes the
  per-group timeout in the daemon-core spec
  ([§4.5](daemon-core.md#45-control-clients)).
- **What:**
  - A control client with groups in flight that completes none for 10 s is killed. The
    deadline belongs to the client, so it also covers `Session`'s own groups (the
    startup line, pauses), which the hub never tags.
  - Fatal errors and timeouts count as crashes, not detaches: the hub killed the client,
    so tmux sent no `%exit`.
  - The session check runs on every exit the hub didn't cause (not on a linger or cap
    close), so `serverExited` and `sessionClosed` go out even when no tab was watched.
- **Rejected:** a deadline per tagged group (the groups `Session` sends itself would be
  unwatched); checking a session only when one of its windows was watched (closure
  broadcasts reach tabs that exist but aren't on screen, and they would never be told).

### One reporter per endpoint for renames and session changes

- **Decided:** 2026-10-22, tech lead, accepted from the hub build (p35).
- **What:** `windowRenamed` and `sessionsChanged` come only from the endpoint's
  lowest-id `Ready` control client
  ([daemon-core.md §4.5](daemon-core.md#45-control-clients)).
- **Why:** tmux sends these notifications to every control client, so each would be
  broadcast once per client.
- **Rejected:** broadcasting from every client (N copies).

### The stream is part of the window; `state.rs` is split three ways

- **Decided:** 2026-10-22, tech lead, accepted from the hub build (p35). Changes the
  `Stream` of [daemon-core.md §4.3](daemon-core.md#43-pane-streams) and the file layout
  of §4.
- **What:** a window shows one pane, so the hub keeps one stream per window (live, size,
  the snapshot in flight and its reservations), and an active-pane change breaks it.
  `state.rs` holds the model, tmux events, streams and credit; `owners.rs` the Locate
  answers, binding, control clients and exits; `requests.rs` the connections'
  messages.
- **Rejected:** a `streams` map keyed by pane (it always changes together with its
  window, and every change would touch both); one `state.rs` (three concerns in one file).

### Reconcile runs only after inputs that may change desired state

- **Decided:** 2026-10-22, tech lead, accepted from the hub build (p35). Changes
  [daemon-core.md §4.1](daemon-core.md#41-statehandle), which had `reconcile` after
  every `handle`.
- **What:** `reconcile` is skipped for pump bytes that complete no group, produce only
  `Output` events and starve no watch. Every other input, and every timer that fires,
  runs it.
- **Why:** measured in one release process, a plain output chunk cost about 230 ns
  without `reconcile` and 590–910 ns with it; with the skip it costs about 256 ns, 5% of
  the pump's own ~5 µs wake per chunk. Output is the only input at pump rate.
- **Rejected:** `reconcile` after every `handle` (2.5 to 4 times the hub's work on the
  hot path, for no change in what is sent).

### Connection API details

- **Decided:** 2026-10-22, tech lead, accepted from the hub build (p35). Changes
  [daemon-core.md §4.6–4.7](daemon-core.md#47-public-interface).
- **What:**
  - `hub::spawn(endpoints)` takes no config: every limit is a constant.
  - `connect` and `send` return `Result<_, HubGone>`.
  - `ToConn::Msg` carries `ends: Option<u32>`, the watch a `watchEnded` ends; the outbox
    forgets that watch as it takes the message.
  - The outbox keeps no registry of watches. Frames for a forgotten watch are written,
    and the client drops frames for a watch it no longer has.
  - The connection sends `Credit` whenever `take_credit()` is non-zero, not only after a
    write.
- **Why:** the limits are sized together for the memory ceiling, so nothing is
  configurable. A registry would copy what the client and hub already know. Credit
  returned by a discard (an `unwatch` with frames queued) would otherwise wait for the
  next write, and an idle socket makes none.
- **Rejected:** a `HubConfig` struct; an outbox registry of live watches; returning
  credit only after a socket write.

### `sessions.tmux` is `TmuxListing | null`

- **Decided:** 2026-10-22, tech lead, accepted from the hub build (p35). Changes the
  `sessions` message ([daemon-core.md §5.3](daemon-core.md#53-json-messages)).
- **Why:** `null` for "no tmux server" is what serde and ts-rs express cleanly.
- **Rejected:** `"notRunning" | { … }`: a string-or-object union has no clean serde or
  ts-rs shape.

### Watches that can never bind, and reused ids

- **Decided:** 2026-10-22, tech lead, accepted from the hub build (p35). Fills a gap in
  [daemon-core.md §4.2](daemon-core.md#42-windows-owners-and-locate).
- **What:** a `watch` whose `server` string doesn't parse, or names an unknown endpoint,
  gets `serverExited` for that string on that connection, which closes the tab. A watch
  id that is already active gets `error { badRequest }` and the active watch is
  unchanged.
- **Why:** such a ref can never bind, which is what `serverExited` says of a dead
  server's windows. A `watchEnded` for a reused id would name the live watch and end it.
- **Rejected:** `error { badRequest }` for the unparseable server (the tab would wait
  for a `watching` that never comes); `watchEnded` for a reused id.

### Unknown message types are reported by `decode`

- **Decided:** 2026-10-22, tech lead, accepted from the hub build (p35). Fills a gap in
  [daemon-core.md §5.2](daemon-core.md#52-handshake-and-versions).
- **What:** `ClientMsg::decode` returns `Decoded::Unknown { kind }` for a type it
  doesn't know, so the connection logs and ignores it; a known type with bad data is a
  protocol violation (4003).
- **Why:** the protocol says new message types need no version bump.
- **Rejected:** serde's `#[serde(other)]` catch-all alone: it matches only a message
  without `data`, so a newer client's message carrying a `data` object would fail to
  parse and look like a protocol violation.

### One generated TypeScript file, rendered by a test

- **Decided:** 2026-10-22, tech lead, accepted from the hub build (p35). Changes "ts-rs
  for TypeScript, hand-written Swift" above
  ([daemon-core.md §5.5](daemon-core.md#55-type-generation)).
- **What:** the TypeScript is one file, `web/proto/generated/messages.ts`, rendered from
  ts-rs declarations by a Rust test in `src/proto/typescript.rs`. The test fails while
  the committed file is stale, so `cargo test` in preflight checks it;
  `UPDATE_PROTO_TYPES=1 cargo test --lib proto::typescript` rewrites it. The message
  types are `ClientMsg` and `ServerMsg`; the file also exports `PROTOCOL_VERSION` and
  `CloseCode`. The web imports from it and drops its hand-written copies
  (`ClientMessage`, `ServerMessage`, and `"notRunning"` for `sessions.tmux`).
- **Why:** the web's protocol code lives under `web/proto/`, so the generated types sit
  beside it.
- **Rejected:** ts-rs's `#[ts(export)]`, which writes into the tree on every test run
  instead of comparing against the committed file; `web/src/proto/generated/`, the
  spec's earlier path.

### An oversized history capture is retried with half the rows

- **Decided:** 2026-10-22, tech lead, on the hub build's finding (p35). Changes how a
  `historyChunk` is cut ([daemon-core.md §4.6](daemon-core.md#46-credit-and-the-outbox)).
- **What:** when a `history` capture fails `TooLarge`, the hub reissues it with half the
  rows, down to one row, and the client sees a shorter `historyChunk` and asks again
  from where it ends. A single row that still fails answers `error { tmux }`.
- **Why:** `Session` caps a group's replies at 1 MiB raw, but the reservation holds the
  base64 text, a third larger. A capture of 768 KiB to 1 MiB raw succeeds and is cut to
  the rows that fit. Over 1 MiB raw (200 heavily styled 500-column rows) the group
  fails, and without a retry every request for that range fails the same way.
- **Rejected:** the client shrinking its range on `error` (the error doesn't say what
  size fits, and every client would carry the retry); the hub asking for fewer rows up
  front (it can't know row sizes before capturing, and a fixed lower limit would shrink
  every request for the rare heavy one).

### Two watches on one connection snapshot one at a time under load

- **Decided:** 2026-10-22, tech lead, accepted from the hub build (p35); a consequence
  of the credit entry above, stated so nobody reads it as a stall.
- **What:** credit is 2 MiB and a capture reservation 1 MiB, so two reservations on one
  connection fit together only while nothing else is outstanding to it. With output or
  an earlier snapshot in flight, the second watch's snapshot waits for credit to
  return.
- **Rejected:** none recorded; the sizes are set by the memory ceiling
  ([daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling)).

## Daemon service, as built

Decided 2026-10-22 by the tech lead, accepted from the p40 build (commit b1dcb8c), which
found each point while running the daemon.

### The connection's own replies are bounded by a queue of 16, not charged to credit

- **What:** `welcome`, `pong` and the paste refusals the connection makes itself
  (`inputTooLarge`, `busy`) are written by the connection task and never pass through
  the hub. They wait in a queue of 16 entries, ahead of the outbox's frames; while 16
  wait, the connection stops reading its socket
  ([daemon-core.md §4.6](daemon-core.md#46-credit-and-the-outbox)).
- **Why:** credit is the hub's only copy of the bytes it sent to a connection. These
  messages start in the connection, so charging them would mean telling the hub about
  bytes it never sent. Not reading the socket while the queue is full is the same
  backpressure that keeps a client that pings without reading from growing it.
- **Rejected:** charging them to credit, as §4.6 first implied for "every byte"; an
  unbounded queue.

### The unit uses `KillMode=mixed` and a restart backoff

- **What:** `contrib/tether.service` sets `KillMode=mixed`, `RestartSec=2`,
  `RestartSteps=5`, `RestartMaxDelaySec=60` and `StartLimitIntervalSec=0`
  ([plan.md](plan.md#resource-budget)). Changes plan.md's earlier unit sketch, which had
  neither.
- **Why:**
  - Under the default kill mode, `systemctl stop` signals the `tmux -C` clients
    directly, so the hub logged them as detached while the sockets were closing with
    4004, and the phone could get `watchEnded { detached }` instead of reconnecting.
    Verified with a transient unit.
  - tailscaled is a system unit that a user unit can't order itself after, so at boot
    tether may start first, find no LocalAPI socket and exit. A backoff with no start
    limit keeps it retrying until tailscaled is up.
- **Rejected:** the default `KillMode=control-group` (the false "detached" above);
  ordering after `tailscaled.service` (a user unit can't); a fixed `RestartSec=2` with
  the default start limit (a slow boot would exhaust it and leave tether down).

### No sd-notify watchdog, no tracing-journald

- **What:** the daemon sends `READY=1` and `STOPPING=1` only, and logs to stderr, which
  the journal captures ([plan.md](plan.md#stack)). Changes the stack row that listed a
  watchdog and optional tracing-journald.
- **Why:** a watchdog needs a periodic timer, which breaks the zero-wakeup idle (0
  context switches over 60 s, measured). stderr already reaches the journal, so
  tracing-journald adds a dependency for nothing.
- **Rejected:** `WatchdogSec` with a keep-alive timer; tracing-journald.

### `dir` on `newWindow` and `newSession` passes through until `src/fs/` exists

- **What:** [daemon-core.md §5.3](daemon-core.md#53-json-messages) says the connection
  checks `dir` against the file roots. `src/fs/` doesn't exist yet, so the build
  passes `dir` to tmux unchecked, with a TODO in `src/http/.context/TODO` and in the
  spec. The check lands with `src/fs/`.
- **Rejected:** none recorded.

### `tether serve` is Linux-only for now

- **What:** the daemon needs tailscaled's LocalAPI unix socket for the login allowlist
  and the Funnel check. The macOS Tailscale apps (App Store and standalone) have no
  such socket, so `tether serve` won't start there. The Mac is for recording the 3.7b
  fixtures and building the iOS app ([plan.md](plan.md#product-rules)).
- **Rejected:** a macOS daemon that skips the LocalAPI checks: it would run with no
  login allowlist and no Funnel check.

### Shutdown waits for the hub's pumps

- **What:** the hub's task handle completes only after every pump task has, so
  `main` exits after the `tmux -C` clients have been closed through stdin
  ([daemon-core.md §4.7](daemon-core.md#47-public-interface)). Fixes the build, whose
  hub handle completed before its pumps finished, so the process exit SIGKILLed the
  clients.
- **Why:** §7 says shutdown closes the control clients' stdin. tmux treated the SIGKILL
  as an ordinary disconnect (checked), but the spec's rule is the clean one.
- **Rejected:** leaving it: the daemon exiting before its pumps.

### The paste directory is emptied after the port is bound

- **What:** the daemon binds `127.0.0.1:<port>` first, then empties
  `$XDG_RUNTIME_DIR/tether/` ([daemon-core.md §3.4](daemon-core.md#34-commands-commandrs)).
- **Why:** a daemon started by mistake emptied the directory and then failed to bind,
  deleting a running daemon's in-flight paste files. Found in the live run.
- **Rejected:** emptying first, as the build did.

## iOS app

### Snapshots apply after earlier writes drain

- **Decided:** 2026-10-21, tech lead (review round 2, p17 #1). Verified against
  `@xterm/headless` 6.0.0 by p17.
- **What:** one serialized write pipeline per terminal in `web/term/`; a snapshot runs
  `reset(); resize(); write(restore)` only after every earlier write's callback fired.
- **Why:** bytes still queued inside xterm.js parse after `reset()` and can switch on a
  mode (insert mode) that the restore never switches off.
- **Rejected:** replacing the terminal instance per snapshot (renderer and WebGL
  context churn on every tab switch).

### Bridge cleanup

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #12); message shapes by
  design (p21).
- **What:** `keyboardState` dropped (use `viewport.keyboard`); `keyboard { show }`
  folded into `focus` (`terminal`, `hidden`); `active { host }` dropped, native asks the
  page with `activeTab()` when an upload starts; the app-wide lock is `lock { locked }`,
  per-host enrolment is `enrolled` in `hosts`; `hostRejected { host }` reports a 4401
  to native. `web/input/` folds into `web/native/`.
- **Rejected:** keeping `auth { host, state }`, which mixed the app lock with per-host
  enrolment; native mirroring the active tab.

### Upload paths are queued per tab

- **Decided:** 2026-10-21, tech lead (review round 2, p17 #7).
- **What:** the web queues an insertion for the tab the upload started from, applied
  when that tab is watched again, dropped with a notice if it closed.
- **Rejected:** inserting into whatever tab is active (the wrong terminal); keeping
  background watches open for uploads.

### Host content on its own origin

- **Decided:** 2026-10-21, tech lead (review round 2, p17); origin naming and the gate
  mechanism by design (p21).
- **What:** proxied host content comes from `tether-app://h-{host}/…`, the UI from
  `tether-app://ui/`, so the UI's `script-src 'self'` never covers a daemon response.
  The scheme handler adds `Access-Control-Allow-Origin: tether-app://ui`. Native
  proxies a host's requests only after its `/auth/info` reported a compatible protocol
  range in this app session.
- **Why the gate uses `/auth/info`:** the WebSocket, and so `welcome`, lives in the web;
  native already calls `/auth/info`, which reports the same range.
- **Rejected:** host content under `tether-app://ui/h/{host}/…` (same origin as the
  UI, so a proxied script could run as the app); the web reporting `welcome` results
  over the bridge (native's gate would trust web state).

### Native input and accessory

- **Decided:** 2026-10-21, design (iOS shell).
- **What:** a `UIKeyInput` first responder; the accessory holds the key row, compose
  field and paste control only.
- **Rejected:** a hidden `UITextView` or `UITextInput` (a shadow buffer and diffing to
  undo corrections the pane already received); the tab bar and suggestion strip in
  the accessory (the tab bar would exist twice, and the chips would mirror web state
  over the bridge).

### XcodeGen for the project

- **Decided:** 2026-10-21, design (iOS shell).
- **Rejected:** a committed `.xcodeproj` (unreviewable diffs, agent edits break it);
  Tuist (more machinery for one app); a bare Swift package (can't build an app with
  entitlements and extensions).

### The web asks native to recreate the web view: `recreateWebView`

- **Decided:** 2026-10-22, tech lead, accepted from the web host-layer build (p42,
  commit a43014f). Adds a row to the bridge table
  ([ios-shell.md](ios-shell.md#the-bridge)); the spec had only native reloading on a
  content-process kill.
- **What:** `recreateWebView` is a web → native message with no data and no reply. The
  web sends it after two consecutive connect timeouts on a host's socket (the first
  timeout opens a new socket at once; any `welcome` resets the count). Native discards
  the `WKWebView` and loads a new one, and the tabs come back through `boot`.
- **Why:** [plan.md](plan.md#reconnect) already says the client recreates the web view
  when a socket stays stuck in CONNECTING (WebKit 308073). Only the web sees the stuck
  socket, so only the web can ask; native's content-process hook never fires for it.
- **Rejected:** native detecting the stuck socket (it can't see inside the web view's
  sockets); moving the socket to native now (the recorded fallback, kept for if spike 3
  shows recreation doesn't clear it).
- **Names:** `lifecycle.phase` stays `active` and `background`, the spec's names; the
  web host-layer brief called the first one "foreground".

### Native keeps the saved tab list

- **Decided:** 2026-10-21, tech lead (review round 2, not adopted).
- **What:** `saveTabs` stays native. The hypothesis that WKWebView `localStorage` on
  the custom scheme survives a content-process kill is unverified and needs the
  device.

## Auth

### Token details

- **Decided:** 2026-10-21, design (auth).
- **Rejected:** a slow password hash (argon2, bcrypt: protects low-entropy secrets, and
  costs CPU per request); the phone generating the token (equally secure, but the
  daemon keeps format and entropy in one place shared with `tether device add`);
  expiring tokens (a trip to the server shell every few weeks for protection Face ID
  already gives); a session token derived from the device token (would bring back
  minting, expiry and refresh for no protection the transport doesn't give).

### Keychain: one item for every host

- **Decided:** 2026-10-21, design (auth).
- **Rejected:** one item per host (one prompt for all hosts would depend on an
  evaluated `LAContext` covering several reads); a plain item behind an app-level
  `evaluatePolicy` (Face ID becomes a screen in front of the token instead of the key
  to it); `.biometryAny` (a face added later can unlock); `.userPresence` (the
  passcode stands in for Face ID).

### Auth is functions over one state file

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #9, p17 #8); file name and
  layout by design (p21).
- **What:** every check reads, parses and scans `auth.toml` (devices and the pending
  enrolment with its wrong-try counter), written atomically under the flock; consuming
  the code and adding the device is one write. The axum middleware lives in `http/`;
  `auth` exports `check(headers)`. `host_id` stays in its own file.
- **Why:** the device set is a few rows, so a check is tens of microseconds; a crash
  between the old two writes left a reusable code beside the new device, and a restart
  reset the wrong-code counter.
- **Rejected:** an `AuthService` task caching the devices behind a channel (a second
  owner of the set, and an undefined channel-full case); `devices.toml` plus
  `enroll.pending`; `host_id` inside `auth.toml` (the rewritten file could take the
  identity with it).

### Bad tokens on the WebSocket close with 4401

- **Decided:** 2026-10-21, design (auth).
- **Why:** a browser WebSocket can't see a refused upgrade's status (it reports 1006,
  like a network failure), so an HTTP 401 would leave the app retrying a dead token.

### No `Origin` check

- **Decided:** 2026-10-21, design (auth).
- **Why:** origin checks stop cross-site hijacking of ambient credentials, and tether
  has none: no cookies, and a bearer token a foreign page can't read.

### An unreadable `auth.toml` fails closed but retryable: 503 and close 4503

- **Decided:** 2026-10-22, tech lead, from the p40 build (commit b1dcb8c), which found
  that a file that doesn't parse made every token check fail as "not enrolled". Changes
  how "Auth is functions over one state file" reports a file that fails closed
  ([auth.md](auth.md#state-on-disk)).
- **What:** when the token check can't read or parse `auth.toml`, HTTP gets `503
  auth_unavailable` and a WebSocket upgrade completes and closes with `4503` (live
  sockets at their next re-check). The app keeps its token, doesn't mark the host "not
  enrolled", and retries with the usual backoff. The check still reads the file every
  time. The close code is 4503, in the app range beside 4401, to pair with the 503; the
  number is the design's pick.
- **Why:** a typo in a hand edit of `auth.toml` would otherwise force re-enrolling
  every device: 401 and 4401 tell the app its token is dead and it stops retrying.
  The app can't tell a broken file from a revoked device unless the daemon says so.
- **Rejected:** keeping 401 and 4401 for this case (the re-enrolment above); serving
  from the last good parse (a cache is the second owner of the device set that "Auth is
  functions over one state file" rejected, and a removed device would stay valid while
  the file is broken); failing open.

### The auth error codes and `/auth/info.name`, as built

- **Decided:** 2026-10-22, tech lead, documenting the p40 build.
- **What:**
  - Errors besides `bad_code` and `auth_required`: `forbidden` (403, the Tailscale
    check), `bad_request` (400, 415, 422, a body that isn't the route's JSON),
    `internal` (500, the enrolment transaction failed), and the new `auth_unavailable`
    (503) ([auth.md](auth.md#endpoints)).
  - `/auth/info.name`, and with it `welcome.host.name`, is the config key `name`, else
    the machine name from tailscaled's MagicDNS name. No spec named a source.
  - The config keys are `port` (default 7850), `name`, and `[tmux] program, socket_name,
    socket_path` ([plan.md](plan.md#config)).
- **Rejected:** none recorded; the spec was silent.

### The Funnel check reads LocalAPI, not `tailscale serve status`

- **Decided:** 2026-10-22, design (p40).
- **What:** at startup the daemon reads `/localapi/v0/serve-config` through its own
  LocalAPI client and refuses to run if Funnel is on for its port. It follows web
  proxies, TCP forwards and foreground serve sessions; if tailscaled can't be read, it
  refuses to start.
- **Why:** the JSON is the same as `tailscale serve status --json`, there is no
  subprocess to run on an overloaded box, and the client already exists for the login
  allowlist.
- **Rejected:** shelling out to `tailscale serve status --json`.

## Documentation

### Specs state the current rule; this log keeps the history

- **Decided:** 2026-10-21, tech lead (review round 2).
- **What:** this log; specs without review citations or draft narration; plan.md as
  the product and UX spec plus the index; prior art, the Rust-versus-Go comparison and
  the agent keybinding table moved to [research/](research/); each constant in one
  table; one term per concept (`watch`, not `viewer`).

## Batched pipe reads for control clients

- **Decided:** 2026-10-22, tech lead (from the p34 experiment, measured on the dev box).
- **What:** the pump reads a control client's stdout through tokio's pipe `Receiver`,
  registered with epoll only while waiting on a quiet pipe. While output is sustained
  it leaves epoll (`into_nonblocking_fd`) and reads at most 4 turns per 2 ms, each
  turn draining the pipe in 16 KiB reads. The first read after a quiet spell is
  immediate. Default 64 KiB pipe; no extra thread; no `unsafe`.
- **Why:** tmux writes one short `%output` line per write, and the old pump woke once
  per write: a numbered-line flood cost 44.8% of a core. Batched: 2.0%, with idle
  echo unchanged (p50 0.17 ms), idle CPU zero, throughput and tmux's own cost
  unchanged, and echo during a flood up to ~3 ms later (p99 3.3 ms).
- **Rejected:** a gate that stays registered with epoll (35%: every write still wakes
  the runtime); a blocking reader thread per client (same CPU, 3 more threads against
  `TasksMax`); `AsyncFd` (its safe constructors are deprecated as unsound in tokio
  1.54, the replacements are `unsafe`); one read per interval (adds the full interval
  to every keystroke, because the reply and the echo are separate writes); a 5 ms+
  gate (needs a 1 MiB pipe or caps throughput at 15 MB/s).

## Never send `respawn-pane` over control mode

- **Decided:** 2026-10-22, tech lead (found by p34 on tmux 3.4).
- **What:** tether never sends `respawn-pane` on a control client.
- **Why:** with a control client attached and the pane flooding, `respawn-pane -k`
  sent over control mode kills the whole tmux server (4 of 4 runs), taking every
  session with it. The one-shot form, `kill-pane` and `kill-window` did not crash.
