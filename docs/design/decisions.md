# Decision log

Every design decision behind tether's specs: what was decided, why, the alternatives
rejected, when, and who decided. The specs ([plan.md](plan.md),
[daemon-core.md](daemon-core.md), [ios-shell.md](ios-shell.md), [auth.md](auth.md),
[fs.md](fs.md), [complete.md](complete.md))
state only the current rule; this log keeps the reasoning and the history.

**Who decides.** *Jimmy* owns product calls, and his decisions are marked as his.
*Tech lead* decisions settle reviews. *Design* decisions were made by the spec's
author while writing it; the spawn that wrote each spec is named for traceability
(daemon core p7, iOS shell and auth p8 and p15, review round 2 revision p21; the
`tmux::Session` build p25, the restore-byte composer p30, the pump and one-shot
runner p33, and the hub and wire protocol p35, whose builds corrected the daemon-core
spec; the HTTP layer, auth, CLI and config build p40, commit b1dcb8c; the web host
layer p42, commit a43014f; the hub fixes after review p43, commit cb7548e; the web boot
p45, commit b115c2b; the hub refactor after the structural review p49 was applied in
p51, commit 97f8c39; the web fixes p52, commit 0342137; the file API spec p53 and its
build p58, commit ed9c637; the completion spec p60). Reviews:
round 1 of the plan is [plan-review.md](plan-review.md); round 1 of the subsystem specs
was p10–p14; round 2 was p16 (structure) and p17 (correctness).

A later entry that changes an earlier one says so; the earlier one keeps its text.

## Jimmy's decisions

Decided by Jimmy, 2026-10-21 unless an entry gives another date.

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

### AGENTS.md states principles; the specs hold the rules

- **What (2026-10-23):** AGENTS.md lists the principles behind tether's constraints,
  each with its reason: tmux's independence from tether, usable on spotty
  connections, light on a busy host whose CPU and memory Jimmy caps, private to the
  tailnet. The concrete limits that follow from them live in the subsystem specs.
- **Why:** a rule without its reason gets applied where it doesn't serve it. "No
  polling" serves two principles. For connections, clients never poll the server over
  the network. For the host, nothing runs while idle and nothing polls tmux. A
  server-local check that sends nothing over the network, and runs only while a client
  is connected, serves both.
- **Rejected:** rules in AGENTS.md, classified or not: they restate the principles
  without the reasons and drift from the specs.

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
- **Changed 2026-10-22 (p51):** the reply is no longer silent; see "A released snapshot
  is answered `Released`" below.

### A released snapshot is answered `Released`

- **Decided:** 2026-10-22, tech lead, from the structural review of the hub (p49),
  applied in p51 (commit 97f8c39). Partly reverses "A Release invalidates snapshot
  attempts" above, whose rule that none is re-sent stands and whose "no event of any
  kind" does not
  ([daemon-core.md §3.3](daemon-core.md#33-session-the-sans-io-control-client-sessionrs)).
- **What:** when the group of a snapshot attempt that a `Release` outdated ends,
  whatever its replies, `Session` emits `Done { tag, Err(TmuxError::Released) }`, in
  stream order. It still never retries and never emits `Snapshot` for it. The hub no
  longer works out what a Release invalidates: `Work::Release { invalidates }` is gone
  (a Release is maintenance like any other), with the computation of the invalidated
  tags, `forget_snapshot`, `Inflight.client`, `Work::Snapshot.pane`, the `Option`
  around its window and `abandon`'s lookup in `pending`, about 80 lines. A tag leaves a
  client's `pending`, and frees its capture slot, when its own answer arrives. The
  `snapshot-released` fixture was re-recorded on tmux 3.4: only its `.events` golden
  changed (`+done tag=1 error Released`), its `.in` did not, and replaying the old
  recording had already failed only that golden. The recorder scenario now requires
  exactly this answer.
- **Why:** the session already knows which of its groups are snapshots of the pane and
  what a retry would resume, but the hub rebuilt that: it computed the tags a Release
  invalidated, remembered them, and freed their slots when the Release was answered, so
  two components had to agree on one rule. With an answer, a snapshot's tag ends on
  its own reply like every other tag.
- **Rejected:** the silent drop with the hub inferring the invalidated tags (above).

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
- **Changed 2026-10-22 (p45):** the daemon sends `windowClosed` only for windows with a
  watch, so the web also prunes tabs against `sessions` listings; see "The web prunes
  its tabs against `sessions` listings" below.

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
- **Extended 2026-10-22 (p51):** the reporter's close notifications for unwatched
  windows are turned into `sessionsChanged` too, coalesced per input; see "An unwatched
  window's close broadcasts `sessionsChanged`, once per input" below.

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

### `NewWindow` carries the server instance, and tmux checks it

- **Decided:** 2026-10-22, tech lead, accepted from the hub fixes after review (p43,
  commit cb7548e). Changes how the hub treated a stale session ref on `newWindow`
  ([daemon-core.md §3.8](daemon-core.md#38-one-shots-and-endpoints-oneshotrs)).
- **What:** `OneShotCmd::NewWindow` carries the instance named by the request's
  `SessionRef`, and the one-shot starts with `if-shell -F
  '#{!=:#{pid}-#{start_time},<server>}' tether-server-changed ;` before `new-window`. On
  another instance tmux can't parse the branch, `if-shell` fails, and tmux skips the rest
  of the list. The one-shot reads `tether-server-changed` in stderr as `NoServer`, so
  `NoServer` also means "not the instance this one-shot was for", and the hub answers
  as for a dead server: `serverExited` for that instance and `error { noServer }`. The
  hub's cached comparison with the live instance is removed.
- **Why:** session ids restart at `$0` on every tmux server, so a ref from an earlier
  run names some other session on the live one. The hub's cached instance is unknown on
  a fresh hub (after a daemon restart) and stale after a server restart, so its check let
  `newWindow` create a window in the wrong server's session: the reviewer's probe got
  `created` and `@1` in the wrong instance. tmux evaluates the instance in the same
  command list that creates the window, so there is no gap between check and use. Checked
  on 3.4 (a mismatch exits 1 and creates nothing; a match creates the window); tmux
  master has the same `if-shell` and list-abort behaviour, 3.7b not run.
- **Rejected:** the hub comparing the ref with its cached live instance (unknown or
  stale, above); reading the instance in one process and then running `new-window` in
  another (leaves a window for the server to restart between the two).

### Time reaches `State` with the next input

- **Decided:** 2026-10-22, tech lead, accepted from the hub fixes after review (p43,
  commit cb7548e). Changes "Reconcile runs only after inputs that may change desired
  state" above for inputs past a deadline
  ([daemon-core.md §4.1](daemon-core.md#41-statehandle)).
- **What:** `handle` treats any input at or past `next_deadline()` as a Tick too: it
  fires the timers that are due and runs `reconcile` once, whatever the input was. The
  deadline is reported only until then, so one that can't be acted on (credit or a
  capture slot missing) can't spin the timer.
- **Why:** the runtime's select may take a ready pump input over its timer, so output at
  a steady rate kept the snapshot-spacing wakeup of a starved watch from ever running:
  the reviewer's probe saw nothing delivered after output, with the snapshot still
  owed. Putting the rule in the pure `State` keeps it testable with scripted inputs and a
  fake clock. Cost: about 30 ns more per output chunk (313 to 347 ns median, release
  build), under 1% of the pump's ~5 µs wake per chunk.
- **Rejected:** a timer-first (biased) select in `run.rs` (the rule would live in the
  executor's polling order, outside the pure core and its tests).

### `DropConn` and `CloseClient` on every exit

- **Decided:** 2026-10-22, tech lead, accepted from the hub fixes after review (p43,
  commit cb7548e). Changes what the two effects mean
  ([daemon-core.md §4.1](daemon-core.md#41-statehandle)).
- **What:** `State` owns every lifecycle and `run.rs` only mirrors it. `DropConn` means
  the connection is gone from the hub, whether it closed or was dropped as wedged;
  `CloseClient` goes out whenever a started control client leaves the state, whether the
  hub closed it or it exited. The executor removes its entries idempotently. A `connect`
  whose reply can't be delivered registers nothing.
- **Why:** a normal `Closed` and a natural client exit emitted no effect, so the
  executor's channel for each leaked. Over 10,000 connect and close cycles the daemon's
  RSS went from 2.8 to 24.8 MB; 10,000 connects cancelled before the answer went from
  2.9 to 25.8 MB. With the fix: 2.8 to 3.1 MB and 2.9 to 3.0 MB.
- **Rejected:** the executor deciding for itself when a connection or client is dead
  (a second owner of the lifecycle, so two places to keep in step); a
  periodic sweep (polling, and an idle daemon must have no timer).
- **Open:** a connection that drops its receiver without sending `Closed` stays
  registered until the hub next sends to it. `http/ws.rs` sends `Closed` on every path
  but a panic or the runtime's shutdown, so no machinery was added.

### An unwatched window's close broadcasts `sessionsChanged`, once per input

- **Decided:** 2026-10-22, tech lead, in the brief for the hub refactor (p51, commit
  97f8c39). Adds to "One reporter per endpoint for renames and session changes" above
  and answers the gap in "The web prunes its tabs against `sessions` listings" below
  ([daemon-core.md §4.5](daemon-core.md#45-control-clients)).
- **What:** when the endpoint's reporter hears `%window-close` or
  `%unlinked-window-close` for a window the hub holds no entry for (no watch is on it,
  in any phase), the hub sets a flag; the reporter's `%sessions-changed` sets the same
  flag; and `handle` broadcasts one `sessionsChanged` at the end of an input that set
  it. Closing a watched window is still `windowClosed` with no relist, and a client
  that isn't the reporter sends nothing. The web already relists on `sessionsChanged`,
  debounced, and prunes against the listing. Measured on real tmux 3.4:

  | Action | `sessionsChanged` sent, before → after |
  |---|---|
  | kill an unwatched window | 0 → 1 |
  | kill a 4-window session | 1 → 1 (not 5) |
  | move an unwatched window | 0 → 1 |
  | kill the watched window | `windowClosed`, no relist |

  Throwaway unit probes also showed the non-reporting client sends none, and two
  separate chunks send two.
- **Why:** the hub tracks a window only while a watch is on it, so a kill under a tab
  that isn't on screen sent nothing, and the tab was found dead only on the next connect
  or sheet. The close notification already reaches the reporter; a flag turns it into
  the hint the web's listing needs, with no window state and no tmux command. The flag
  is cleared per input so one kill that closes many windows is one hint.
- **Cost:** "once" means once per input. A burst split across two reads of the pump's
  pipe sends two, which the web's debounce absorbs.
- **Rejected:**
  - A Locate per unwatched window: work and state for windows nobody views, which "A
    watch exists only while its tab is on screen" avoids.
  - A broadcast per closed window: five for a 4-window session.
  - A timed debounce in the hub: a new timer, and the web already debounces.

### `Starting` is folded into `Locating { after, on }`

- **Decided:** 2026-10-22, tech lead, from the structural review (p49), applied in p51
  (commit 97f8c39). Changes the phases of "How ownership and Locate interact" and the
  state diagram of [daemon-core.md §4.2](daemon-core.md#42-windows-owners-and-locate).
- **What:** a window's phases are `Locating { after, on }`, `Bound` and `Orphaned`. `on`
  is the control client the window was found to belong to, which may still be starting
  or waiting out a crash delay; the Locate runs on it once it is `Ready`. `join` always
  goes to `Locating` with `on` set, and the loop in `client_ready` that moved waiting
  windows out of `Starting` is gone, because `learned` and `located` already redo its
  server check. `on` moved from the Locate record into the phase, so "`on` is set only
  while locating" holds by construction and the `on = None` resets in `bind` and
  `release_windows` are gone. `Window::client()` (the owner when `Bound`, `on` when
  `Locating`, none when `Orphaned`) replaces four hand-written matches. About 24 lines
  fewer for `Starting` alone.
- **Why:** `Starting` was a `Locating` window with a client to wait for, kept as a second
  phase beside a separate `on` field that had to be cleared by hand wherever a window
  left the phase. One phase carrying `on` has one set of exits, and the field cannot
  outlive the phase. Forcing the respawn's "awaited" check to false fails the two crash
  tests, so the tests cover the fold.
- **Rejected:** keeping `Starting` as its own phase.

### Reserved credit stays a counter, with a debug check

- **Decided:** 2026-10-22, tech lead, from the structural review (p49), applied in p51
  (commit 97f8c39). The brief was to derive each connection's reserved credit from the
  work in flight instead of keeping a counter, unless that cost more than about 50 ns
  per chunk; it did ([daemon-core.md §4.6](daemon-core.md#46-credit-and-the-outbox)).
- **What:** `Conn.reserved` stays a counter. Debug builds derive what it must be (a
  capture reservation per watch a snapshot in flight reserved for and per history
  capture in flight, plus the listing's) and `debug_assert_eq!` it for every connection
  at the end of each `handle` (`check_reservations` in `credit.rs`). Taking out the
  `unreserve` in `listed`, or the ones in `abandon`, each fails a hub test.
- **Why:** measured in a release build pinned to one core, the median cost of one
  `%output` chunk through `State::handle`:

  | Scenario | Counter | Derived |
  |---|---|---|
  | one connection, one watch | ~210 ns | ~227 ns (+17) |
  | 3 connections × 2 watches | ~298 ns | ~375 ns (+77) |
  | same, 20 inputs in flight per client | ~298 ns | ~625 ns (+325) |

  Deriving scans every client's pending work for every watch on every chunk, so it
  costs most when the box is busiest.
- **Rejected:** deriving it on the output path (above); scanning once per chunk (still
  about +100 ns loaded); a `State`-level map of captures (a second structure mirroring
  `pending`).

### Other moves of the hub refactor

- **Decided:** 2026-10-22, tech lead, from the structural review (p49), applied in p51
  (commit 97f8c39). Hot-path cost measured against a clone of the previous commit: at
  parity (+0 to 10 ns per chunk).
- **What:**
  - **`tmux/reply.rs`.** Each format tmux is asked to print sits beside the parser of its
    reply, moved out of `command.rs`, `session.rs` and `oneshot.rs`; `ServerInstance`
    has `FromStr`, which the hub's `parse_server` uses. A pure move: the commands'
    text is byte-identical, and the fixture replays, which require the exact lines,
    pass. The formats were not changed to `#{pid}-#{start_time}`, which would mean
    re-recording every fixture.
  - **`tmux/fake.rs` and hub tests that assert ops.** The hub tests' fake tmux splits
    lines into commands, decodes `display-message` and `capture-pane`, expands formats
    from a lookup of tmux variables and frames replies
    ([daemon-core.md §8](daemon-core.md#8-testing)). The 22-field state row and the 33
    command-string literals in the tests are gone; assertions build their op lines with
    `command::op`. The review's probe, quoting the Locate target, used to fail 22 of 23
    hub tests and now fails none.
  - **One `due()`.** The control clients' timers come from one `due()`, which feeds
    both `next_deadline` and `timers`. Snapshot spacing stays out of it: it has no timer
    action of its own (the input that crosses it is dirty, and reconcile snapshots), and
    putting it in made `timers` scan every watch on every chunk, +35 to 45 ns per chunk
    (3 connections). It is chained into `next_deadline` only, and its formula now
    lives once, in `Watch::spaced_until`, which reconcile's eligibility also uses.
  - **`state.rs` split further** into `credit.rs`, `names.rs` and `time.rs`, pure
    moves; `state.rs` went from 1,140 to 952 lines. Credit and names alone left it at
    1,024.
  - **Smaller:** `quote` and `named` share `command::literal`; the auth store's `read`
    and `read_async` share `loaded`; the real-tmux tests share `setup`, `SERIAL`,
    `tmux()` and `socket()` in `tests/support/tmux_server.rs` (`hub_real`'s socket prefix
    became `tether-test-`) and use `hub::INBOX` instead of a literal 128.
- **Why:** each removes a place where two components had to agree (a format and its
  parser, a command's spelling and a test's copy of it, two encodings of the spacing
  rule) or a file that held three concerns.
- **Rejected:**
  - Narrowing `FromConn::Client`: it needs a second enum mirroring `ClientMsg`, or a
    split wire enum that changes the generated TypeScript, just to remove one ignored
    match arm.
  - Spacing inside `due()` (above).

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
    tether may start before it. The earlier daemon exited when LocalAPI was absent;
    the browser-auth daemon instead starts and retries its tailnet-state cell in the
    background.
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

### The paste directory is emptied after the port is bound (superseded)

- **What:** the daemon binds `127.0.0.1:<port>` first, then empties
  `$XDG_RUNTIME_DIR/tether/` ([daemon-core.md §3.4](daemon-core.md#34-commands-commandrs)).
- **Why:** a daemon started by mistake emptied the directory and then failed to bind,
  deleting a running daemon's in-flight paste files. Found in the live run.
- **Rejected:** emptying first, as the build did.
- **Superseded:** the browser-auth runtime uses a private runtime directory and two Unix
  sockets. It holds the runtime lock, binds both sockets, then empties only `paste/`
  ([daemon-core.md §3.4](daemon-core.md#34-commands-commandrs)).

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

### The web prunes its tabs against `sessions` listings

- **Decided:** 2026-10-22, tech lead, from the web boot build (p45, commit b115c2b).
  Changes the design note of "Closure is a broadcast fact" above, which had tabs close on
  `windowClosed` and `serverExited` only, and corrects the daemon-core spec, which said
  `windowClosed` "closes every tab on the window, watched or not"
  ([plan.md](plan.md#reconnect)).
- **What:** `windowClosed` reaches only windows that have a watch, because the hub holds
  a window only while a watch is on it. The web asks each host for a listing on every
  connect and prunes its tabs against it, and against every later listing; a tab whose
  `WindowRef` isn't in the listing closes.
- **Why:** only the tab on screen is watched (the resource budget: nothing held for
  panes nobody views). Running the build against a real daemon, a window killed under a
  tab that wasn't on screen sent nothing, and its tab closed only once it was selected
  and watched. The listing is the one answer that covers every window, and the web
  already fetches it for the sheet.
- **Rejected:** the daemon tracking every window of every open tab (a Locate and
  state per unwatched tab, which is what "a watch exists only while its tab is on
  screen" avoids); watching every tab (votes and resizes for windows nobody sees);
  leaving it, so a dead tab is found on selection (the pill claims a window that is
  gone); the daemon diffing listings to send `windowClosed` (it would keep a copy of
  the listing).
- **Extended 2026-10-22 (p51):** the daemon now sends `sessionsChanged` when tmux closes
  or moves a window nobody watches, so the web's relisting follows the kill; see "An
  unwatched window's close broadcasts `sessionsChanged`, once per input" above.

### A host entry carries its base URL

- **Decided:** 2026-10-22, tech lead, from the web boot build (p45, commit b115c2b). Adds
  `baseURL` to the `hosts` message and to `boot.hosts`
  ([ios-shell.md](ios-shell.md#boot-and-host-payloads)).
- **What:** a native host entry is `{ id, name, baseURL, enrolled }`, `baseURL` being
  `https://<magicdns-name>`. The web derives the WebSocket URL from it and never builds a
  URL from `name`.
- **Why:** `name` is a label (`/auth/info.name` is the config key `name`, else the
  machine name), not the host's DNS name, and the build had to guess
  `wss://<name>/ws`. `HostStore` already keeps `baseURL`.
- **Rejected:** the web turning `name` into a URL (breaks when the label differs from
  the MagicDNS name).

### `boot.tabs` is `SavedTab`, and `settings` is a free record

- **Decided:** 2026-10-22, tech lead, from the web boot build (p45, commit b115c2b), whose
  shapes these are. Both go into `Bridge.swift` and its fixtures
  ([ios-shell.md](ios-shell.md#boot-and-host-payloads)).
- **What:** `SavedTab` is `{ id, host, window: WindowRef, name }`. `settings` is an
  object of JSON values, with no keys defined yet.
- **Why:** a saved tab carries what the web needs to restore it without asking the
  daemon, and its title. No setting exists yet, so a typed struct would be invented
  fields; the first setting defines its key.
- **Rejected:** a typed `Settings` struct now.

### Native persists which tab was active

- **Decided:** 2026-10-22, tech lead, from the web boot build (p45, commit b115c2b). Extends
  "Native keeps the saved tab list" above; the field names are the design's pick
  ([ios-shell.md](ios-shell.md#boot-and-host-payloads)).
- **What:** `saveTabs { tabs, active }` and `boot.active` carry the id of the tab on
  screen; at boot it is the active tab, and an absent or unknown id means the first.
- **Why:** the build opened on the first tab, so the app reopened somewhere other than
  where Jimmy left it. Native already stores the list, so the id costs one field.
- **Rejected:** always the first tab (the build's default); the web keeping the id in
  its own storage (the same unverified `localStorage` survival that put the list in
  native).

### Tab titles follow `windowRenamed`

- **Decided:** 2026-10-22, tech lead, from the web boot build (p45, commit b115c2b).
- **What:** a tab's title is its window's name and is updated by `windowRenamed`; the
  new name is saved with the tab.
- **Why:** the build took the title from the listing when the tab opened and never
  changed it, so a rename in tmux left the pill stale, and the daemon already sends the
  rename.
- **Rejected:** a title fixed at open.

### The tmux size sits inside every safe-area inset, and a `keyboard` viewport keeps the full-screen insets

- **Decided:** 2026-10-22, tech lead, from the web fixes (p52, commit 0342137). Settles
  the open question in [ios-shell.md](ios-shell.md#keyboard-geometry) and drops the
  "vertical safe area" open risk.
- **What:** `collapsedHeight` is the web view's height with the keyboard hidden, which
  is the full screen, safe-area bands included. The web computes the tmux size from it
  and the width less the safe area: the columns from `width` less the left and right
  insets, each side at least 4 px (`--term-edge`); the rows from `collapsedHeight` less
  the top and bottom insets, the tab bar and the suggestion strip. Every `viewport`,
  `keyboard` ones included, carries the `safeArea` of the full-screen layout.
- **Why:** the sizer and the CSS padding (`--safe-*`) both use the numbers in
  `viewport`. A web view that ends above the keyboard has a bottom inset of 0 in its
  own `env()`, and a `rotation` viewport with that value would give the rows of a
  layout with no home-indicator band while the keyboard is up. The 4 px edge keeps text
  off the bezel in portrait, where the side insets are 0. It costs one column there
  (56 to 55 at 393 pt wide) and none in landscape, where the insets already exceed it.
- **Rejected:** live insets in a `keyboard` viewport (the bottom-inset case above); a
  wider edge (another column on a 393-pt phone).
- **Changed 2026-10-22 (p66):** the rows no longer subtract the suggestion strip; see
  "The suggestion strip pans the terminal like the keyboard and never resizes tmux"
  below.

### The keyboard pan belongs to the renderer and follows the cursor

- **Decided:** 2026-10-22, tech lead, from the web fixes (p52, commit 0342137). Fills
  in the pan that [plan.md](plan.md#layout) and [ios-shell.md](ios-shell.md#keyboard-geometry)
  promise.
- **What:** `term/xterm.ts` watches the terminal area's height and the cursor and
  slides the terminal up by `cursorPan` (`term/size.ts`): just far enough that the
  bottom of the cursor row meets the bottom of the area, never down, never past the last
  row, zero while every row fits. The slide animates only when the area resizes, with
  the keyboard's duration and curve; a cursor move jumps. Measured against a real daemon
  with the keyboard shown: tmux stays 55×44 in portrait and 104×20 in landscape; with
  the cursor on the last row the terminal slid 388 px (44 rows × 16 px less the 316 px
  visible); cursor on row 18 slid 0 and on row 19 slid 4 px; hiding the keyboard slid
  it back to 0.
- **Why:** the keyboard shortens the area without resizing tmux ("never for the
  keyboard", [plan.md](plan.md#product-rules)), so the rows under the keyboard are
  covered and the cursor must stay above them. The area's height already says whether
  the keyboard is up, so the pan needs no flag.
- **Cost:** xterm's scrollbar moves with the slide, so part of it is hidden while the
  keyboard shows.
- **Rejected:** a keyboard flag in `App` driving the pan (the container's height already
  says it); snapping the pan to whole rows (leaves a gap under the cursor row, where the
  plan says "just above").

### The suggestion strip pans the terminal like the keyboard and never resizes tmux

- **Decided:** 2026-10-22, design, from the suggestion strip build (p66). Changes
  [ios-shell.md](ios-shell.md#keyboard-geometry), whose sizing paragraph subtracted the
  strip from the tmux rows, and "The tmux size sits inside every safe-area inset…"
  above, which listed it in the rows.
- **What:** the strip sits under the tab bar, right above the accessory, and shows only
  while the keyboard is up and the tab is live. It shortens the terminal area as the
  keyboard does, and `cursorPan` slides the terminal to keep the cursor row in view.
  The tmux rows are `collapsedHeight` less the top and bottom insets and the tab bar;
  the strip is not in them, and its appearing or going sends no resize.
- **Why:** the strip exists only "while suggestions exist"
  ([plan.md](plan.md#layout)), so counting it would resize tmux whenever chips came or
  went. Resizing for the keyboard is already refused for this reason: a SIGWINCH reflows
  the app and the laptop ([tmux setup](#tmux-setup)). The pan already handles an area
  shorter than the terminal, so the strip needs no new mechanism.
- **Cost:** with the keyboard up in landscape, about 50 px of terminal were left before
  the strip and about 8 px are left with it, and the cursor row can be clipped. That is
  open: one option is to put the chips in the bar row in landscape, which needs a
  design decision.
- **Rejected:** subtracting the strip from the tmux rows, as the spec said (the resizes
  above).

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

### No `Origin` check (native lane only)

- **Decided:** 2026-10-21, design (auth); superseded for browser/node requests by
  [browser authentication](#browser-authentication-enrolled-tailnet-nodes).
- **Why:** origin checks stop cross-site hijacking of ambient credentials, and tether
  has none on the native lane: no cookies, and a bearer token a foreign page can't
  read. Enrolled node requests carry ambient node identity and now require exact
  Origin and fetch metadata checks.

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

### The auth error codes and `/auth/info.name`, as built (error contract superseded)

- **Decided:** 2026-10-22, tech lead, documenting the p40 build.
- **What:**
  - The original errors besides `bad_code` and `auth_required`: `forbidden` (403, the Tailscale
    check), `bad_request` (400, 415, 422, a body that isn't the route's JSON),
    `internal` (500, the enrolment transaction failed), and `auth_unavailable`
    (503). Browser admission adds `bad_origin`, `node_refused`, `not_enrolled` and
    `identity_unavailable` in the shared `HttpError` contract
    ([auth.md](auth.md#endpoints), [fs.md](fs.md#errors)).
  - `/auth/info.name`, and with it `welcome.host.name`, is the config key `name`, else
    the machine name from tailscaled's MagicDNS name. No spec named a source.
  - At that point the config keys included `port` (default 7850), `name`, and
    `[tmux] program, socket_name, socket_path`; browser auth removes `port`, which
    older config files continue to parse as an ignored key ([plan.md](plan.md#config)).
- **Rejected:** none recorded; the spec was silent.

### The startup Funnel check reads LocalAPI (superseded)

- **Decided:** 2026-10-22, design (p40).
- **What:** the earlier port-based daemon read `/localapi/v0/serve-config` at startup
  and refused to run if Funnel was on for its port. This rule is superseded by the
  browser-auth canonical-origin check: it reads Serve config from the shared cell,
  refuses Funnel for node admission, and does not make LocalAPI availability a startup
  gate.
- **Why:** the JSON is the same as `tailscale serve status --json`, there is no
  subprocess to run on an overloaded box, and the client already exists for the login
  allowlist.
- **Rejected:** shelling out to `tailscale serve status --json`.
- **Superseded:** the startup refusal and port-specific check; see
  [browser authentication](#browser-authentication-enrolled-tailnet-nodes).

## File API

Decided 2026-10-22 by design (p53), writing [fs.md](fs.md), revised after the p56
review. The product calls behind it are Jimmy's
([Files](#files-view-and-upload-now-three-write-operations-in-v2)).

### One resolution function that returns a checked descriptor

- **What:** `fs::open` canonicalizes with `realpath`, checks the result against the
  canonical roots component by component, opens with `O_NOFOLLOW | O_NONBLOCK`, then
  reads the descriptor's real path (`/proc/self/fd`, `F_GETPATH`) and checks it again.
  Callers get the descriptor, never a path to reopen. In-root symlinks are followed;
  `..` is resolved by `realpath`, not lexically.
- **Why:** checking the file actually opened closes the check-then-open race for one
  syscall, and v2 writes need a checked parent descriptor anyway. `O_NONBLOCK` keeps a
  FIFO in a repo from pinning a blocking thread.
- **Rejected:** canonicalize-check-open alone (racy, and a later route would be
  tempted to reopen by path); `openat2(RESOLVE_BENEATH)` (Linux only, and refuses
  absolute symlinks that stay inside the root, common in repos); `RESOLVE_IN_ROOT`
  (chroot semantics: an absolute link resolves to the wrong file); lexical `..`
  rejection (wrong after a symlink, and `realpath` already handles it).

### Roots are a scope; the `$HOME` picker shows directory names only

- **What:** the roots keep the file API inside the trees Jimmy picked; they are not an
  authorization boundary, because a device token already runs commands in tmux. The
  picker is a listing scoped to the canonical `$HOME` that returns directories only,
  with no sizes or times. Adding a root or setting `uploads_dir` from the app needs a
  directory strictly below `$HOME`; `config.toml` may name any directory.
- **Why:** stating what the roots protect against (a mis-tap, a crafted symlink, a
  viewer bug) is what makes showing names outside them safe. Confining the app below
  `$HOME` keeps it from widening the scope to `$HOME` itself (`~/.ssh`) or to `/`.
- **Rejected:** a picker that lists files too (reveals more than choosing a directory
  needs); a picker free of `$HOME` (no use case, and `/proc` and `/etc` become
  browsable); `$HOME` as a root from the app (defeats the scope); treating roots as
  security against the token holder (they can't be).

### fs reads `roots` from `config.toml` on every request

- **What:** `roots` and `uploads_dir` are read and canonicalized per fs request, from
  the path `Config::load` resolved at startup, with its missing-file rule. A file that
  exists but can't be read or parsed fails closed as `503 config_unavailable`.
- **Why:** the same reasoning as auth's per-check read: a small file, no watcher, no
  cache to invalidate, and a hand edit applies at once. Re-canonicalizing per request
  also follows a root that is itself a symlink being repointed.
- **Rejected:** loading roots once at startup (a hand edit would need a restart, and
  the daemon's own writes would need an in-memory copy kept in sync); a cache keyed on
  the file's `stat` (an optimisation for a cost nobody has measured).

### Config writes: `toml_edit`, auth's lock, temp file and rename, re-stat before rename

- **What:** writes take the `flock` on `$XDG_STATE_HOME/tether/lock`, `canonicalize`
  the config path to write a symlink's target, edit only `roots` or `uploads_dir` with
  `toml_edit`, write `<name>.tmp` in the same directory, re-stat the original, and
  rename (retrying up to 3 times if it changed). A file that doesn't parse is never
  written; an unwritable target is `409 config_read_only`.
- **Why:** `toml_edit` keeps Jimmy's comments and any keys a newer daemon wrote;
  following the symlink keeps a dotfiles link intact; the re-stat catches most editor
  saves that land mid-write; one lock for every tether writer is simpler than two.
  Editors that rewrite in place can still race it in a microsecond window; accepted.
- **Rejected:** serializing `Config` with serde (drops comments and unknown keys,
  breaking "an older daemon reads a newer config"); a separate `config.lock` in
  `~/.config/tether` (clutter in a dotfiles directory); renaming over the symlink
  (silently replaces the dotfiles link with a copy).
- **Added 2026-10-22 (tech lead, from the security review p65, fixed in p68): a link to
  nothing is refused, not written through.** A `config.toml` that is a dangling
  symlink, or whose directory (or a directory above it) is one, gets `409
  config_read_only`; the link, its target and the directories on the way are left as
  they were. Before, the file case answered `200` and replaced the link with a regular
  file, and the directory case answered `500 internal`. The web's message for this
  code, "config.toml can't be written on the server", already fits, and reads are
  unchanged.
  - **Why:** a write through the link would create a file, and possibly directories,
    wherever it points (a dotfiles checkout that moved, say), from a tap on the phone.
    Refusing is the answer an unwritable target already gets, and Jimmy can fix the
    link in the terminal.
  - **Rejected:** writing through the dangling link (it creates the target and its
    directories wherever the link points: a file the user didn't make, in a tree the
    app doesn't know); renaming over the link (the rule above: it replaces the
    dotfiles link with a copy).

### Paths ride in the URL path

- **What:** `/fs/list/{*path}`, `/fs/raw/{*path}`, `/fs/dirs/{*path}`, each segment
  percent-encoded. Paths on the wire are absolute UTF-8 strings. Path and query
  rejections are answered in the JSON error shape.
- **Why:** AVFoundation sees the file's extension in the URL, and a relative image in
  Markdown resolves against the document's own raw URL with plain URL resolution.
- **Rejected:** `?path=` query strings (no extension in the URL, and the Markdown
  viewer would need its own relative-path joining); root-index-plus-relative paths
  (every caller converts, and `cwd`, `dir` and upload paths are absolute already).

### Non-UTF-8 names are listed but not openable

- **What:** listed with U+FFFD and `utf8: false`, greyed in the web, refused by the
  routes because they can't be named in a UTF-8 path.
- **Why:** they don't occur in Jimmy's trees in practice; the terminal handles them.
- **Rejected:** byte-exact names in base64 on every entry and route (every client pays
  for a case that doesn't occur); hiding them (the directory would look wrong).

### Listings: one scan per page, sorted, paged by offset, nothing kept

- **What:** each page re-reads the directory with names and `d_type`, `stat`ing only
  symlinks and `DT_UNKNOWN` entries, up to 5,000 entries or 1 MiB of names; sorts
  directories first, then case-folded names; and `stat`s the 200 entries on the page.
  Dotfiles are filtered on the server unless `hidden=1`. Link targets aren't
  root-checked until opened. The `$HOME` picker is the same listing, directories only.
- **Why:** sorting needs the whole directory, and holding it between pages would be
  state for a viewer nobody may come back to. A symlinked directory must sort as a
  directory, which `d_type` alone can't tell. Filtering hidden names on the server
  keeps pages full.
- **Rejected:** a server-side cursor or cached listing (memory held between requests);
  `readdir` order without sorting (useless on a phone); a `stat` per scanned entry
  (5,000 syscalls on an overloaded disk for one page); client-side hidden filtering
  (pages with holes); an unpaged picker (up to ~1 MiB of JSON in one response).

### Content types: an extension allowlist that never sends HTML or script

- **What:** one table by extension; HTML, JavaScript, CSS and XML are served as
  `text/plain; charset=utf-8`; SVG as `image/svg+xml`; unknown as
  `application/octet-stream`. The daemon itself sets `nosniff` and `sandbox` on raw
  responses, as the scheme handler also does.
- **Why:** the native player bypasses the scheme handler, so the daemon must send the
  headers; with `nosniff`, the declared type is the only type, so an allowlist makes
  "nothing renders as a page" a property of one table. `<img>` runs no SVG script.
- **Rejected:** `mime_guess` (its broad table includes `text/html` and script types,
  and the allowlist is the point); content sniffing (reads every file's first bytes
  on a busy disk, and `nosniff` exists to stop it); serving SVG as text (the image
  viewer would need to rasterize it itself).

### Raw: single Range, strong ETag from `stat`, exact length, no `304`

- **What:** `bytes=a-b | a- | -n` gets `206`; a range list or an unparsable header gets
  the whole file; `416` past the end. ETag `"<ino>-<size>-<mtime_ns>"`, honoured by
  `If-Range`. The body is exactly the length `fstat` gave at open; a file that shrinks
  mid-stream aborts the response. A producer task feeds the body through a channel of
  one chunk, and a send that waits 30 s aborts the response. Sent pages are dropped
  with `posix_fadvise(DONTNEED)`.
- **Why:** the viewers and AVFoundation send single ranges only; an ETag from `stat`
  costs nothing and changes when the file does. Without the send deadline, a paused
  player holds its slot, and the daemon's shutdown, forever, because hyper stops
  polling a body whose socket is full. Without `DONTNEED`, a streamed video fills the
  unit's page cache and throttles every task in it at `MemoryHigh`.
- **Rejected:** multipart ranges (no client sends them); a content-hash ETag (reads the
  whole file); `If-None-Match` and `304` (WebKit doesn't cache custom-scheme
  responses, so nothing would send it); tower-http's `ServeFile` (plan.md keeps
  `/fs/raw` custom so the root check and the limits are tether's).
- **Amended** by [Raw drops the page cache from the response start](#raw-drops-the-page-cache-from-the-response-start):
  the drop covers everything read so far, not each chunk.

### Uploads: raw body, server-chosen UTC name, part file then no-replace rename

- **What:** `POST /fs/upload?name=…` with the bytes as the body, 128 MiB cap, one at a
  time, a 30 s idle timeout. The file is `YYYYMMDD-HHMMSSZ-xxxx.<ext>` in
  `uploads_dir`, written as a 0600 `.tether-upload-*.part` file, flushed with
  `fdatasync` and `DONTNEED` every 8 MiB, and renamed without replacing; no final
  `fsync`. `uploads_dir` is created before the roots are read. The response is
  `201 { path, size }`.
- **Why:** a raw body streams straight to disk with nothing to parse; taking only the
  extension from the client's name keeps paths, quotes and dotfiles out of the folder
  and out of the path typed into the terminal; the part file means an agent never sees
  a half-written photo at the final name. The periodic flush bounds the dirty pages
  charged to the unit on a disk it reaches at idle priority. UTC needs no time-zone
  crate.
- **Rejected:** multipart (a parser and a crate for one file); base64 in JSON (+33% and
  buffering); keeping the client's file name (`IMG_0001.jpg` collides and can carry
  shell metacharacters); local time (needs `chrono` or `jiff`; the `time` crate can't
  read the local offset in a multithreaded process on Linux); a final `fsync` (the
  phone still has the photo); 2+ uploads at once (native sends one at a time, and each
  costs a hyper read buffer).
- **Amended** by [Uploads flush every 2 MiB, and the ceiling counts them](#uploads-flush-every-2-mib-and-the-ceiling-counts-them):
  the flush interval is 2 MiB, not 8.

### The file API's limits, socket buffers, and the memory ceiling

- **Superseded in part by:** [Blocking lanes](#blocking-lanes).
- **What:** 4 of the 8 blocking threads, 1 scan, 2 raw responses, 1 upload, 64 KiB
  chunks, 10 s slot waits with at most 8 waiting; std file calls in `spawn_blocking`,
  not `tokio::fs::File`. `SO_SNDBUF` and `SO_RCVBUF` of 64 KiB on every accepted
  socket (axum's `ListenerExt::tap_io`). About 3 MB for the file API and 2 MB of kernel
  socket buffers in the ceiling, taking it to ~64 MB; the budget run reads the unit's
  `memory.peak`.
- **Why:** a slow disk must not starve auth or pastes of blocking threads;
  `tokio::fs::File` buffers up to 2 MiB per file; hyper's per-connection buffers (up
  to ~400 KiB) dominate each response's cost. `MemoryMax` charges kernel socket
  buffers, which RSS doesn't show: a stalled loopback reader let 4 MiB queue in one
  sender's buffer on the dev box (`tcp_wmem` max 4 MiB, measured by p56), and the
  WebSockets were never counted either. Each of tether's sockets is the loopback hop
  from `tailscale serve`, where 64 KiB per round trip is over 1 GB/s, so the small
  buffers don't slow the phone.
- **Rejected:** unbounded concurrency (the ceiling has no room); refusing raw requests
  at once when slots are full (AVFoundation and lazy image loads would fail instead of
  waiting a moment); 3 raw slots (no room in the ceiling); the kernel's default
  socket buffers (up to 4 MiB each, uncounted); larger buffers for raw responses only
  (p57, on the reading that the socket runs to the phone; it ends at tailscaled);
  dropping the pages of every file read (evicts pages a build is using: only files
  over 8 MiB).
- **Amended** by [Uploads flush every 2 MiB, and the ceiling counts them](#uploads-flush-every-2-mib-and-the-ceiling-counts-them):
  the file API's share is ~5 MB, not ~3, and the ceiling ~62 MB.

### `dir` on `newWindow` and `newSession` is checked for shape, not roots

- **What:** the connection calls `fs::check_dir`: an absolute path of at most 4,096
  bytes with no NUL that `stat`s as a directory. It is passed to tmux as given. A
  refusal is `error { badRequest }` with a message naming the cause. This replaces the
  root check daemon-core §5.3 named and the pass-through recorded in
  [Daemon service, as built](#dir-on-newwindow-and-newsession-passes-through-until-srcfs-exists).
- **Why:** the roots scope the file API; tmux already runs as Jimmy. The web's
  start-directory prompt (`askDir` in `web/app/app.ts`) offers the tab's cwd or any
  typed path, and the default config has no roots, so a root check would refuse a new
  window in `~`, `/tmp` or any repo not yet added, and a broken `config.toml` would
  block every new window. Passing the path as given keeps a symlinked `~/code` showing
  as `~/code`.
- **Rejected:** checking `dir` against the roots, as §5.3 first said (the failures
  above, for no protection tmux doesn't already bypass); restricting the prompt to
  roots (a product change Jimmy hasn't asked for); passing the canonical path (the
  shell would show the link's target).

### The scheme handler forwards methods and bodies, and answers preflights itself

- **What:** ios-shell.md's proxy forwards `GET`, `POST` (and v2's `PUT`) with their
  bodies and `Content-Type`, and answers CORS preflights for `tether-app://ui`
  without contacting the daemon. It no longer lists `If-None-Match`.
- **Why:** the Settings routes are JSON `POST`s from `tether-app://ui` to
  `tether-app://h-{host}`, which need a preflight, and the daemon answers none
  ([auth.md](auth.md#carrying-the-token)).
- **Rejected:** answering `OPTIONS` in the daemon (it would open a CORS path that
  auth.md keeps shut for browsers on the tailnet).
- **Added** (from the web file-manager run, p62): the handler also sends
  `Access-Control-Expose-Headers: Content-Range, ETag`. The CORS rules let a
  cross-origin page read only safelisted response headers, so without it the web can't
  read a file's size or ETag from a `206`. The gap can't show in dev mode, where the
  Vite proxy makes everything same-origin. Rejected: none recorded.

### Raw drops the page cache from the response start

- **Decided:** 2026-10-22, tech lead, from the file API build (p58, commit ed9c637).
  Amends the `DONTNEED` rule in
  [Raw: single Range, strong ETag…](#raw-single-range-strong-etag-from-stat-exact-length-no-304).
- **What:** after each chunk of a file over 8 MiB, the producer calls
  `posix_fadvise(DONTNEED)` on the range from the response's first byte to the current
  position, not on the chunk.
- **Why:** measured on the dev box (Linux 7.1, ext4, a scope with `MemoryHigh=48M`): a
  per-chunk drop of 64 KiB dropped nothing, because the kernel reads ahead in large
  folios and keeps any folio that extends past the dropped range. A 1 GiB download left
  44.6 MB of page cache and the scope's `memory.peak` at 49.6 MB, past `MemoryHigh`.
  Dropping from the start: `memory.peak` 5.6–6.0 MB, ≤ 260 KB cached while streaming, at
  1.6 GB/s with no extra CPU (1.01 s for 1 GiB).
- **Rejected:** the per-chunk drop (above); dropping to the end of the file (evicts the
  readahead, so the next chunk reads from disk twice).

### Uploads flush every 2 MiB, and the ceiling counts them

- **Decided:** 2026-10-22, tech lead, from the p58 build (commit ed9c637), whose
  measurement the spec had missed. Amends the 8 MiB flush in
  [Uploads: raw body…](#uploads-raw-body-server-chosen-utc-name-part-file-then-no-replace-rename)
  and the ~3 MB file API row in
  [The file API's limits…](#the-file-apis-limits-socket-buffers-and-the-memory-ceiling).
- **What:** an upload runs `fdatasync` and `DONTNEED` every 2 MiB. The upload's row in
  fs.md's memory table includes those 2 MiB of dirty pages, taking the file API from ~3
  to ~5 MB and the daemon's ceiling from ~60 to ~62 MB
  ([daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling)).
- **Why:** dirty pages are charged to the unit and can't be reclaimed until written, so
  they are real memory that the table counted as 0.5 MB. With the 8 MiB flush, a
  120 MiB upload at 60 MB/s held up to 8.2 MB dirty and the scope peaked at 12.9 MB.
  Shortening the interval cuts that to a quarter and makes the row honest; the cost is
  four times as many `fdatasync` waits. The 2 MiB figure is a pick, not yet measured:
  the budget run reads the scope's `memory.peak` during an upload.
- **Rejected:** keeping 8 MiB and counting 8 MiB (the ceiling would pass 64 MB); keeping
  8 MiB uncounted (the measured peak was 12.9 MB against 0.5 MB in the table).

### `main` stops the hub explicitly at shutdown

- **Decided:** 2026-10-22, tech lead, from the p58 build (commit ed9c637). Extends
  [Shutdown waits for the hub's pumps](#shutdown-waits-for-the-hubs-pumps).
- **What:** once `http::serve` returns, `main` calls `HubHandle::stop`, then waits up to
  2 s for the hub task. `stop` makes the hub close its control clients as the last
  handle's drop does ([daemon-core.md §4.7](daemon-core.md#47-public-interface), §7).
- **Why:** axum's graceful shutdown never force-closes a connection. A raw response whose
  reader has paused keeps its connection task, which holds a `Ctx` and so a `HubHandle`,
  past `serve`'s 2 s wait, and the hub ends only when every handle is gone. Measured: a
  SIGTERM with a paused raw stream took 4 s and exited 1 ("the hub didn't end within
  2 s"). With `stop` it takes 2.0 s, exits 0 and closes a live `tmux -C` client cleanly.
- **Rejected:** leaving it (the 4 s, exit 1 above). Nothing else is recorded.

### Codes the file API's spec left open

- **Decided:** 2026-10-22, tech lead, accepting the p58 build's picks (commit ed9c637).
- **What:**
  - An upload body that stalls past the idle timeout, or breaks because the client
    disconnected, answers `400 bad_request`.
  - An `uploads_dir` that isn't absolute or `~/` is reported `ok: false` in `Roots`, and
    an upload answers `409 not_a_directory`.
  - The directory scan cap counts every entry read, including the hidden ones the
    filter then drops (and files, in the picker).
  - A filesystem without the no-replace rename (`RENAME_NOREPLACE`, `RENAME_EXCL`) fails
    the upload with `500 internal` and no fallback.
- **Why:** the first two reuse the nearest existing code rather than add one (a client
  that disconnected can't read the answer anyway). The scan cap exists to bound one
  page's cost, and reading a dotfile costs the same as reading any other entry. A
  fallback for a filesystem without the flag (check then rename) could replace a file,
  which an upload never does.
- **Rejected:** a distinct code for a stalled or broken upload body; a scan cap that
  counts only kept entries (a directory of dotfiles would be read in full for one
  page); a check-then-rename fallback.

### `fs::open` takes a `Scope`; `Want::Parent` waits for v2; `slots.rs` is a module

- **Decided:** 2026-10-22, tech lead, accepting the p58 build's differences from the
  spec (commit ed9c637).
- **What:** `fs::open(&Scope, path, Want)` replaces `fs::open(&[PathBuf], …)`. A `Scope`
  is the canonical directories plus the refusal to answer outside them, with
  constructors for the effective roots, `$HOME` (the picker) and, for completion, `/`.
  `Opened` holds a `File`, not an `OwnedFd`. `Want` has `Dir` and `File`; `Parent`
  arrives with the first v2 write route. `src/fs/slots.rs` holds the fs permits and
  `Slots::blocking`, and is in fs.md's module table.
- **Why:** the picker has to answer `outside_home` where the roots answer
  `outside_roots`, and a slice can't carry that. `Parent` would be dead code until a
  write route exists. The raw producer and the upload writer take an fs slot per chunk,
  so `src/fs/` needs the slots and stays free of axum.
- **Rejected:** building `Parent` now (dead code).

### A symlink out of the roots is listed with its target's size and mtime

- **Decided:** 2026-10-22, tech lead, on the p58 build's question (commit ed9c637).
- **What:** the listing reports a link's target kind, size and mtime without checking the
  target against the roots, so a link to `/etc/passwd` shows that file's size. Opening
  it is `outside_roots`.
- **Why:** roots are a scope, not an authorization boundary
  ([Roots are a scope…](#roots-are-a-scope-the-home-picker-shows-directory-names-only)),
  and a listing returns no contents. The spec already said the listing doesn't check
  each target.
- **Rejected:** hiding out-of-root links from the listing (the p58 build offered it; the
  tech lead kept them listed).

### macOS file paths are written but untested

- **Decided:** 2026-10-22, tech lead, recording the p58 build's gap (commit ed9c637).
- **What:** the `F_GETPATH` descriptor-path lookup and the `RENAME_EXCL` rename carry no
  macOS test. No Apple target is installed on the dev box, and CI builds macOS only at
  release. Another platform fails closed. fs.md lists it as an open risk; the fs tests
  run on the Mac before it is relied on.
- **Rejected:** none recorded.

## Completion

Decided 2026-10-22 by design (p60), writing [complete.md](complete.md), revised after
the p61 review. The product calls behind it are Jimmy's
([Shell integration](#shell-integration)); the route and the cwd source are in
[Completion is HTTP, and cwd comes from tmux](#completion-is-http-and-cwd-comes-from-tmux).

### The request is `{before, after, cwd}`, and a chip only extends what is typed

- **What:** the client sends the input before and after the cursor as two strings,
  and `cwd` or null. Each chip carries `insert`, the literal text typed at the cursor,
  with no control characters; every source matches by prefix, so no chip deletes.
  Changes `{line, cursor, cwd}` in the entry above.
- **Why:** a cursor index needs a character unit both JavaScript (UTF-16) and Rust
  (UTF-8 bytes) agree on; two strings need none. Prefix-only chips make the diff
  against what's typed a plain suffix, which the client sends like typed text, and
  dropping control characters means a chip can never press Enter.
- **Rejected:** `{line, cursor}` (the unit problem); a `shell` field (the client
  can't know the shell; the daemon picks the history file); replace ranges with a
  delete count and fuzzy matches (backspaces through readline and vi modes behave
  differently, and the counts need the same unit agreement).

### History: one file, parsed into a cached index, ranked by entry age

- **What:** one history file, from `[complete] history` or the most recently
  modified default (zsh, bash, fish), its format from its name; the last 1 MiB parsed
  into 10,000 distinct lines scored by `0.5^(age / 200 entries)` per occurrence, held
  in one contiguous buffer, revalidated by `(dev, ino, size, mtime)` on each request.
  Never logged.
- **Why:** a `stat` per request costs nothing, and a re-parse happens once per change;
  entry age ranks without timestamps, which bash doesn't write by default; one large
  buffer goes back to the kernel when the idle drop frees it.
- **Rejected:** reading the file on every request (a 1 MiB parse per keystroke); an
  inotify watcher (tether has no watchers); merging every shell's file (Jimmy uses
  one shell); time-based recency (no timestamps in bash's default format); detecting
  the format from content (plain zsh and bash lines look the same, and only zsh's
  needs unmetafying).
- **Amended 2026-10-22 (p68):** the dedup map holds at most 12,000 distinct lines, and
  command ranking sums the kept lines only; see "History scores at most 12,000
  distinct lines" below. A history chip is inserted as written, unescaped; see "Chips
  are escaped literals…" below.

### The snippet appends history after each command

- **What:** `contrib/shell/tether.bash` runs `history -a` before each prompt;
  `tether.zsh` sets `INC_APPEND_HISTORY`. `TETHER_NO_HISTORY_APPEND=1` opts out.
- **Why:** bash writes history only on exit, so the commands Jimmy ran in open shells,
  the ones he most likely wants again, were missing from the strip.
- **Rejected:** leaving the default (stale suggestions); reading a shell's in-memory
  history (needs a channel into every shell).

### The PATH index uses the daemon's PATH and an mtime check

- **What:** the names in `[complete] path`, else the daemon's own `PATH`, built on
  first use; each request that needs it `stat`s every `PATH` directory and rebuilds on
  any change.
- **Why:** a dozen `stat`s per request is cheaper than any watcher. The user
  manager's `PATH` holds `~/.local/bin` and `~/.cargo/bin` on the dev box but not what
  Jimmy's rc files add (nvm, bun, Go), so installing writes his interactive `PATH`
  into the key.
- **Rejected:** a watcher; the tmux global environment (`/complete` never touches
  tmux); a pane's `/proc/<pid>/environ` (the environment at exec, before the rc files
  change `PATH`).

### carapace runs in its own transient scope

- **What:** under systemd, each run is `systemd-run --user --scope --collect
  --description="tether completion" -p MemoryMax=128M -p TasksMax=64 -p CPUWeight=20
  -p IOWeight=10 -p RuntimeMaxSec=2 -- carapace …`; outside systemd it is spawned
  directly.
- **Why:** measured on the dev box, carapace 1.8.0's RSS is 17–44 MB per run and a
  scope's peak up to 49 MB warm and 74 MB with its 95 MB binary cold in the page
  cache, while the unit's ceiling already sits at its 64 MB `MemoryMax`
  ([daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling)). Scoped, the
  unit's peak rose 1.1 MB per run, for about 27 ms of scope setup inside the 300 ms
  timeout. Its threads also leave the unit's `TasksMax`. The review (p61) found two
  things the bare command needs: the default description is the command line, so
  every run's arguments, the words Jimmy typed, reached the user journal; and a kill
  landing before `systemd-run` execs (5–20 ms after spawn) leaked an empty scope that
  stayed active, which `RuntimeMaxSec=2` reaps and which also bounds helpers that
  outlive a crashed tether.
- **Rejected:** running it in the unit (it alone can exceed `MemoryMax`); raising
  `MemoryMax` (the limit protects the overloaded box, and a 74 MB peak would need it
  doubled); a sub-cgroup with `Delegate=yes` (tether would manage cgroups itself);
  a long-lived carapace process (carapace has no server mode, and one would hold its
  20–40 MB while idle).

### carapace is installed by hand: pinned, checked against checksums, in `~/.local/bin`

- **Decided:** 2026-10-22, design (p60); carried into plan.md and
  [running.md](../running.md#set-up-completion) with the follow-ups to the spec.
- **What:** as Jimmy, never system-wide: carapace-bin v1.8.0's `linux_amd64` tarball,
  checked against the release's `checksums.txt`, with `carapace` in `~/.local/bin`.
  `[complete] carapace` names another binary; otherwise it is `carapace` on the
  `[complete] path` (config keys `history`, `path` and `carapace`,
  [plan.md](plan.md#config)). An upgrade is a deliberate re-pin: the parser's golden
  fixtures run against the new binary first.
- **Why:** carapace's JSON has no stability promise, so the pin and the fixtures are the
  guard against a changed shape. The unit's `PATH` holds `~/.local/bin`, and the checksum
  step costs nothing next to running a downloaded binary as Jimmy.
- **Rejected:** none recorded.

### carapace: run per stem, latest wins, 30-second cache

- **What:** carapace gets the current word cut back to its **stem** (through its last
  `/ = : , @ +`, else `-` for a flag, else empty) and tether filters its values by the
  whole word; the key is `(cwd, cmd, args before the current word, stem)`. Only
  commands in `carapace --list` are run. One runner task owns the child: one run at a
  time, a request for another key kills the run in flight, one for the same key
  waits, and an aborted request kills nothing. Results, timeouts and failures
  included, are cached 30 s in a 64-entry, 1 MiB LRU.
- **Why:** one run serves every keystroke until the stem changes. An empty current
  word, as first written, returns no flags (`git checkout ""` gives refs only; `-`
  gives the 40 flags), nothing after a `/` (`origin/m`) and no multi-part values
  (`chmod u+`); the review (p61) measured all three. Latest-wins matches typing,
  where the older answer is already stale; a runner that owns the child keeps the
  phone's aborts from killing every run. The TTL lets new git branches appear and
  stops a command that always times out from costing 300 ms per keystroke.
- **Rejected:** an always-empty current word (above); passing the whole word and
  keying on it (a run per keystroke); queueing runs (a stale run delays the fresh one
  by up to 300 ms); runs owned by their request (aborts kill them, so fast typing
  never gets chips); an LRU with no expiry (branches go stale); trying every command
  (a scope and a process for every unknown command); routing every word with a `/` to
  paths (`git checkout origin/m` needs carapace).
- **Amended** by [Completion, as built](#completion-as-built): a request whose key is
  cached kills no run.

### Completion takes two blocking slots, and the unit pins glibc's mmap threshold

- **Superseded in part by:** [Blocking lanes](#blocking-lanes).
- **What:** an index slot (history, PATH) and a directory slot (`check_dir`,
  listings), each permit held inside its blocking closure.
  `GLIBC_TUNABLES=glibc.malloc.mmap_threshold=131072` in the unit.
- **Why:** a listing stuck on a hung mount holds only the directory slot, so history
  and commands keep working and threads don't pile up. glibc raises its dynamic mmap
  threshold after the first large free, so later indexes landed in the heap and
  stayed resident after the idle drop (checked with a C probe on the dev box's glibc:
  without the tunable the second 1.1 MiB block came from the heap, with it every one
  was mmapped).
- **Rejected:** one shared slot (a hung listing stops every source); `check_dir`
  outside any slot (stuck threads pile toward the pool's 8); `malloc_trim` or
  `mallopt` (an `unsafe` FFI call under `#![forbid(unsafe_code)]`).
- **Scope, found in the p63 build:** the tunable reaches only the glibc binary that
  `cargo install` builds and the unit runs. The Linux release binaries are static musl
  (`release.yml`) and ignore it; musl's allocator is unmeasured. With the tunable the
  daemon's anon RSS after an idle drop was 1.51 MB (0.33 MB above baseline); without it
  1.80 MB (1.39 MB above). complete.md, plan.md and running.md say so.

### Path chips list names in any readable directory

- **What:** path completion opens the directory with `fs::open` and scope `/`, and
  returns names only.
- **Why:** the roots keep file contents and viewer bugs inside the trees Jimmy
  picked; completion reads no contents, and the shell's own Tab already lists any
  directory. Scoping it would break completion in the common places.
- **Rejected:** the effective roots (no completion in `~`, `/tmp` or a repo not yet
  added; the default config has no roots); `$HOME` plus the roots (still none in
  `/tmp` or `/etc`, for no protection, since only names are returned).

### Completion state is dropped after 5 idle minutes

- **What:** one timer, re-armed by each request, frees every index and cache 5 minutes
  after the last request.
- **Why:** the idle budget is ~5 MB with no phone connected, and completion can hold
  ~11 MB; one wakeup per idle period keeps the box quiet.
- **Rejected:** keeping the indexes for the process's life (breaks the idle budget);
  dropping when the last WebSocket closes (`complete` doesn't see the hub's
  connections, by design).

### The snippet: OSC 133 from prompt hooks and `PS1`, plus OSC 7

- **What:** D, A and OSC 7 from the first prompt hook; B appended to `PS1` by the last
  hook, re-added each prompt; C from `PS0` (bash) or `preexec` (zsh); raw OSC with
  BEL. The client prefers the OSC 7 path of the current prompt over `watching`'s cwd.
- **Why:** prompt hooks see `$?` before anything else changes it; prompt themes
  rebuild `PS1` in their own hooks, so B must be re-added after them; `PS0` gives bash
  a pre-exec point with no `DEBUG` trap. OSC 7 at the prompt is current at once, where
  tmux's subscription lags a `cd` by up to a second; tmux's cwd stays the fallback,
  so completion still works without the snippet.
- **Rejected:** a `DEBUG`-trap preexec (bash-preexec: heavier, and it competes with
  other traps); wrapping the marks in tmux's DCS passthrough (not needed: control mode
  sees them raw); OSC 7 as the only cwd source (already rejected above: no cwd without
  the snippet or inside TUIs).
- **Amends** [Completion is HTTP, and cwd comes from tmux](#completion-is-http-and-cwd-comes-from-tmux):
  tmux's cwd stays the source without the snippet, but an OSC 7 from the current
  prompt is now preferred.
- **The bash wrapper** makes an existing `PROMPT_COMMAND` an array on bash 5.1+ and
  joins it with newlines before that: joined with `;`, one ending in `&` broke every
  prompt and one ending in a comment swallowed the B hook (p61).

### Completion, as built

- **Decided:** 2026-10-22, design, documenting the completion build (p63) and the web
  file manager run (p62). Changes [complete.md](complete.md) where the spec was silent
  or said otherwise.
- **What:**
  - **The slab is in the ceiling.** The `PATH` scan and directory listings leave about
    2.4 MB of reclaimable dentry and inode slab charged to the unit. complete.md's
    memory table has a row for it (completion ~11 to ~14 MB) and the daemon's ceiling
    goes from ~62 to ~65 MB ([daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling)),
    about 1 MB past `MemoryMax`.
  - **A cached key kills no run.** The runner is asked only after the cache misses, so
    a request whose answer is cached leaves the run in flight for another key going.
    The spec said any other key kills it.
  - **Dedup keeps the first chip whole.** A carapace chip with the same `insert` as a
    history chip is dropped with its description and trailing space.
  - **`~` and `=` stay unescaped** in a path chip's `insert`, so a name starting with
    one, completed at the start of a word, is expanded by the shell.
  - **A long `cwd` is `413`, not `400`.** The 4 KiB body cap is checked before the
    4,096-byte `cwd` cap, and the body holds more than `cwd`. A body that isn't the
    route's JSON gets axum's status (415, 422 or 400) with `bad_request`, as fs's
    routes do.
- **Why:** the slab is memory the unit is charged for, and the table without it
  promised a margin the unit didn't have. A cached request needs no run, so killing
  one for it would only throw away work. The other three are what the code does and
  what the order of its checks gives; nothing better was found to change them to.
- **Rejected:** leaving the slab out because it is reclaimable (the budget run reads
  `memory.peak`, which includes it, and it counts toward `MemoryHigh`); the other
  items: none recorded.
- **Changed 2026-10-22 (p68):** `~` and `=` are now escaped everywhere, and commands
  are escaped too; see "Chips are escaped literals…" below.

### Chips are escaped literals, with `~` and `=` escaped everywhere

- **Decided:** 2026-10-22, tech lead, from the security review of the completion build
  (p65), fixed in p68. Reverses the "`~` and `=` stay unescaped" item of "Completion,
  as built" above, and extends the path chips' escape set to commands and carapace
  values ([complete.md](complete.md#escaping)).
- **What:**
  - One encoder, `context::literal`, writes every command, path and carapace `insert`;
    `chip()` applies it, so no source can skip it. It backslash-escapes every ASCII
    character outside `[A-Za-z0-9._+,:@%/-]`; non-ASCII characters stay as they are.
    `~` and `=` are escaped wherever they sit in the name.
  - History chips are the line as written, unescaped: they are shell syntax Jimmy
    typed.
  - The lexer reads a leading `~` that was escaped or quoted as `./~`: `\~x` and
    `'~'/s` mean the files `./~x` and `./~/s`, not a home directory.
- **Why:** the first build escaped only paths, and left `~` and `=` out of the set. The
  review ran what a chip typed:
  - **Commands:** an executable named `p65x;printf P65_INJECTED` was completed
    unescaped, and running the line printed `P65_INJECTED`: the `;` ended the command.
    Command names need the same escaping as file names.
  - **`~` and `=`:** bash expands `~` after `=` or `:` in an argument too (`echo
    a=~root` printed `a=/root` on bash 5.2); zsh expands a leading `=cmd`, and with
    `MAGIC_EQUAL_SUBST` a `~` or `=` after `=` or `:`; bash's own Tab escapes both. A
    file named `~root`, `a=~root` or `=ls` completed bare ran as something else. The
    `bash -c` read-back test checks 24 hostile names through command, path and carapace
    chips and fails if `~` or `=` rejoin the safe set.
  - **The lexer rule:** without it, a line holding `\~x` was read back as the home
    directory `~x`, and the next request listed `$HOME` instead of the directory it
    meant.
  - **History:** a history line is shell syntax Jimmy typed, with its own quoting and
    operators, so it goes in as written; escaping it would change the command he ran.
- **Cost:** names like `foo~` show as `foo\~` on the line. zsh is covered by its
  documented rules, not by a run: the dev box has no zsh
  ([complete.md](complete.md#open-risks)).
- **Rejected:** `~` and `=` in the unescaped set, as the first build had them (a name
  starting with one was expanded by the shell, and so was one after `=` or `:`);
  leaving commands unescaped (the `;` above); escaping history lines (shell syntax, as
  above). Other encodings: none recorded.

### History scores at most 12,000 distinct lines

- **Decided:** 2026-10-22, tech lead, from the security review of the completion build
  (p65), fixed in p68. Amends the memory side of "History: one file, parsed into a
  cached index…" above ([complete.md](complete.md#history)).
- **What:** entries are read newest first, and the first 12,000 distinct lines (the
  10,000 kept plus a margin of 2,000) get a score; an older entry only adds to a line
  already scored. The word index has one entry per distinct first word of the kept
  lines, pointing into them, with no copied text, so command ranking sums the scores
  of the kept lines only. Which 10,000 lines are kept does not change: a line left out
  is, at its newest, at least 2,000 entries older than each of the first 10,000
  scored, a line's weights sum to at most 289 times its newest one, and 289 × 2^(-2000/200)
  is below 1. The proof is in the comment on `SCORED` in `src/complete/history.rs`.
- **Why:** the map, and the per-line structures built from it, grew with the file's
  distinct lines, and a 1 MiB read of short lines holds about 150,000 of them. On the
  reviewer's file (149,796 `hNNNNN` lines, 1,048,572 bytes), release build, with the
  unit's glibc tunable, measured by the transient scope's `memory.peak`:

  | Build | Peak memory rise | `VmHWM` rise | Request time |
  |---|---|---|---|
  | before | 17.6–18.8 MB | 16.6–17.2 MiB | 67–70 ms |
  | with the cap | 1.5–2.0 MB | 0.9–1.0 MiB | 23–24 ms |

  The worst case with the cap is 10,400 lines of 101 bytes, the largest kept index:
  2.9 MB on the first parse and 3.9 MB on a rebuild with the old index held, within
  complete.md's ~4 MB history allowance. The dedup map is at most 12,000 entries, about
  0.4 MB.
- **Checked:** a throwaway comparison with the uncapped ranking on random histories
  gave 40 of 40 identical rankings, then was deleted. With a margin of only 50, 3
  rounds differed, so the comparison does catch a wrong cap.
- **Rejected:** leaving the map unbounded (the table above); a margin of 50 (the
  comparison above found rankings that differ).

### Parser errors are logged by kind and position, never by message

- **Decided:** 2026-10-22, tech lead, from the same review (p65), fixed in p68.
  Extends "Logs carry framing metadata only" above to completion
  ([complete.md](complete.md#logging)).
- **What:** a carapace JSON failure logs one of four fixed phrases (bad syntax, an
  unexpected shape, cut short, a read error) and the line and column, as "an
  unexpected shape at line 1, column 57". serde's own message is never logged. Every
  other log line in `src/complete/` and `src/fs/` was checked: none logs a parser's
  message, and config parse errors already log a line number only.
- **Why:** serde's `Display` quotes the input it choked on, and carapace's output can
  echo the words Jimmy typed. With `RUST_LOG=debug`, a typed word inside malformed
  JSON reached the debug line and the `--list` warning, against the rule that typed
  text is never logged.
- **Rejected:** logging serde's message (above). Other options: none recorded.

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

## Blocking lanes

- **Decided:** 2026-10-22, tech lead (p72, `a5e231c`).
- **What:** the Tokio blocking pool has 8 threads split into four lanes: fs 4 (10 s
  wait, 8 waiting callers shared across fs slots and blocking calls), index 1 (300 ms),
  dir 1 (300 ms), auth 2 (10 s, no waiter cap). Every blocking call uses its lane;
  Tokio's `fs` feature is disabled. `PermitPool` owns route slots, the shared waiter
  budget and an optional deadline; fs scan/raw pools share the fs lane queue, and the
  shell owns named 4-slot/16-waiter limits with no queue deadline. A lane permit stays
  with its blocking closure until work ends. A panic returns `busy`.
- **Why:** a hung filesystem mount must not consume threads used for authentication. Auth waiters are
  uncapped because device checks arrive in bursts, such as a thumbnail grid. Directory
  checks share one lane because paths supplied by users may name hung mounts;
  fs slot waiters count against the same bounded queue as fs blocking work.
- **Rejected:** one shared pool, which lets hung filesystem work starve auth; a separate
  `newWindow` lane, which would add another pool share for the same directory checks;
  duplicating the slots-plus-waiters rule with route-specific semaphore pairs; listing
  individual `tokio::fs` APIs as forbidden, instead of disabling the feature.

## Shared HTTP error contract

- **Decided:** 2026-10-22, tech lead (p72, `a5e231c`).
- **What:** every route refusal uses `proto::HttpError` and the JSON body
  `ErrorBody { error: HttpError, reason?, node? }`. Browser admission adds
  `bad_origin`, `node_refused`, `not_enrolled` and `identity_unavailable` to that
  shared type. `http::Refusal` maps the code to one status table;
  it preserves axum's 400/415/422 JSON-rejection status, maps oversized bodies to 413
  `too_large`, adds `Retry-After: 1` to `busy` and `Content-Range` to `bad_range`, and
  maps auth failures to HTTP errors; WebSocket auth failures have their own close-code
  mapping.
- **Why:** route handlers share one wire contract, status mapping and auth mapping.
- **Rejected:** separate refusal builders and duplicated HTTP/WebSocket auth-code maps;
  treating an oversized enrolment body as generic `bad_request`.

## Shared file primitives

- **Decided:** 2026-10-22, tech lead (p72, `a5e231c`).
- **What:** `files::Stamp`, `Dir`, `Temp`, the state-directory lock and TOML error-line
  extraction serve auth, config writes, uploads, history, PATH and file listings. `Temp`
  has no `Drop` cleanup; callers clean up explicitly on a blocking lane, and the upload
  part-file startup sweep removes leftovers.
- **Why:** cleanup can block on a hung mount. A lane may refuse work and drop its
  closure on the runtime thread, so `Drop` must not unlink a temp file there.
- **Rejected:** unlinking from `Drop`, which can block the runtime thread; keeping stamp,
  lock and temp-write implementations duplicated in `fs` and `auth`.

## No shared base32 helper

- **Decided:** 2026-10-22, tech lead (p72, `a5e231c`).
- **What:** auth's Crockford enrolment-code and lowercase host-id encodings, and paste-name
  encoding, remain separate.
- **Why:** the copies encode different alphabets/values and express different
  contracts.
- **Rejected:** a helper crossing `fs` and `auth`, which reintroduces their dependency;
  a nearly empty shared module that only hides two purpose-specific encoders.

## Browser/mobile client direction and portable design record

- **Decided:** 2026-10-22, Jimmy (layout approval and mobile local-draft requirement).
- **What:** support desktop browser, mobile browser, and native iPhone. Promote
  the [client contract, mockup, and research](client/README.md) into this repository.
  That contract supersedes conflicting navigation/layout rules in the original plan.
  Desktop has a three-icon rail; mobile prioritizes terminal space and ordinary
  browser keyboard input. Both mobile clients need local multiline drafts while
  the keyboard is open. Native focus and backend constraints remain in force.
- **Why:** a Mac session must be able to build the iPhone client without private
  work-directory artifacts or conversation history; normal browsers are first-class
  clients, not developer terminal harnesses.
- **Rejected:** native-only access; expanded desktop sidebar; Files in terminal +;
  custom browser keyboard; dot separators/status markers. Detailed alternatives
  are in [decision reconciliation](client/browser-review-decisions.md).
- **Not settled by approval:** touch implementation, wrap-preserving snapshot/history,
  production browser auth/serving, draft retention after insert/tab closure, and
  hardware behavior. See the research gates before coding those boundaries.

## Installable phone browser

- **Decided:** 2026-10-22, Jimmy.
- **What:** the phone browser client must be installable as a PWA, sharing the browser UI.
  Native iPhone remains a separate platform shell.
- **Why:** Home Screen launch should be available without installing the native app.
- **Rejected:** treating PWA as an optional future feature or a separate terminal client.
- **Research, not final security spec:** [browser setup](client/browser-setup.md) recommends
  same-origin tailnet hosting, reviewed browser credentials, offline shell/drafts and
  controlled updates. No offline command replay; production auth and device gates stay open.

## Tailscale first, public HTTPS follow-up

- **Decided:** 2026-10-22, Jimmy: Tailscale first, probably public HTTPS afterward
  to connect to multiple machines even outside the tailnet.
- **What:** [connection roadmap](client/connection-roadmap.md) records the intended
  sequence, saved-server name/URL/status, native server selection, and initial
  per-server browser/PWA URLs. Unified cross-origin browser switching is separate.
- **Why:** deliver the minimal private client first without tying the terminal UI
  to one network or one machine permanently.
- **Alternatives:** SSH-key access was discussed but is not the selected next phase.
  Password login and passkeys are not implemented or approved auth contracts.
- **Unresolved:** first-phase identity-only versus additional app authentication;
  public authentication and unlocked-device protections; reachable TLS endpoints
  versus a future tunnel/relay; unified browser cross-origin behavior.
- **Safety boundary:** existing tailnet-only, no-Funnel and device-token rules remain
  current until reviewed replacements are specified. No public exposure is authorized
  by this roadmap, and no network/service configuration changes accompany it.

## Browser authentication: enrolled tailnet nodes

- **Decided:** 2026-10-23, tech lead (Jimmy delegated first-phase auth).
- **What:** A browser/PWA presents no credential; it is admitted as an enrolled
  Tailscale node. The daemon listens on `serve.sock` and `local.sock` in a private
  `0700` runtime directory. Only `serve.sock` can admit nodes, and only when the
  canonical-origin check finds that socket exactly once in the Serve configuration,
  as the sole `/` handler of one HTTPS entry with Funnel off. The daemon checks the
  exact forwarded host, browser Origin and fetch metadata, resolves the forwarded
  address with LocalAPI whois on each node-lane request, refuses tagged, shared,
  subnet-routing and self nodes, then matches stable ID and owner login against a
  `node` row in `auth.toml`. The iOS app's device-token lane remains unchanged.
  Both kinds share `tether enroll`'s one-time code and `tether device remove`; live
  node sockets re-check the device, node and origin every 10 seconds.
- **Why:** a cookie can be replayed by any HTTPS service on the same hostname and
  node-wide Tailscale access alone cannot be revoked per device. Serve's identity
  headers are trusted only on the socket tailscaled's HTTP proxy reaches, and the
  canonical-origin rule closes the raw TCP-forward and same-origin co-resident-app
  paths.
- **Costs:** an enrolled node is trusted whole, including every browser, app and OS
  account on it. On Tailscale 1.100 and later, changing Serve after publishing a Unix
  target needs root; root publishes each Unix user's tether. The operator remains
  trusted and can replace the publication.
- **Rejected:**
  - A replayable browser cookie: any HTTPS service on the same hostname could replay it.
  - A token in browser storage: injected script could read it, and media requests cannot
    attach an authorization header.
  - Tailscale identity without enrolment: no per-device revocation.
  - A loopback TCP peer check or `sock_diag` UID lookup: local users can forge forwarded
    headers or still fill permits; UID lookup has no macOS counterpart.
  - Choosing the auth lane by peer UID, or requiring the Tailscale UID on the socket:
    a Serve TCP forward also arrives from tailscaled with client-controlled headers.
  - A Tailscale app capability or grant as the device list: node-wide, so every Unix
    user's daemon would share one list, and changing it needs the admin console.
  - Caching whois by address: an address can move to another node.
  - Requiring Tailscale 1.100: the root requirement for later Serve changes does not
    protect against the trusted operator replacing the publication.
  - A configurable `browser_origin`: one unsafe Serve publication should refuse
    admission, not choose between several.
  - Reading security state at startup or shell boot: it misses changes while the
    daemon runs.
  - Closing a live socket on its first failed whois re-check: a slow LocalAPI would
    drop every connection; removal itself is checked without whois.
  - Ignoring unknown device-row fields: a future scoped or expiring row could be read
    as a full-power device by an older daemon.
  - Public HTTPS or passkeys in this change: they need a separate future lane and
    security design.
- **Changes:** the older “No `Origin` check” applies only to native-token requests;
  the daemon now serves the browser shell; it binds locked private Unix sockets rather
  than a TCP port; `port` is ignored; startup does not require LocalAPI or refuse
  Funnel; the check refuses Serve Funnel requests and node admission when the
  canonical origin is unsafe. The shared HTTP error type now carries browser
  admission's four codes rather than separate hand-built bodies. Refused raw device
  rows survive unrelated auth-file writes and can be removed by name.

### Tailnet-state retries back off from 2 s to 30 s

- **Decided:** 2026-10-23, tech lead.
- **What:** after a failed LocalAPI fill, retry in the background after 2 s and double
  the delay on repeated failures, capped at 30 s. A healthy cell is refreshed by the
  first request after its 10 s freshness period; only a failed read enables the
  30-second stale-value hold. An empty or expired cell with no failed read starts or
  joins a fill and waits.
- **Why:** repeated LocalAPI failures should not make the daemon hammer tailscaled on
  a busy host.
- **Side effect:** after a held value expires, requests fail closed with
  `503 identity_unavailable`; when tailscaled recovers, detection can lag by up to
  30 s until the scheduled retry succeeds.
- **Rejected:** retrying at a fixed 2 s forever, which imposes needless LocalAPI load
  throughout a long outage.

## Resource limits

### One memory budget sizes daemon caps, checked against the unit

- **Decided:** 2026-10-23, Jimmy (hard CPU cap, one memory setting in `config.toml`,
  OOM never the result, tuning documented in running.md; default 72 keeps 3 tmux
  sessions at once), design (the tier table, startup-only selection and refusal paths).
- **What:** `memory_budget_mib` (default 72, minimum 42) sets the counts at startup.
  The daemon uses the lower of that and the cgroup v2 `memory.max`, floored to MiB.
  The round tier boundaries stay 72, 64, 58, 53 and 42; the tier selects three caps:
  control clients, sockets and completion on/off. The default gives 3 clients, 3 sockets
  and completion; the current in-scope unreclaimable ceiling is 62.4 MiB. The browser-
  auth whois and shell rows (1.2 MiB) are not part of this resource-limit change. Linux
  uploads to tmpfs or ramfs are refused as `409 memory_backed`. The 64-permit HTTP
  accept loop shares 64 permits across `serve.sock` and `local.sock`, with 16 KiB hyper
  buffers and the 128 connection backlog. Completion-off is
  `welcome.daemon.completion: false`; a stray
  `/complete` gets `200 {"chips":[]}` without constructing completion. The control
  client cap ends a watch with `reason: "limit"`; its message names the holding tmux
  session IDs. Every `ConfigError` and a budget below 42 exits 78. The systemd unit has
  `MemoryMax=72M`, no `MemoryHigh`, `CPUQuota=50%`, `CPUQuotaPeriodSec=10ms` and
  `RestartPreventExitStatus=78`. Read the cgroup and select caps at startup only. On
  macOS, where there is no cgroup, the budget only sizes counts.
- **Why:** the shared dev box is overloaded, and one setting is all a user should have
  to choose; tether knows its own costs. Reading the unit's cgroup makes a lower
  `MemoryMax` safe after a restart, so the config and unit cannot drift into an OOM kill.
  Tiers keep each configuration measurable; scaling only session, socket and completion
  counts makes refusals explainable. The default preserves three sessions because the
  unit bounds tether, not tmux and its processes. A memory-backed upload could leave
  unreclaimable shmem after the request, outside the ceiling. The HTTP accept bound is
  required because otherwise unupgraded connections and hyper buffers are unbounded.
  `MemoryHigh` below the unreclaimable ceiling stalls allocations instead
  of making the budget safe. A 10 ms quota period bounds a throttled keystroke by one
  period.
- **Rejected:** documentation only (one missed edit and caps outgrow `MemoryMax`); using
  only the unit limit (no budget in development); a computed solver over every cap
  (unmeasured combinations); budgets above 72 raising caps; starting below 42 (caps
  would reach OOM); `MemoryHigh` at three quarters or budget minus 4 MiB (stall cliff or
  second number to keep aligned); halving capture, paste, raw and completion limits
  (more budget-dependent caps and ranking changes); completion before the third socket
  (no strip at 46–57); live resizing (policy for caps already in use); HTTP
  `503 limit` for completion off (fixed startup state needs no client suppression); a
  browser-auth Unix socket, peer class, whois rows and shell server in this change
  (they depend on browser auth); a user-visible session display name (the hub stores
  tmux session IDs, not display names, and a separate one-shot just to name a refusal
  adds work to a capped path).

### The unit caps CPU at half a core, metered every 10 ms

- **Decided:** 2026-10-23, Jimmy (hard cap), design (the value).
- **What:** `CPUQuota=50%`, `CPUQuotaPeriodSec=10ms`, beside existing `CPUWeight=20`
  and `Nice=10`.
- **Why:** `CPUWeight` and `Nice` yield under contention but cap nothing. Sustained load
  is small (an output flood measured 2% of a core for the daemon process), so half a
  core binds on bursts. The quota is per cgroup and spent across CPUs; when several
  threads drain it at once, the unit waits out the rest of the period. A throttled
  keystroke therefore waits at most one period, 10 ms.
- **Rejected:** 100% (doesn't bound the blocking pool and tmux clients either); 25%
  (bursts take 4× longer for a saving that matters with several users, who can tune it);
  a 20 ms or default 100 ms period (a throttled keystroke can wait past one 60 Hz frame).

## History range labels and soft-wrap restoration

- **Decided:** 2026-10-23, tech lead.
- **What:** Bracket each history capture group with `#{history_size} #{pane_height}`;
  replay tmux's range clamp in the tmux core, label returned rows from the true clamped
  start, and return empty above retained history. The before/after pair is the history
  tear check. On every supported tmux version, pair `-N -T` physical rows with `-J`
  joined rows in the same command group; set only unambiguous wrap bits. Snapshot wrap
  data stays in daemon restore composition, for the active grid only; replay a mapped
  continuation by enabling xterm autowrap for its first character. History sends a
  packed wrap bitmap with each chunk, counted before rows in the fit limit, and the
  client joins wrapped history rows for copy.
- **Why:** tmux clamps out-of-range history requests, so requested offsets are not the
  row labels and a range above history otherwise repeats the top row forever. Paired
  captures avoid a version branch or reliance on newer `-F`; ordinary xterm input is
  enough to recover `isWrapped` without changing the snapshot wire format. History is
  independently rendered in the DOM, so it needs its own row metadata.
- **Rejected:** guessing from row fullness; using `-J` as the history payload, which
  loses physical row offsets and trailing-cell behavior; parsing the private `-R` dump;
  `-F`, which is unavailable on the minimum supported tmux; putting a wrap map on the
  snapshot frame or in the terminal pipeline; mapping the saved primary screen after
  an alternate-screen resize, where its old width is unavailable; leaving xterm wrap
  enabled for a whole row, which can scroll when cell widths drift.

## Browser theme tokens set the minimum browser floor

- **Decided:** 2026-10-23, tech lead.
- **What:** semantic colour tokens use one `light-dark()` value with dark and light
  colours; `color-scheme` selects the value, and the platform's `data-scheme` on
  `<html>` overrides the system preference. The supported floor is Safari/iOS 17.5,
  Chrome 123 and Firefox 120. The browser minimums in [auth.md](auth.md) reflect this
  floor as well as the required `Sec-Fetch-Site` request metadata.
- **Why:** the only target device runs current iOS, and one token block avoids a flash
  while the scheme is applied.
- **Rejected:** separate dark and light scheme blocks, which would preserve Safari/iOS
  16.4 but double the token file and need careful handling to prevent flashes.

## W0 design-system refinements

- **Decided:** 2026-10-23, tech lead.
- **What:** blue, not green, is the accent and selection channel. Selected rows use a
  blue-tinted fill and weight; green remains connected status. The phone picker follows
  the active theme; phone toasts sit above the bottom toolbar. The design uses one scale
  per property for spacing, type, radii and icon sizes (16, 20 or 24 px); touch targets
  are at least 44 px. Tab labels keep the window portion before the session portion and
  fade at the scrolling edge. Interactive primitives share a tokenized focus ring;
  rail and toolbar icons have tooltips on hover and keyboard focus. Desktop Home is a
  centered `min(720px, 100% - 2 gutters)` column. Loading, empty, offline, error,
  refused-session, permission and Enrol states are distinct.
- **Why:** connection status and selection use separate visual channels; theme surfaces
  remain coherent, and the chosen scales and states make the controls consistent and
  usable across density and viewport changes.
- **Rejected:** green selection, which conflates selection and connected status; a
  permanently light picker sheet; toasts over phone tabs; per-element unscaled values;
  labels that hide the window name first; unnamed focus rings and title-only icons; a
  fixed 640 px Home column; or using empty-list appearance for loading and failures.

## Pre-push preflight checks pushed tips

- **Decided:** 2026-10-23, tech lead.
- **What:** the pre-push hook runs the full preflight on each pushed branch tip only.
  The lead separately preflights each commit on a clean export before pushing.
- **Why:** this keeps the hook's guarantee tied to the code that would land while
  preserving a check of every coherent commit in the initial-build workflow.
- **Rejected:** running a full release build for every commit in the push range inside
  the hook, which repeats the expensive gate for every commit on every push.

## Reduced motion shortens duration tokens

- **Decided:** 2026-10-23, tech lead.
- **What:** `prefers-reduced-motion` shortens the duration tokens; there is no global
  transition override.
- **Why:** the global override also animated scheme changes and made the accessibility
  contrast gate flaky.
- **Rejected:** a blanket reduced-motion rule forcing every transition to 1 ms.

## Home, picker and Settings details

- **Decided:** 2026-10-23, tech lead.
- **What:** the controller owns the sessions cache (`sessions/cache.ts`), so a save before
  any screen mounts still writes the saved expansion. A new session or window opens its
  tab from the next listing that holds it, because `created` carries references, not
  names; after 5 s the form says it was created but has not appeared. Closing an overlay
  by an action waits for the history pop before it activates a tab. Expansion keys are
  `<tmux run>/<session id>`, so a restarted tmux does not inherit open groups, and a
  listing drops the keys of vanished sessions. Open tabs have a sibling close button, and
  a restoring tab reads "Checking…", or "Reconnecting…" while its host is unreachable.
  An empty open-tabs list is one muted line. "Updating" sits beside the host heading and
  fades in after 250 ms. Settings confirmations are overlays, so Back returns to
  Settings. Clear local data deletes storage only; open tabs stay until closed. The
  admitted state carries the device name, so Settings names it. The saved workspace
  carries the host's last known name, so an offline launch says "Can't reach pop-os".
- **Why:** each rule keeps one owner for a piece of state and keeps the list from moving
  under the user's finger.
- **Rejected:** a cache built by the first screen to ask (a save before then wrote an
  empty expansion); inventing names from the form to open the tab at once; activating a
  tab before the pop lands, which the pop then undoes; a status row above the list, which
  shifts every row on each Home entry; the large empty-state block for no open tabs, which
  pushed sessions down about 120 px; `<node>` copy that reads "this device" because the
  name was unavailable; a separate host record in storage for the offline name.
