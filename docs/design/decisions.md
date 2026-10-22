# Decision log

Every design decision behind tether's specs: what was decided, why, the alternatives
rejected, when, and who decided. The specs ([plan.md](plan.md),
[daemon-core.md](daemon-core.md), [ios-shell.md](ios-shell.md), [auth.md](auth.md))
state only the current rule; this log keeps the reasoning and the history.

**Who decides.** *Jimmy* owns product calls, and his decisions are marked as his.
*Tech lead* decisions settle reviews. *Design* decisions were made by the spec's
author while writing it; the spawn that wrote each spec is named for traceability
(daemon core p7, iOS shell and auth p8 and p15, review round 2 revision p21). Reviews:
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

## Daemon core

### Snapshot boundary: one atomic command list

- **Decided:** 2026-10-21, design (daemon core), from probes p3 and p5.
- **What:** `continue`, state, captures in one list; the snapshot is emitted at its
  replies' position in the stream; torn lists are retried.
- **Rejected:** pause → capture → marker → continue (pausing discards output; p3
  measured a gap); a private marker command (the list is already atomic); a
  server-side `vt100` (a second emulator, still needing the boundary).

### The daemon composes restore bytes

- **Decided:** 2026-10-21, design (daemon core).
- **Rejected:** structured state each client applies: the web and Swift clients would
  both carry restore logic, and only the daemon can test it against tmux with a `vt100`
  oracle.

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

### `tmux -N` on every invocation

- **Decided:** 2026-10-21, tech lead (review round 2, p16 #7). Probe:
  [probe-locate-subscriptions.md](research/probe-locate-subscriptions.md).
- **What:** every tmux command tether runs fails instead of starting a server. New
  windows and sessions are one-shots.
- **Rejected:** `-f /dev/null` so a started server exits at once, attaching only to
  sessions just seen in a listing, and spawning a control client on the first listed
  session for `newSession` (which also made it `latest` there).

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

### An oversized reply fails its group, not the control client

- **Decided:** 2026-10-21, design (p21).
- **What:** a partial line or a group's replies over 1 MiB are discarded and the group
  fails `TooLarge`.
- **Why:** a legal, very large screen made the old 4 MiB limit kill the control
  client, which would respawn and fail again.
- **Rejected:** treating any limit breach as fatal.

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

## Documentation

### Specs state the current rule; this log keeps the history

- **Decided:** 2026-10-21, tech lead (review round 2).
- **What:** this log; specs without review citations or draft narration; plan.md as
  the product and UX spec plus the index; prior art, the Rust-versus-Go comparison and
  the agent keybinding table moved to [research/](research/); each constant in one
  table; one term per concept (`watch`, not `viewer`).
