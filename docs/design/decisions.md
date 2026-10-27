# Decision log

Every design decision behind tether's specs: what was decided, why, the alternatives
rejected, when, and who decided. The specs ([plan.md](plan.md),
[daemon-core.md](daemon-core.md), [ios-shell.md](ios-shell.md), [auth.md](auth.md),
[fs.md](fs.md), [complete.md](complete.md), [setup.md](setup.md))
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
- **Superseded:** by "One tab per session, like `tmux attach`" (2026-10-25).

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

### A Mac can host tether, behind a path secret

- **Decided:** 2026-10-24, Jimmy, choosing among the options p170 laid out. Supersedes
  "`tether serve` is Linux-only for now".
- **What:** on a Mac with the standalone Tailscale app, Serve reaches tether on a
  loopback TCP port, and tether publishes itself at a random **path secret** that
  Serve adds to every request. A request without it is dropped before anything else
  runs; then the `Host` rule, the Tailscale check and the existing lanes apply
  unchanged ([auth.md](auth.md#the-mac-front)). This is documented as a weaker local
  boundary than Linux and supported only on a Mac whose one user account is Jimmy's
  (below).
- **What the Mac trusts that Linux doesn't:** that copies of the path secret leaving
  the Mac (Tailscale's log upload, a sysdiagnose, backups) are harmless; that
  nothing binds tether's port in the moments after a deliberate stop; that nothing
  binds LocalAPI's port while Tailscale is stopped; and that no local process fills the
  64 connection permits ([auth.md](auth.md#threat-model)).
- **Why:** the Tailscale app's extension can't connect to a Unix socket (it logs
  `connect: operation not permitted`, even in a directory its sandbox may write), so
  the Linux front can't exist on a Mac. Serve keeps a target's path on every request
  and a client can't strip it, so a path only Serve's config holds is a secret Serve
  presents for us.
- **Rejected:**
  - Verifying that each loopback connection comes from Tailscale's root-owned, signed
    extension (Jimmy's first choice): an unprivileged daemon can't see a root process's
    sockets on macOS 27. `LOCAL_PEERCRED` is Unix-only; libproc gives `EPERM`; the
    `pcblist_n` sysctl and NetworkStatistics return only the caller's own flows; LocalAPI
    whois doesn't know Serve's loopback ports. Evidence:
    `.meridian/work/tether-mvp/mac-host-peer-provenance.md` (p170).
  - A root helper (a launchd daemon that reports which process owns a loopback
    connection): a root component in a tool that is meant to stay light and never own
    anything, a sudo install step, and new attack surface; that root can see the flows
    on macOS 27 is itself unverified.
  - Homebrew's standalone `tailscaled` instead of the app: keeps the Linux model, but
    replaces the Tailscale app Jimmy uses on the Mac; Jimmy rejected it earlier.
  - A bare loopback TCP front with no secret: any local process, and any page in a
    browser on the Mac that rebinds DNS to loopback, could forge `Tailscale-User-Login`
    and `X-Forwarded-For` and reach the node lane as any enrolled node.
  - Trusting whois on `X-Forwarded-For` alone: the header is whatever the connecting
    process writes, so it identifies a node only when the connection is known to be
    Serve's, which is the question.
  - Keeping the Mac a client only: Jimmy wants to host on it.

### A Mac host has one user account, Jimmy's

- **Decided:** 2026-10-24, Jimmy, answering p171.
- **What:** tether supports a Mac host only when Jimmy's is its one user account,
  now and as planned. It is the Mac host's stated precondition
  ([auth.md](auth.md#threat-model)), and the Mac design defends against no other login
  account.
- **Why:** every other account was the reason for most of p171's Mac machinery: a
  LaunchDaemon so the port stays held while Jimmy is logged out or switched away,
  `tether unpublish` and an unpublish on every stop, pinning LocalAPI's endpoint
  against an account squatting its port, and a gate that needed a second account.
  With one account, the secret's only readers are root and Jimmy, and the processes
  left to keep out are sandboxed apps and macOS's role accounts.
- **Rejected:**
  - Supporting a Mac with other accounts: the machinery above, plus trusting every
    other admin, for a Mac that has none.
  - Defending against role accounts too: they run Apple's services, and a compromise
    of one is a compromise of macOS, which tether trusts like root.

### tether runs from a LaunchAgent on a Mac

- **Decided:** 2026-10-24, Jimmy, answering p171.
- **What:** a LaunchAgent in Jimmy's login session, installed without sudo. launchd
  binds `127.0.0.1:7851` at login and holds it across crashes; tether stops at logout,
  and while Jimmy is logged out the phone can't reach it on that Mac.
- **Why:** socket activation works the same in a LaunchAgent (probed: after `kill -9`
  the port can't be rebound, and the next connection relaunches the job). What the
  LaunchDaemon added, running while Jimmy is logged out, mattered only for other
  accounts or a Mac reached while nobody is logged in. The agent also runs in his GUI
  session, so TCC can ask about `~/Documents` instead of refusing silently.
- **Rejected:**
  - A LaunchDaemon with `UserName` (p171): a sudo install, a job whose groups,
    environment and TCC behaviour were untested, and no GUI session.
  - The daemon binding the port itself: every crash frees it while Serve points at it.

### Tailscale's log upload stays on for a Mac host

- **Decided:** 2026-10-24, Jimmy. This replaces an earlier decision the same day to turn
  upload off with `TS_NO_LOGS_NO_SUPPORT=true` in the extension's `tailscaled-env.txt`.
- **What:** the Mac setup leaves Tailscale's log upload on. The extension uploads the
  Serve handler line, path secret included (`ipn/ipnlocal/serve.go:1450` at v1.104.2,
  through the logtail-backed `b.logf`, p174), and tether accepts that.
- **Why:** the app can't turn upload off. Tailscale documents the opt-out only for the
  open-source `tailscaled` on macOS, not the Standalone or App Store app
  (https://tailscale.com/docs/features/logging.md, tailscale/tailscale#5114). On this
  Mac, `tailscale bugreport` still returned a normal report ID with the variable set. An
  uploaded secret is useless without a tailnet node reaching Serve, and goes stale at
  tether's next start. Gate M7 checks the rotation.
- **Rejected:**
  - Running the open-source `tailscaled` from Homebrew on the Mac: it supports the
    opt-out and has a LocalAPI socket, but drops the app Jimmy uses and needs a root
    service.
  - Not hosting on a Mac.
  - Keeping the secret out of the logged target: a Serve target is a URL and the
    extension logs it whole, and Serve can't add a header.

### launchd's socket is taken by a local module, not the `raunch` crate

- **Decided:** 2026-10-24, Jimmy, after review p175.
- **What:** `src/launchd.rs` (macOS only, about 24 lines) calls
  `launch_activate_socket` and returns `io::Result<Vec<OwnedFd>>`. It is the one module
  allowed `unsafe`: `lib.rs` goes from `forbid(unsafe_code)` to `deny(unsafe_code)` so
  the module's `allow` can override it, and `main.rs` keeps `forbid`. `libc` becomes a
  macOS-only direct dependency; it is already in the lockfile.
- **Why:** raunch 1.0.1 returns `Vec<RawFd>`, so turning its fds into an `OwnedFd` or
  a listener needs `unsafe { from_raw_fd }` in tether anyway (p175 compiled it under
  `forbid` and it was rejected). The crate doesn't save the lint exception, and it is
  dormant since 2024. The local module owns its fds, returns an empty list for a null
  array instead of raunch's undefined-behaviour edge, and passes errno through.
- **Rejected:** raunch, pinned to `=1.0.1` (the above).

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

### Fail fast on `%exit`; diagnose tmux version mismatches

- **Decided:** 2026-10-26, tech lead.
- **What:** `%exit` closes a control client immediately. Before `Ready` it is a startup
  crash subject to the existing one-respawn/60 s rule; after `Ready`, the one-shot check
  still distinguishes a detach from a gone session or server. The daemon reads
  `tmux.program -V` once, compares it with the server version, warns once per server
  instance, and includes both versions and the configured path when repeated startup
  failures end watches. It uses the normal 10 s reply timeout for both startup attempts;
  after a second startup failure, a known mismatch supplies the error instead of the
  generic failure reason. A view whose first owner is still starting is
  `Locating { owner }`, not `Checking`, so that owner's startup failure orphans the view
  and the crash rule applies; before, the view re-ran its own Locate and spawned a fresh
  client with no crash history, forever ("Connecting..." on the phone).
- **Rejected:** auto-selecting the server's binary: that binary can have been deleted by
  a package upgrade, and tether must not assume another executable's ownership. Waiting
  for the reply timeout after receiving `%exit`: the event is terminal and should close
  immediately; the normal timeout remains for a silent client. Refusing to attach on a
  mismatch: a newer client can work with an older server. A mismatch-only short startup
  deadline: it adds a special mode for a misconfiguration that is fixed once. One short
  startup deadline for every client: it is unprobed on a busy host.
- **Implementation finding:** on pop-os, the mismatched `tmux -C` process stayed silent
  while the daemon's stdin pipe remained open; `%exit` arrived only after the process was
  signalled. Handling `%exit` immediately did not by itself fix the observed hang, so
  startup still uses the ordinary 10 s reply timeout and one-respawn rule.

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
- **Changed 2026-10-25:** views are per watched session, and the owner is that session's control client; `Locate { session }` replaces the window Locate ("The daemon follows the window; the client never re-watches").

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
- **Changed 2026-10-25:** a view binds from its owner's own `Locate { session }` answer; sessions don't move, so no answer rebinds a view to another owner ("The daemon follows the window; the client never re-watches").

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
- **Changed 2026-10-25:** the vote is for the window the view's claim names, its current window or the one being selected ("A claim names a window and moves only by tether's own act").

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
- **Changed 2026-10-25:** tabs are sessions, so `windowClosed` is gone and
  `sessionClosed` closes tabs ("The daemon follows the window; the client never
  re-watches").

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
- **Changed 2026-10-25:** a watch targets a session (`SessionRef`); `input` and `paste` name the window the tab showed ("Input, paste and inserted paths name the window the tab showed").

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

- **Changed 2026-10-25:** `Session::new` takes the session id the pump attaches to,
  so it can tell its own session's `%session-window-changed` from others' from the
  first byte ("The daemon follows the window; the client never re-watches").

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
- **Changed 2026-10-25:** the exit path's session check is `Locate { session }`, which
  replaces `LocateSession` ("The daemon follows the window; the client never re-watches").

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
- **Changed 2026-10-25:** tabs name sessions, so `SessionRef.server` carries the instance
  the same way; `WindowRef` remains only in `created` ("One tab per session, like `tmux
  attach`").

### A window binds only from its owner's own Locate answer

- **Decided:** 2026-10-22, tech lead, accepted from the hub build (p35). Changes "How
  ownership and Locate interact" above
  ([daemon-core.md §4.2](daemon-core.md#42-views-owners-and-locate)).
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
- **Changed 2026-10-25:** a *view* (one per watched session) binds from its owner's own
  `Locate { session }` answer; sessions don't move between control clients, so the
  rebinding cases and `WindowUnlinked` are gone ("The daemon follows the window; the
  client never re-watches").

### A failing Locate or session check ends the watches

- **Decided:** 2026-10-22, tech lead, accepted from the hub build (p35). Changes "How
  ownership and Locate interact" above
  ([daemon-core.md §4.2](daemon-core.md#42-views-owners-and-locate)).
- **What:** a Locate or session check answered with anything but `NoServer` (tmux can't
  run, a timeout, an unexpected reply) ends the window's watches with `watchEnded {
  error }`. `NoServer` still means the server is gone. Work lost because its control
  client exited is still needed again.
- **Why:** needed-again work is sent on the next `reconcile`. When tmux can't be run at
  all, a one-shot fails at once and every `handle` would spawn a failing process.
- **Rejected:** "needed again" for one-shot failures and timeouts, as the earlier entry
  had it.
- **Changed 2026-10-25:** the watches it ends are the view's, one view per watched
  session (daemon-core §4.2).

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
- **Changed 2026-10-25:** window renames are no longer broadcast; every window add or close from the reporter becomes `sessionsChanged` (daemon-core §4.5).

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
- **Changed 2026-10-25:** the stream is part of the view, one per watched session (daemon-core §4.3).

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
  [daemon-core.md §4.2](daemon-core.md#42-views-owners-and-locate).
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
- **Changed 2026-10-25:** every window close from the reporter broadcasts it, since the hub holds no windows (daemon-core §4.5).

### `Starting` is folded into `Locating { after, on }`

- **Decided:** 2026-10-22, tech lead, from the structural review (p49), applied in p51
  (commit 97f8c39). Changes the phases of "How ownership and Locate interact" and the
  state diagram of [daemon-core.md §4.2](daemon-core.md#42-views-owners-and-locate).
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
- **Changed 2026-10-25:** a view's phases are `Checking`, `Locating`, `Bound` and `Orphaned`; `after` and `on` are gone with moved-window rebinding (daemon-core §4.2).

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

### `tether serve` is Linux-only for now (superseded)

- **What:** the daemon needs tailscaled's LocalAPI unix socket for the login allowlist
  and the Funnel check. The macOS Tailscale apps (App Store and standalone) have no
  such socket, so `tether serve` won't start there. The Mac is for recording the 3.7b
  fixtures and building the iOS app ([plan.md](plan.md#product-rules)).
- **Rejected:** a macOS daemon that skips the LocalAPI checks: it would run with no
  login allowlist and no Funnel check.
- **Superseded:** by "A Mac can host tether, behind a path secret" (2026-10-24): a Mac
  daemon reads LocalAPI through the proof-token transport.

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
  `/auth/info` reports the same range.
- **Amended 2026-10-27:** native asks `/auth/info` itself, on a host's first proxied
  request. The original assumed native already called it each session, but native calls
  it only at enrolment and the web's token lane never does, so the gate stayed shut and
  Files said "speaks a different version" against a same-protocol daemon. Rejected:
  checking every host at launch (a round trip per host before anything is used).
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

- **Changed 2026-10-25:** tabs are sessions; a tab goes when no session in the listing
  has its `SessionRef` ("One tab per session, like `tmux attach`").

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

- **Superseded:** 2026-10-25; the shown window's name arrives in `watching` ("The daemon
  follows the window; the client never re-watches").

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
  target requires the operator to be allowed to run `sudo tailscale`. The operator
  remains trusted and can replace the publication.
- **Changed:** by "Linux setup publishes as the operator" (2026-10-25): setup writes
  Serve through LocalAPI with Jimmy's operator grant; the earlier root-publishes-each-
  Unix-user cost is superseded.
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

## Terminal and desktop input details

- **Decided:** 2026-10-23, tech lead.
- **What:** the renderer, its element and every driver live in
  `screens/terminal/terminals.ts`, outside Preact; the screen places the element and draws
  state. Cmd combinations stay the browser's on every platform and Ctrl+Shift+C copies on
  every platform, because telling macOS apart needs `navigator`, which only `platform/`
  may read. Keystrokes batch for 8 ms into one `input` message. tmux is sized by one
  formula over the stable box, the chrome measured from the surface only while no
  software keyboard is up; the first `watch` waits for fonts and a measured box, so tmux
  never sees 80x24. The surface stays hidden until the shown tab's own snapshot paints.
  `limited` is a connection state: the reducer keeps the daemon's message, climbs the
  backoff on each refusal, and Retry asks at once without resetting the count. A restored
  tab reads "Checking…" in the reconnecting colour until a `watching` reply or the first
  listing proves its window. The desktop toolbar ends with the host's name, coloured by
  the active tab's connection. A paste is one `paste` message from a capture-phase
  listener, refused over 256 KiB, and reported as "sent", never "inserted"; an image
  paste uploads, then types the quoted path into the tab it was pasted in only if that tab
  is live. `bufferText({ from, to })` joins rows by `isWrapped`.
  `tests/fixtures/proto/keys.json` lists all 306 key names the handler can make.
- **Why:** a screen that unmounts under an admission problem must not lose the buffer or
  a watch (§6.5); the daemon answers a burst of inputs with a `busy` that names no
  request, so characters vanished under load in WebKit; a native web view that shrinks
  for the keyboard must never change tmux's size.
- **Rejected:** a component that owns the renderer; a context provider in `app/` for state
  one screen reads; a `mac` field on `Viewport` or a lint exemption for `navigator`; one
  message per keystroke, and a longer batch window, which adds echo latency for nothing;
  `visibility: hidden` for the blank surface (its input must stay focusable); clearing
  the buffer on a tab switch; treating `limited` as a halt; resetting the backoff on
  Retry; guessing wrap from row fullness.

## Files details

- **Decided:** 2026-10-23, tech lead.
- **What:** the `FileBrowser` no longer has Settings or a `$HOME` picker, so adding or
  removing a root and moving `uploads_dir` happen in `config.toml` on the host (the roots
  list says so); the `/fs/roots/*`, `/fs/uploads-dir` and `/fs/dirs` client methods stay in
  `files/api.ts`. The router owns the Files place and `FileBrowser` follows it, so Back from
  a preview to a loaded folder makes no request; `go("files")` returns to the last place and
  the in-app back button is `toParent(place)`. Files does not open at the active tab's
  directory. An upload's completion shows a row in a panel above the list, with "Insert path
  into <tab>" and Preview, and does not navigate. The browser picks several files; one
  request runs at a time and four are held, and a fifth is refused with "Wait for the
  current uploads to finish". Progress uses `XMLHttpRequest`, since `fetch` has no upload
  progress in Safari. The insert target is the tab active when the action starts, and a
  closed target disables the offer. Rows are one grouped list with hairlines. The hidden
  files toggle sits under the list. A Markdown document keeps its heading levels. Syntax
  colours reuse the `--term-*` tokens. The viewer ships 14 grammars: bash, c, diff, go,
  javascript, json, markdown, python, rust, swift, toml, tsx, typescript and yaml; `.jsx`
  uses javascript.
- **Why:** the file manager is for browsing and getting a path into a terminal; a folder
  can hold hundreds of rows; jumping to a preview would pull the user out of the folder
  they were in.
- **Rejected:** keeping root editing in the app for a Settings lane (unused code, no UI);
  jumping to the preview on upload completion; bordered cards for file rows; a single
  upload per pick; demoting Markdown heading levels, which changes the document; plain
  text for `.tsx` (the lead added the grammar, about 17 KB gzipped, loaded on demand);
  Shiki's `typescript` grammar on JSX, which mis-colours it.

## Add folder in Files

- **Decided:** 2026-10-23, Jimmy.
- **Changed:** 2026-10-25 by "Add folder becomes the path field": the dialog is
  replaced by Files' path field.
- **What:** Files adds "Add folder…" and a Remove button per root, reversing the removal
  recorded in "Files details" (client-architecture.md §3.1). The picker browses `/fs/dirs` from
  `$HOME`, directories only, one folder at a time, and adds with `POST /fs/roots/add`; Remove
  confirms, then `POST /fs/roots/remove`. Both are router overlays on the Files destination (a
  Dialog on desktop, the sheet on a phone). At `$HOME` the add button is disabled with its
  reason, since the daemon refuses `$HOME` itself; other refusals (`outside_home` through a
  symlink, a read-only `config.toml`) show in the dialog. Moving `uploads_dir` stays in
  `config.toml`.
- **Why:** a fresh install has no root and no way to add one without editing `config.toml` on the
  host, which defeats a phone-first client.
- **Rejected:** a text field for an absolute path (the phone keyboard, and no way to see what
  exists); a free-roaming picker above `$HOME` (the daemon confines it); a Settings entry
  (roots are Files' state, and Settings is for the device); swipe-to-remove (undiscoverable, and
  no confirmation).

## The PWA is built by the Vite plugin

- **Decided:** 2026-10-23, tech lead.
- **What:** the service worker is built by the plugin's `closeBundle` with a nested
  `vite build`. The cache name is `tether-shell-<12 hex of sha256 over every precached
  file's path and bytes>`, which also makes `sw.js` byte-different per build, so the
  browser's own update check needs no version endpoint. The build fails if `dist/` holds
  a file the daemon does not route (`SERVED` in `sw/vite-plugin.ts` mirrors `routes()` in
  `src/http/shell.rs`). `updates.apply()` checks for a new worker first and reloads when
  there is none, so the protocol-mismatch screen's Update button needs no extra wiring. A
  cache miss for a shell path answers 404, not the network. The worker looks in its own
  cache first, then in every `tether-shell-*`. A failed install deletes its half-filled
  cache. `createPwa(emit)` repeats the current state on every `check()`. A third update
  state, `reload`, means another page applied an update while this one keeps the previous
  build; its banner reads "Reload to finish updating" and is separate from the schema
  upgrade banner. `install.installed()` is display-mode standalone or iOS
  `navigator.standalone`. The icon is a blue `>_` prompt on the dark surface; its hex
  colours copy the tokens because a manifest cannot read a CSS token.
- **Why:** the worker needs the finished file list and its hash, which exist only after
  the main bundle and `public/` are written; a precached path the daemon 404s would fail
  every install; the schema banner's copy says changes are kept in memory, which is false
  after a plain worker takeover.
- **Rejected:** a second Rollup input (the list is not known yet); a post-build script
  (preflight needs a second step to remember); the Vite manifest hash for the cache name,
  which ignores an icon or manifest change; network fallback for a missing shell path; a
  `clients.claim`; reusing the schema banner for `reload`.

## One real-daemon e2e stack

- **Decided:** 2026-10-23, tech lead.
- **What:** the real-daemon specs (`e2e/*/*.real.ts`) share `e2e/shared/stack.ts`: an
  isolated daemon with `--allow-login e2e`, a private tmux, Vite's dev server with the dev
  proxy, and a front proxy that stands in for Tailscale Serve and answers `/auth/info`
  itself. They are opt-in: `pnpm e2e:real` needs tmux 3.4 and 3.7b under
  `~/.cache/tether-tmux`. The harness suite's Playwright output goes to
  `test-results/<port>`. The dev proxy's `/auth/info` request carries the token and the
  caller's `Tailscale-User-Login`, which the daemon's Tailscale check requires.
- **Why:** a browser cannot add `Tailscale-User-Login` to a WebSocket upgrade, so
  something must stand in for Serve, and one stack serves every lane.
- **Rejected:** a `TETHER_LOCALAPI_SOCKET` override in the daemon with a fake LocalAPI
  (a test hook in the production identity path); a patched daemon copy; a separate
  stack per lane; running the real specs in the default `pnpm e2e` (they fail on a
  machine without the tmux builds); a shared `test-results/` that one run empties under
  another.

## Drafts of closed tabs are kept

- **Decided:** 2026-10-23, Jimmy.
- **What:** closing a tab keeps its unsent local draft. The draft comes back when that
  window is opened again, on the same device. At most 32 drafts are kept; the oldest
  goes first.
- **Why:** closing a tab is often a tidy-up, not a decision to throw away text; losing
  a half-written prompt costs more than a bounded record in local storage.
- **Rejected:** deleting the draft with its tab, which is simpler but loses text.

## G2 fixes to the rebuilt web client

- **Decided:** 2026-10-23, tech lead, from three G2 reviews and a browser probe of
  `d051e21`.
- **What:**
  - *Every end of a tab sends `unwatch`.* `TabDriver` sends it from its `closed`
    transition, the one place user close, pruning, a gone window and a removed host all
    pass through, so the daemon's 2-per-connection watch cap and its tmux clients are
    never leaked.
  - *The driver owns sending the size.* It remembers the size the daemon last heard for
    the watch and, on `watching`, sends a `resize` if the terminal's size differs, so a
    rotation during an in-flight watch is not lost.
  - *A failed watch backs off.* `watchEnded { error }` climbs the attempt count like a
    refusal does and keeps the daemon's message for the status band.
  - *Requests wait 5 s for a socket, then 30 s for the reply.* A create sent on a live
    socket is not abandoned at 5 s: the daemon may be acting on it, and the user's retry
    would then hit a duplicate. Dead sockets already fail every request as `lost` (25 s
    silent). The failing run was a loaded machine (load average 100 to 170) and WebKit.
  - *Insert path is offered only to a tab that is not reconnecting or limited*
    (`AppView.tabsOffline`, set by the terminal lane). A path waiting for its watch is
    dropped with a notice if the watch fails; the image-paste notice says whether the path
    was typed or will be when the user returns.
  - *Names with a C0 control or DEL are never inserted.* The path is typed as raw
    `send-keys` bytes, so CR or LF would submit, as the daemon's own completion inserts
    already refuse.
  - *Markdown is sanitized by allowlist* (`ALLOWED_TAGS`, `ALLOWED_ATTR`), and a click
    inside a document is always cancelled, with `a` and `area` forwarded to the link
    handler. `<area>` had navigated the whole app off-site.
  - *A finished Settings action closes both overlays in one `history.go(-n)`*
    (`Router.closeAllOverlays`); two `back()` calls in one task close only one in WebKit.
  - *`/` answers `503 busy` while a daemon behind Tailscale serve cannot read the
    browser origin*, so the worker's precache retries instead of freezing a CSP without
    `wss://<host>`. A daemon not behind serve (tests, dev) still serves `'self'` alone.
  - *The shell cache falls back to the network for a path in no cache.* This reverses the
    earlier "404, not the network": with `/` cached but an asset evicted, a 404 left a
    blank page.
  - *The storage-closed banner is hidden on Terminal*, like the update banners: in flow it
    shrank the stable box and resized tmux. The workspace saves only when its saved form
    changed. A file over 128 MiB is refused before sending, a second Upload tap removes
    the first pick's listeners, `mailto:` hands off to the mail app, and Update after a
    hard reload waits for the worker to activate.
- **Home's "Another terminal is attached" notice was not a regression.** The e2e attached
  a terminal and loaded Home without waiting for tmux to list the client; the page lists
  once and does not poll, so a listing taken first never shows it. The stack's `attach` now
  waits until tmux lists the client. Reproduced by loading the page first: it fails the same
  way on the unchanged UI.
- **Rejected:** a second `closeOverlay()` chained on `navigated` (every caller would need
  it); making the request timeout longer but still one number (it would still fail a dead
  socket late and a slow one early); dropping the request timeout (a daemon that never
  replies would hold the form forever); `wss://<Host header>` in the CSP (the header is the
  client's); rendering control characters as `$'..'` (a TUI does not parse it).

## Terminals owns the tab drivers and which tab is shown

- **Decided:** 2026-10-23, tech lead, from the maintainability review of the web client at
  `f5c8869` (finding H1, the third round on this seam).
- **What:**
  - *`Terminals` is the one owner of the drivers.* `sync()` covers and uncovers each from
    `shownTab(workspace)` on every app change; the reducer's `cover`/`uncover` effects, the
    controller's driver registry (`attachDriver`, `TabHandle`), `Terminals.shown` and the
    `detach` map are gone. Native needs none of them: its input already reaches `Terminals`
    through `Platform.subscribe`, and a native screen covering the terminal is Swift's state.
  - *One eligibility rule for inserting a path.* `Terminals.canInsert(id)` and `insertPath(id,
    path)` read the driver's state: connecting and live accept (the path waits for the
    watch), reconnecting, limited and closed refuse. Files' Insert path and image paste both
    use them, so a connecting tab no longer takes one and refuses the other. `insertPath`
    returns `typed`, `queued` or `refused`; a refusal gets one notice, and `AppView.tabsOffline`
    is gone. This replaces the `tabsOffline` rule of the G2 fixes.
- **Why:** the controller and `Terminals` each kept a copy of the drivers and of which tab was
  on screen, and each round fixed one copy's symptom (p96 M4, p96 L2, p97 #4).
- **Rejected:** a port the terminal lane registers with the controller for Files (Files imports
  `terminalsOf` directly, as every screen reaches its own core; a port would be the registry
  again); keeping the reducer's effects and deleting only the controller's map (the reducer would
  still compute "which tab is shown" a second time, from a diff).

## Ctrl+Shift+F leaves the terminal

- **Decided:** 2026-10-23, Jimmy; the key chosen by the tech lead.
- **What:** a keyboard user leaves a focused terminal with Ctrl+Shift+F, which moves focus
  to the active tab's button in the tab strip. The keymap handles it before any key is sent
  (`decideKey` returns `leave`); Settings and browser-behaviors.md name it.
- **Why this chord:** a terminal cannot encode Ctrl+Shift+letter apart from Ctrl+letter, so
  shells lose nothing. First-hand checks: [Chrome's keyboard shortcuts](https://support.google.com/chrome/answer/157179)
  for Windows, Linux and macOS; Firefox's [`browser-sets.inc.xhtml`](https://github.com/mozilla-firefox/firefox/blob/main/browser/base/content/browser-sets.inc.xhtml)
  and [`DevToolsStartup.sys.mjs`](https://github.com/mozilla-firefox/firefox/blob/main/devtools/startup/DevToolsStartup.sys.mjs);
  and [Safari's keyboard shortcuts](https://support.apple.com/guide/safari/keyboard-and-other-shortcuts-cpsh003/mac).
  None defines Ctrl+Shift+F; Firefox's only Shift+F full-screen binding is Cmd+Shift+F in
  its macOS-only keyset. Windows' Microsoft Pinyin IME uses Ctrl+Shift+F while active to
  switch Simplified/Traditional Chinese, rebindable in IME settings ([Huawei support](https://consumer.huawei.com/en/support/content/en-us00689079),
  [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/a/12306063)); that is an OS/IME
  shortcut, not a browser shortcut. Ctrl+Shift+C and V are copy and paste.
- **Rejected:** Ctrl+Shift+L (Edge's paste and go), Ctrl+Shift+U and E (GTK's Unicode and
  emoji input on Linux), Ctrl+Shift+Y (Firefox downloads), Escape (a shell and vim need it).

## Native screen coverage pauses the terminal watch

- **Decided:** 2026-10-23, after the p104 round-2 review.
- **What:** Native includes the initial `covered` state in `boot` and sends
  `lifecycle.covered { covered }` whenever a native screen covers or reveals Terminal.
  The web represents it in `Lifecycle.covered`; `Terminals` uses the selected tab only when
  it is not covered, so the existing driver path sends `unwatch` and later a fresh `watch`.
  Browsers always report `covered: false`.
- **Why:** `ios-shell.md` already required the web to unwatch beneath native screens, but
  client-architecture §6.1 said Swift kept that state and the bridge had no signal. Without
  one, the web cannot release the tab's tmux size while native covers it.
- **Rejected:** Swift-only cover state. It leaves the web's `Terminals` unaware, so its one
  watch owner keeps the active tab watched beneath native UI.

## Phone input follows Termius: one keyboard toggle, a dock, a one-line field

Jimmy ran the native keyboard spike on his iPhone on 2026-10-24 and changed the phone
input design, then chose among four drawn dock variations. Entries marked Jimmy are his
calls; the rest settle the structure his calls left open (design, spawns p110 and
p112, and the tech lead). The record of his answers is in the work item's
`phone-input-decisions.md`; his references are Termius screenshots and the dock
variations canvas.

### Only the keyboard toggle opens and closes the keyboard

- **Decided:** 2026-10-24, Jimmy ("like termius"; "there should only be 1 place to
  click to open and close the keyboard").
- **What:** on touch, one control, the keyboard toggle, opens and closes the on-screen
  keyboard, and stays visible in both states. A tap on the terminal never opens it,
  closes it or moves focus: with app mouse mode on it is a click, without it nothing
  happens (OSC 133 cursor placement aside, while the terminal input already has the
  keyboard). Desktop click-to-focus is unchanged.
- **Changes:** plan.md's earlier target that "nothing tether does closes the
  keyboard", with a tap on the terminal or `[⌨]` bringing it back; and the gesture
  table's "tap, no mouse mode: focus the owned input".
- **Why:** a tap meant to scroll, select or click also opened the keyboard, and with
  two ways to open it and a separate hide key there was no one place to look.
- **Rejected:** tap-to-focus on the terminal (above); a toggle in the tab bar with a
  separate hide key in the native key row (coder p109's interim edit), superseded by the
  dock below.

### The phone dock: one row at rest, the key row with the keyboard

- **Decided:** 2026-10-24, Jimmy (a dock in every touch client, the phone browser
  included; then variant 2 of four drawn, "one row at rest").
- **What:** on touch, Terminal is full-bleed above a dock that is always visible and
  rides on the keyboard when it is up. At rest the dock is one row: the tab chip (the
  active tab's name and the open-tab count), the line field and the keyboard toggle.
  While the keyboard is up, the key row sits above that row; the toggle stays at its
  right end. Controls are small (34 px row items, 32 px keys), with the line field at
  16 px so Safari doesn't zoom. Portrait and landscape share it. tmux is sized with the
  resting row, so the key row appearing never resizes it.
- **Changes:** reverses "custom browser keyboard" in the rejected list of
  [Browser/mobile client direction](#browsermobile-client-direction-and-portable-design-record)
  and the contract's "no custom strip" for the mobile browser. The key row supplements
  the system keyboard; it is not the HTML keyboard rejected in
  [Keyboard: native Swift shell first](#keyboard-native-swift-shell-first).
- **Why:** the ordinary keyboard lacks Esc, Ctrl and Tab, which agent CLIs and shells
  need; with the keyboard down none of them can be typed, so the key row costs no room
  then. One row at rest leaves the terminal the most room, in landscape too, where a
  stacked dock plus the keyboard and Safari's form bar left almost none.
- **Rejected:** three rows always shown (tab row, line field row, key row with the
  toggle), first as Termius draws it (layout A) and then compact (variant 1): Jimmy
  wanted smaller controls and "i don't think we should EXACTLY copy termius"; tabs on
  top (variant 4, "hard to reach"); a key row that follows the pane's program
  (variant 3, deferred below); a key row in the native app only (the browser would stay
  unable to send Esc or ^C); the keyboard-hidden toolbar plus a keyboard-open draft
  editor (two layouts).

### The key row's keys, and arrows by long-press

- **Decided:** 2026-10-24, Jimmy (arrow keys off the row; the long-press, "long press
  -> release -> highlight word -> can drag it further", with Termius's hold, vibration
  and arrow motion pad); the fixed row and the arrow input settled by the tech lead
  after his answers.
- **What:**
  - **One fixed key row**, most used first: esc, ↑, ↓, ^R, ^C, tab, ctrl, alt, `|`,
    `~`, `/`, `-`, scrolling. ↑, ↓ and ^R are there because arrow use is "probably
    mostly recalling commands", which the shell's own history does; ← and → go
    ("i don't think the arrow buttons should be needed").
  - **The long-press** on the terminal fires with a haptic. Held and dragged, it is the
    arrow pad: arrows in the drag's direction, repeating while held. Released without
    moving, it selects the word under the finger, with handles to drag the selection
    further and tether's edit menu (Copy, Paste). No mouse event, in mouse-mode apps
    too. Vertical swipes in alternate-screen apps still send ↑/↓.
- **Why:** command recall is the shell's job (↑, ^R use its real history, desktop
  commands included), so the line field keeps no history; one fixed row has fewer
  moving parts (no daemon watch, protocol or client logic) than a row that follows the
  program.
- **Rejected:** ← and → keys; the spacebar trackpad ("kinda works, but not that well",
  and unavailable to the native input view); a line-field command history.
- **Deferred** (web/.context/FUTURE): smart keys that follow the pane's program
  (needs a daemon watch of `pane_current_command` and protocol); swiping the tab chip
  for the previous or next tab; a line-field command history; spacebar-trackpad
  arrows.

### The tab chip opens one session switcher

- **Decided:** 2026-10-24, Jimmy (variant 2's tab chip, and other tmux sessions easy to
  reach whether or not they are open as tabs; drawn as the Switcher board).
- **What:** on the phone, the tab chip opens one sheet: Home and close in its header;
  the open tabs as pills (a tap switches and closes the sheet; each has a close icon);
  then every tmux session on the host with its windows, labelled "here" (the active
  tab's window) and "open" (another open tab), never dots; and at the bottom, in thumb
  reach, search (not auto-focused) and "+ New session". It replaces the phone's tab
  row, its + and the phone picker sheet, and offers Home's creation actions. The
  desktop is unchanged: top tabs, + and an attach-only picker.
- **Why:** one place to switch, open, close and create keeps the resting dock to one
  row, and the controls a thumb uses most sit at the bottom of the sheet.
- **Rejected:** keeping the picker beside the switcher (two session lists on the
  phone); auto-focusing search (the keyboard would cover the list on every open); the
  sheet attach-only like the desktop picker (creation would need a trip to Home).

### Two keyboard openers, one closer, with Termius's focus cues

- **Decided:** 2026-10-24, Jimmy (his Termius screenshots: "note the difference when
  the focus is different").
- **What:** the toggle opens live typing to the terminal; a tap on the line field opens
  line typing into the field; the toggle closes either; terminal taps open and close
  nothing. With the terminal input holding the keyboard, the terminal cursor is a solid
  block, the field shows its placeholder and Return is the plain key. With the field
  holding it, the caret is in the field, the terminal cursor is a hollow outline and
  Return is the blue send key (`enterkeyhint="send"`). The key row is the same in both.
- **Why:** both inputs are needed (live keys for Tab completion, ^R, vim and y/n
  prompts; the field for dictation and autocorrect), and the cues say which one typing
  goes to without a label.
- **Rejected:** the field as the only opener (loses live keys); a live mode toggled
  inside the field (an extra tap for the same two modes).

### One code per phone: the browser enrols the node, the app mints a token

- **Decided:** 2026-10-26, Jimmy (custom scheme, handed over after the browser enrols).
- **What:** the enrolment screen, once the browser has enrolled, offers "Open in the
  tether app" with `tether://add?host=<origin>`. The app opens Add server with the host
  filled and the code empty; Add posts `POST /auth/node/enroll` with an empty code. An
  already-enrolled node answers with a native device token bound to that node, and
  removing the node revokes it. A node that is not enrolled gets `not_enrolled`, and the
  app asks for a code as before. The mint refuses any request carrying browser fetch
  metadata, so page script on tether's origin cannot trade a same-origin request for a
  portable token; it also replaces the node's earlier app token rather than adding
  another, and a bound token stops working when its node row is gone.
- **Why:** enrolment is per node (`/auth/node/enroll`), so one code covers the phone; the
  app then needs a credential, not a code. It needs *a* credential because the terminal
  WebSocket is created by the page, whose origin inside the app is `tether-app://ui`,
  which the node lane refuses (`src/auth/node.rs`): a tokenless app cannot open a
  terminal.
- **Rejected:**
  - Universal Links. The origin is a per-machine tailnet host that Apple's CDN cannot
    reach to fetch the association file, and the wildcard development profile cannot
    carry `com.apple.developer.associated-domains` without an explicit App ID.
  - Handing off before the browser enrols, carrying the code. It spends the code on the
    app and leaves the browser unenrolled — two codes per phone again.
  - Allowlisting `tether-app://ui` as a node-lane origin. It widens the auth surface, and
    the app still needs a token for its lock screen and uploads.

### Add server separates the code and device name; the app handoff finishes itself (superseded)

- **Decided:** 2026-10-26, Jimmy.
- **What:** manual Add server is two steps: server and optional code, then the device
  name and Add. The code is eight native one-character fields grouped four-and-four,
  with a drawn separator; typing advances, Backspace on an empty cell clears the prior
  cell, and pasting a whole code fills all eight. The browser's `tether://add` link
  validates the host and immediately mints with empty code plus `UIDevice.current.name`;
  after success it saves the host/token and dismisses server management. A locked app
  queues the link until Face ID succeeds; an unlock failure is visible, `not_enrolled`
  opens manual step 1 with the host and `tether enroll` instruction, and other failures
  open the same step with the error. Manual Add errors stay with the name step, and Back
  preserves the entered fields. Success dismisses the native sheet but does not select a
  tmux session; the web still owns the route and active tab.
- **Why:** the code is already available from the browser-enrolled node, so making its
  app handoff stop at a form wastes the path Jimmy uses. Separating the device name
  makes each step about one task. Eight real native fields give each cell its own tap
  target and native editing boundary; the delegate can handle whole-code paste and
  empty-cell Backspace without synthesizing a cursor over a single text field.
- **Rejected:** one text field with a drawn overlay, which would need custom mapping from
  cell taps to cursor positions and more cursor/selection state; keeping the device name
  beside the server/code; making the app handoff wait for a manual Add tap.
- **Supersedes:** the custom-scheme portion of "One code per phone: the browser enrols
  the node, the app mints a token" above, which opened the host-filled Add form instead
  of completing the mint.
- **Superseded:** the app-handoff behavior by "The app handoff prefills the form and
  waits" below.

### The app handoff prefills the form and waits

- **Decided:** 2026-10-26, Jimmy, after using the flow.
- **What:** `tether://add?host=<origin>&code=<code>` opens Add server at step 1 with
  the HTTPS host and optional code filled in. It sends no request until the user taps
  Next and then Add. A code goes through `POST /auth/enroll`; no code keeps the
  already-enrolled node-mint path through `POST /auth/node/enroll` with `Origin` only.
  Wrong or expired codes and `not_enrolled` remain visible on the device-name step.
  Manual two-step entry, the segmented code field, Back preserving both fields, and
  `UIDevice.current.name` stay unchanged.
- **Why:** the link must prepare the form, not make an enrolment decision or send a
  credential before Jimmy confirms it. Sharing the manual Add path also keeps both
  enrolment lanes behind the same explicit Next and Add taps.
- **Rejected:** automatically minting or enrolling when the deep link opens; the app
  would submit before Jimmy reaches the form and the link would not wait for confirmation.

### A setup link belongs to the app, so Safari never enrols

- **Decided:** 2026-10-26, Jimmy, on the phone: "when u open in browser, try to open
  tether first", "with that code", "so we don't login via safari".
- **What:** a page that arrives with a `#code=` fires
  `tether://add?host=<origin>&code=<code>` as soon as it knows the host's origin, on a
  platform where the app can exist and never inside the native shell. Safari shows the
  page only long enough to hand over; the prefilled screen and its "Open in the tether
  app" action remain the fallback when nothing handles the scheme. The app's Add with a
  code posts `POST /auth/node/enroll {code}` — which enrols the phone's **node** — then
  mints its own token with an empty code. One code therefore admits the phone: Safari
  and the PWA on it need none, and the app has its token.
- **Why:** Jimmy does not want to enrol the browser. Making the app spend the code
  removes the Safari login entirely while keeping the design's one-code-per-phone
  property, because the code is redeemed on the node rather than on a device.
- **Rejected:**
  - The browser enrols the node and the app only mints (the previous shape). It works,
    but it requires completing an enrolment in Safari first, which is the thing he does
    not want.
  - The app keeps posting `POST /auth/enroll`: it mints a device token and leaves the
    phone's node unenrolled, so Safari on the phone would ask for a code already spent.
  - Having the daemon answer a code request from any tailnet node: that removes the
    code as the gate. An approval on the server would keep the gate and remove the
    copy-paste; left out of this change because the app path already needs no code on an
    enrolled node.

### No predictions on the line field

- **Decided:** 2026-10-26, Jimmy, from the phone.
- **Superseded as a mechanism:** 2026-10-26 by
  [One keyboard: native owns line editing, web mirrors it](#one-keyboard-native-owns-line-editing-web-mirrors-it).
  The outcome remains, but no longer depends on WebKit content-view trait overrides.
- **Historical mechanism:** the web field's autocorrect / spellcheck attributes and
  private WebKit content-view trait overrides attempted to remove the strip. The hook
  failed on Jimmy's phone; the settled mechanism is the app's native text-field traits.
- **Why:** a line is a command or a prompt for a shell or an agent. The predictions
  corrected it as prose and took the row above the keyboard. Jimmy saw the strip on
  his phone, which is what the checklist row was there to catch.
- **Rejected:** attributes alone. They stop autocorrection but not the predictive bar
  ([plan-review.md](plan-review.md) noted it), and WebKit consults the content view for
  the traits the strip reads.
- **Supersedes:** the "autocorrect and dictation stay on" half of
  [Line field auto-capitalization is off](#line-field-auto-capitalization-is-off);
  dictation stays.

### Line field auto-capitalization is off

- **Decided:** 2026-10-24, tech lead, confirmed by Jimmy.
- **What:** `autocapitalize="off"` remains on the line field. Its former rule that
  autocorrect stays on is superseded by the 2026-10-26 one-keyboard decision. Dictation's
  own capitalization is accepted, since no attribute controls it.
- **Why:** most lines are commands, where a capital first letter breaks the command.
- **Rejected:** sentence capitalization (it suits agent prompts, but they read
  lowercase fine).

### Phone paste: the line field's menu and the terminal's edit menu

- **Decided:** 2026-10-24, design (p112), following from the one-row dock.
- **What:** the dock has no Paste button. In the browser/PWA line field, paste is the
  platform's own menu; in the app mirror, the long-press menu has Paste / Select all /
  Clear. One line is inserted for editing, text with a line break goes to the terminal
  as one paste without Enter, and an image takes the image paste route. On the
  terminal, tether's edit menu, opened by a released long-press, has Paste (alone over
  a blank cell), which sends the clipboard to the terminal as one paste without Enter
  (`readPasteboard` in the app).
- **Why:** the resting row Jimmy chose has room for the tab chip, the field and the
  toggle only, and the key row is his fixed list; the edit menu is where iOS users look
  for Paste on content that isn't a text field.
- **Rejected:** a Paste chip in the resting row (crowds the row and shrinks the field);
  a paste key in the key row (not in the fixed row, and hidden with the keyboard down).

### The text box is one line; Return sends it and Enter

- **Decided:** 2026-10-24, Jimmy ("edit should be a single line editor"; Return sends
  the text and Enter and clears the box).
- **What:** the dock's line field holds one logical line, visually wraps and grows from
  one to five lines before scrolling inside. Browser/PWA uses its textarea; the app uses
  a native editor with autocorrect, predictions, capitalization and spell checking off.
  Return sends its text to the active tab, then Enter, and clears it; the line target
  keeps the keyboard. An empty Return sends Enter. The unsent text is the
  tab's draft, saved per tab key; [Drafts of closed tabs are kept](#drafts-of-closed-tabs-are-kept)
  still applies to it.
- **Changes:** replaces the multiline local draft editor whose Insert sent a paste
  without Enter ([Browser/mobile client direction](#browsermobile-client-direction-and-portable-design-record),
  terminal-interaction-design.md, client-architecture.md §7.4).
- **Why:** on the phone the text box is for saying one thing to a shell or an agent
  and sending it; a separate Insert and a second Enter cost a tap each time.
- **Rejected:** the multiline editor with Insert; Return inserting without Enter.

### The dock is web, in every touch client

- **Decided:** 2026-10-24, design (p110), confirming the tech lead's lean.
- **What:** the web draws the whole dock, including the key row, the line mirror and the
  toggle, in the browser, the PWA and the app. Native keeps one hidden
  `KeyboardInput: UITextField` as first responder for terminal and line targets, reports
  keyboard geometry and sizes the web view so the dock rides the keyboard, and draws
  nothing above it. There is no compose field. Armed ctrl and alt live in the web
  (`touch/modifiers.ts`) and reach native over the bridge; key-row haptics go over
  `haptic`.
- **Why:** the browser needs the dock anyway, so a native copy would be a second
  implementation of the same controls, with the drift and double review that brings.
  The web already owns everything else Jimmy looks at; iterating on the dock needs no
  app rebuild.
- **Rejected:** a native accessory key row and compose field (two implementations;
  modifier state split between Swift and the web); a native `UITextField` overlaid on
  the web dock for the line field (its frame would have to track web layout through
  scroll, rotation and keyboard animation).
- **Cost:** a key-row haptic crosses the bridge, unmeasured; a native touch-down
  `prepare()` is no longer possible.

### One keyboard: native owns line editing, web mirrors it

- **Decided:** 2026-10-26, Jimmy, after the first real-phone use:
  > "I still get predictions on the iphone app, and swapping between if i used the button or if i used the box is still really wonky (they do different things still)"
  > "I have to press the box twice to open the keyboard sometimes"
  > "it should just act like a text box / not be a text box / a local text box / and then also the predictions should go away"
- **What:** one hidden `KeyboardInput: UITextField` owns first responder throughout Terminal.
  The toggle selects `terminal`, where committed keys go directly to tmux; tapping the box
  selects `line`, where native edits the line and the web mirrors its text, caret, selection
  and marked composition. The toggle closes either target. The field disables autocorrection,
  capitalization, spell checking, smart punctuation and inline prediction. Return is Send in
  `line` and Return in `terminal`; sheet and Files fields remain WebKit-owned and keep their
  ordinary keyboard. The mirror has tap-to-place, spacebar trackpad, and long-press Paste /
  Select all / Clear; it has no selection handles. Both app and browser boxes wrap and grow
  from one to five visual lines, then scroll inside, while remaining one logical line:
  Return sends and paste with line breaks goes to tmux as one paste. Draft storage and send
  outcomes remain web-owned. An interruption restores `line` as `line`.
- **Restore after WebKit restart:** `Boot.focusMode` and the preserved route fragment
  restore the target and screen. If the target is `line`, Boot also carries a tab-bound
  `lineSnapshot` with native's current generation, text, selection and marked range.
  `lineDrafts` reconciles that snapshot after its first list; events arriving before the
  dock or store is ready are buffered and applied against the restored generation. This
  keeps the web draft store authoritative without replacing newer unsaved native text.
- **Bridge:** v4 adds `lineSet { gen, text, caret, tab }`, `lineEdit { gen, text, tab, selection, marked }`,
  `lineReturn { gen, text, tab }`, `lineCaret { index }`, `lineInsert { text }` and `modifiers { armed }`;
  it removes `lineField { rect }`. `lineSelectAll {}` is an additional request beyond the
  proposal's listed contract: a menu action for native Select all needs an operation that
  can select the text field's contents, which caret placement and setting text cannot express.
- **Why:** both openers now reach the same keyboard and the same responder, so tap-to-edit
  has no WebKit handoff or lending guard. Native's public text-field traits remove
  predictions without a private WebKit swizzle; the web continues to own the buffer's
  persistence, send path and error notes.
- **Implementation choices:** the browser `LineInput` is a `<textarea>`, not an `<input>` as
  the proposal assumed. An input cannot wrap into the required five-line box; a textarea
  supports the visual growth while Return remains intercepted as Send and pasted newlines
  retain the terminal-paste rule. `LineField` selects that browser editor or the native
  mirror from `viewport.directInput`, the existing platform capability; `Platform` has no
  environment-name switch to branch on.
- **Bridge correction to the proposal:** `lineSet` also carries the owning `tab`. Native's
  `activeTab` message arrives separately from `lineSet`; a WebKit restart between a tab
  switch and its next buffer load could otherwise associate the old native copy with the
  newly active tab. The snapshot uses the tab bound by the atomic line load, not whichever
  `activeTab` message arrived last.
- `lineEdit` carries the same tab binding so an edit delivered after a focus or tab change
  updates its originating draft instead of being discarded by the new active target. The
  web still rejects edits older than the most recently loaded generation for that tab.
- **Return correction to the proposal:** `lineReturn` captures `text` and `tab` as well as
  `gen`, then native clears into the next generation immediately. A buffered Return must send
  the line present at the key press, not a later edit from the restored snapshot; the tab
  makes a delayed Return independent of a subsequent switch. The web's same-generation
  `lineSet` acknowledges the clear without overwriting native typing that arrived after it.
- **Modifier routing:** the web's `apply()` is the only chord rule. With ctrl or alt armed,
  native diverts only one grapheme inserted at a collapsed caret. The web sends it to tmux
  if it forms a chord; otherwise it disarms and restores the character in the line via
  `lineInsert` at the caret. Other insert shapes clear native's armed state and stay in
  UIKit; their next `lineEdit` disarms the web-owned state. The browser field and key row
  use the same `chord()` rule; a key-row character that is not chordable inserts into the
  line only while line owns the keyboard and is never sent bare to tmux.
- **Input layout and reload choice:** the hidden field uses `.default`, not `.asciiCapable`,
  so locale IMEs and dictation remain available; explicit prediction, correction and
  smart-edit traits stay `.no`. While the page is loading or reloading, Return remains in
  the field and warns; native does not queue it for later delivery.
- **Bundle cost:** the production check measured initial JS at 193.2 KiB gzipped after
  adding the restore snapshot and event handoff. Raise the cap to 194 KiB rather than
  code-splitting the dock-critical mirror into another request; this leaves 0.8 KiB of
  measured headroom.
- **Tech-lead corrections after reviews p304 and p306 (2026-10-26):** native is the sole
  owner of line generations. `lineSet { text, caret, tab }` advances and returns the generation;
  web never assigns it or echoes the native clear after Return. The app-started
  `NativeLineInput` beside `LineDrafts` subscribes directly to platform events, waits for
  draft hydration, reconciles the one boot snapshot and syncs any bound draft whose text
  differs from native's last reported text. This replaces transition-specific loads and
  removes the controller and component event queues/snapshot copies. If the page receiver
  is not ready, Return remains in native and warns; Swift has no Return retry queue. The
  web's `apply()` rule is the only chord authority. While armed, native diverts only a
  one-grapheme insert at a collapsed caret; other insert shapes clear native's armed state
  and go through UIKit, whose next `lineEdit` disarms the web state. A diverted character
  becomes a tmux chord only when `apply()` recognizes it; otherwise the web disarms and
  restores it with `lineInsert` at the caret. Browser inserts and key-row characters follow
  that same rule; an unchordable key-row character inserts into the line only while line
  owns the keyboard, never as bare terminal input.
  Marked-text Backspace and Return stay with UIKit in either target. Selection mode takes
  precedence over the native line resting mode and release restores the line target.
- **Rejected:** JavaScript generation counters and same-generation acknowledgements;
  per-send/per-clear/per-refusal sync calls; a line-event handler in React; separate
  controller/component buffering and snapshot holders; a native character allowlist plus
  web-side line-edit revert; diverting every committed insert to the terminal; routing an
  unchordable insert as bare text; retrying a Return whose delivery cannot be known after the
  page is ready.
- **Rejected:** repairing two different responders and retaining the private swizzle; making
  the box the only opener (which loses raw typing for vim, `less`, prompts and `y/n`); a
  native field overlaid on the web dock; or a bare `UIKeyInput`, which cannot preserve IME
  composition and text-field selection behavior.
- **Supersedes:** [Native lends the line field to WebKit by touch location](#native-lends-the-line-field-to-webkit-by-touch-location)
  and the mechanism of [No predictions on the line field](#no-predictions-on-the-line-field).
  It refines [The dock is web, in every touch client](#the-dock-is-web-in-every-touch-client):
  web still draws the dock, while native owns line editing in the app.

### Native lends the line field to WebKit by touch location

- **Historical decision (superseded 2026-10-26):** design (p110).
- The implementation below is deleted; its current replacement is the one-keyboard
  decision above.
- **What:** the web reports the line field's rect (`lineField { rect }`); a passive
  native recognizer sees each touch-down before WebKit does, and a touch that begins
  inside the rect lowers the guard, so WebKit takes first responder straight from
  `TerminalInputView` on the tap. WebKit asks only after the touch ends, so the guard
  stays down until the field's `focusin` confirms with `focus webText`, or 500 ms after
  the touch ends (review p111 caught a guard raised at touch end, which would refuse
  WebKit). Native removes WebKit's form accessory bar. The toggle from the field blurs it in the web, then sends `focus hidden`.
- **Why:** the guard must keep refusing every other tap on the page. Native seeing the
  touch itself has no race with WebKit's focus on the same tap.
- **Rejected:** a `focus webText` sent on pointer-down (races WebKit's focus, as
  client-architecture decision 12 found); the guard off on Terminal (any tap could
  take first responder); a native overlay field (above).
- **Risk:** the passive-recognizer ordering and the accessory-bar removal (no public
  API) are unverified; both are on ios-shell.md's device checklist.

### What the toggle raises, and where key-row keys go

- **Decided:** 2026-10-24, design (p110); the character-key routing accepted by the
  tech lead the same day.
- **What:** with the keyboard down, the toggle raises it for the terminal input; with
  either input holding it, the toggle lowers it. Tapping the line field gives it the
  keyboard, as any text field. Key-row control keys (esc, ↑, ↓, ^R, ^C, tab) always go
  to the terminal; character keys (`/ | ~ -`) go where typing goes, into the field at its
  caret when it has the keyboard. An armed modifier sends a chordable character to the
  terminal; an unchordable character is disarmed and remains in the line. A paste holding
  a line break into the field goes to the terminal as one paste, without Enter. The toggle's
  state follows the focus owner, not keyboard geometry.
- **Changes:** for the four character keys, the wording of Jimmy's two-openers choice,
  "the key row always sends to the terminal". Control keys still always do.
- **Why:** the toggle stays a pure open/close control whose result never depends on a
  remembered earlier state. Control keys have no meaning inside a one-line field
  except caret moves the platform already gives, while the symbol keys are exactly the
  ones that are slow to reach on the iOS keyboard.
- **Rejected:** the toggle reopening whichever input last had the keyboard (hidden
  state); the toggle switching between the inputs (then it isn't open/close); every
  key-row key going to the field while it has focus (Esc and ^C would no longer reach
  the program); every key-row key going to the terminal while the field has focus (a
  `|` tapped mid-line would land at the shell prompt, outside the line being written);
  flattening a multiline paste into one line (it changes the command).

### Sheets lower the keyboard, and closing one gives it back

- **Decided:** 2026-10-24, design (p112).
- **What:** opening a sheet or dialog on Terminal, the switcher included, moves focus
  into it and lowers the keyboard; leaving Terminal for Home or Files lowers it too.
  When a sheet closes, the input that held the keyboard gets it back: native raises it
  through the resting mode; the browser refocuses that input inside the closing tap,
  and leaves the keyboard down when the sheet closed without a tap (back gesture,
  Escape), since Safari raises the keyboard only inside a gesture.
- **Changes:** ios-shell.md's earlier rule that the keyboard stays up under web
  sheets.
- **Why:** a sheet needs the screen: with the keyboard up the switcher's list would be
  a few rows, and keys typed while it is open would go to a terminal the user can't
  see. Giving the keyboard back on close keeps a switch of tabs from costing a toggle
  tap.
- **Rejected:** the keyboard staying up under sheets (above); leaving it down after
  every close (an extra tap per tab switch).

### Return sends a paste with Enter in the same tmux group, and the daemon confirms it

- **Decided:** 2026-10-24, design (p110, revised in p112).
- **What:** the line goes as one `paste { req, watch, text, enter: true }`. The daemon
  starts that tmux command list with `copy-mode -q` so the phone's latest action leaves
  any pane mode, then pastes and sends `Enter`, which tmux skips if the paste fails. It
  answers every paste exactly once: `pasted { req, watch }`, or
  `error { req, watch, code }`, also when the connection refuses it itself
  ([daemon-core.md](daemon-core.md#53-json-messages)). A refused or unanswered paste
  puts the line back into its tab's draft. A paste whose control client exited before
  answering is reported, never resent. The client keeps no timeout of its own: one
  shorter than the daemon's answer would restore a line that ran (review p114). This closes the paste half of L4 ("refusals
  carry no `req`"); it is built as its own daemon lane before or alongside P3a.
- **Found in review (p111):** without an answer naming the paste, a `busy` refusal is
  dropped by the client, the Enter behind it is accepted, and the shell runs whatever
  was already on the prompt line while the field has cleared the user's line.
- **Why:** one message, no extra round trip on a slow link, and no window where the
  Enter can run without its paste. Clearing a laptop's copy mode follows last-active-wins:
  the user's phone action takes effect. A pane that asked for bracketed paste sees the
  line delimited and the Enter outside it, so the Enter submits.
- **Rejected:** preserving another client's copy mode for a phone paste with Enter (then
  tmux accepts Enter in the mode while the daemon reports the line sent); the client
  sending `{ key: "Enter" }` after `pasted` (p110's first
  version: a round trip per line, and the Enter can still meet a different prompt if
  something else typed in between; it stays the fallback if an agent CLI absorbs an
  immediate Enter); the text as literal `input` keystrokes (an agent CLI may read the
  burst as a paste and swallow the Enter); an Enter inside the pasted text (in bracketed
  mode it is a newline, not a submit); resending a paste whose answer was lost (it
  could run twice).
- **Risk:** whether Claude Code and Codex submit on an Enter that immediately follows a
  bracketed paste is unverified; a P3a gate.

### The key row stays with a hardware keyboard

- **Decided:** 2026-10-24, design (p110).
- **What:** the dock is the same with a hardware keyboard attached: the key row shows
  while an input holds focus, as with the on-screen keyboard.
- **Why:** the browser cannot detect a hardware keyboard reliably, and one layout is
  easier to get right.
- **Changes:** ios-shell.md's collapse to a thin strip.
- **Rejected:** collapsing in native only (two layouts of one web dock).

### The keyboard spike is retired

- **Decided:** 2026-10-24, design (p110), confirming the tech lead's lean.
- **What:** `ios/spikes/keyboard/` and `spike-1-keyboard.md` are deleted. The questions
  that still matter (the guard through sheets, rotation and a killed web process; the
  hidden-keyboard trick; WebKit's selection under the guard; geometry; terminal input
  traits; hardware keys; keystroke latency; the Face ID Keychain item) and the new
  line-field lending moved to the device checklist in ios-shell.md, run in P4.
- **Why:** half of what it tested (the native accessory key row and compose field) no
  longer exists, its harness is not tether's UI, and Jimmy found it could not judge the
  UI quality that is now the bar. P3 builds the real dock against real tmux.
- **Rejected:** updating the spike to the web dock (it would become a second copy of
  P3a); running it as is (it tests the old design).

### Vocabulary: dock, tab chip, line field, key row, keyboard toggle, switcher

- **Decided:** 2026-10-24, design (p110, p112).
- **What:** the **dock** is the touch stack at the bottom of Terminal; the **tab chip**
  its control naming the active tab; the **line field** its one-line text field; the
  **key row** its row of terminal keys, shown while the keyboard is up; the **keyboard
  toggle** the one keyboard control. The **switcher** is the phone's session sheet
  behind the tab chip; the **picker** is the desktop's attach-only modal. A **draft** is the line field's unsent text
  for one tab. "Compose", "draft editor", "tab row" and "Insert" (for text) are retired.
- **Rejected:** "line editor" and "edit box", which collide with the shell's own line
  editor (zle, readline); "compose", tied to the removed multiline editor; "picker" for
  the phone sheet, whose contents (tabs, creation) differ from the desktop picker's.


## Window size follows the client that acted last

Jimmy was asked whether "the laptop can't grow a window the phone watches" was
acceptable (plan.md "Still open"). The calls below are his; the mechanism and the
client display are design (spawn p115), probed on tmux 3.4 and 3.7b
([probe-latest-activity.md](research/probe-latest-activity.md)).

### Whoever acted last gets the window's size

- **Decided:** 2026-10-24, Jimmy ("just whoever has the last focus gets the focus and
  the size of the screen").
- **What:** tmux's `window-size latest`, extended to tether. A watch **claims** its
  window with `watch`, `resize`, `input` and `paste`, and its owner votes that watch's
  size; when another tmux client acts there, the window **yields**: the vote clears,
  the watch stays, and tmux sizes the window by `latest`
  ([daemon-core.md §3.6](daemon-core.md#36-sizing)).
- **Changes:** "Sizing: client size at attach, a vote per watched window" above, whose
  vote stood for as long as the tab was on screen and capped the window whoever was
  `latest`, and "The cwd subscription's shape", whose `@W:#{pane_current_path}` value
  gains the other clients' acts (below). The client size at attach stays.
- **Rejected:** keeping the cap (the laptop could never take back a window the phone
  had on screen); `window-size smallest` (the laptop would always be phone-sized while
  the phone watched); `largest` (the phone would always get the laptop's size, the
  opposite of "whoever I'm using"); dropping the vote after N idle minutes (a timer
  where an act is the signal).
- **Changed 2026-10-25:** a claim now makes tmux size the window to the watch exactly,
  not only cap it: the owner takes `latest` with a same-session `switch-client` when it
  starts voting ("tether takes tmux's `latest` with a same-session `switch-client`").

### "Acts" means input or bringing the tab on screen, not looking

- **Decided:** 2026-10-24, design (p115).
- **What:** the phone claims when the user brings a tab on screen (opening, switching
  to it, returning from Home or Files, unlocking into it), on rotation or a font
  change, on every keystroke and paste, and on Fit. A tab that stays on screen claims
  nothing, nor do scrolling the history and `resync`. A re-watch the client makes by
  itself (a reconnect, a retry) sends `watch { claim: false }` unless the tab held the
  window when its watch ended.
- **Why:** coming on screen is the phone's attach or `switch-client`, which tmux itself
  counts as making a client `latest`. Opening the app is the moment Jimmy picks up the
  phone to use it; making him type a key to read the screen would put junk in the
  shell. A phone propped on the desk with the tab open sends nothing, so it never
  takes the window back while he types on the laptop.
- **Rejected:** input only (opening the phone would show a laptop-sized window until a
  key); any message on the watch, `history` included (scrolling back to read would
  shrink the laptop's layout); a `claim` message (`resize` already says "this is my
  size", and Fit re-sends it); every `watch` claiming, reconnects included (review
  p119: on a spotty link each blip would shrink the laptop's window mid-command, though
  nobody touched the phone).
- **Cost:** `watch` carries a flag, and the client must tell a user's re-watch from its
  own.

### The other client's act is seen through the window subscription

- **Decided:** 2026-10-24, design (p115). Probe:
  [probe-latest-activity.md](research/probe-latest-activity.md).
- **What:** the `w<W>` subscription, which carried only the cwd, becomes the window
  subscription: it also lists, with tmux's client loop `L:`,
  each non-control client whose current window is `@W`, with its activity time, size
  and flags. A new or changed entry is an act, except a focus-out alone and a client
  with `ignore-size`; the first value is the baseline
  ([daemon-core.md §3.7](daemon-core.md#37-window-subscription)).
- **Why:** it catches every act that makes a client `latest` (key, mouse, focus,
  switching to the window, attaching, a terminal resize), costs nothing while nobody
  else types, adds no op, and reuses a subscription with the same lifetime. tmux
  already checks it once a second.
- **Rejected:** tether becoming `latest` itself (only the session's current window can
  be made `latest`, by switching the control client, which the laptop's session
  shares; other windows can't, and a vote still caps); a `client-active` hook
  (`set-hook` changes Jimmy's tmux config and can't reach the daemon); polling
  `list-clients` (a timer in the daemon); one session-wide subscription (inside `L:` a
  client's window is the outer one, so it can't say which window a client is on, and
  its value would change whenever anyone typed anywhere); a separate `a<W>`
  subscription (a second op pair with the same lifetime); comparing activity times with
  the claim's time (one-second resolution; the phone's next act fixes a stale yield).
- **Cost:** yielding lags the other client's act by up to about a second; a claim
  still caps, so the phone gets the smaller dimension when the laptop's window has
  fewer rows. Flags in the entry (review p119): without them, a focus-out, which
  updates a client's activity but not `latest`, would yield.
- **Changed 2026-10-25:** tether does become `latest`, for the session's current window,
  which is the only window a claim is on now that tabs follow sessions; the cost "a
  claim still caps" is gone. The subscription still detects the other client's act,
  which is when the vote clears ("tether takes tmux's `latest` with a same-session
  `switch-client`").

### A window sized for another terminal is clipped, not scaled

- **Decided:** 2026-10-24, design (p115).
- **What:** the client draws the pane at tmux's size and its own font, from the left
  edge. Wider content is cut off at the right; taller content follows the cursor
  through the existing cursor pan, or anchors to the top while scrolled into history.
  While the pane is larger the tab uses xterm's DOM renderer. After a second larger
  than the size the tab sent, the status band says "Sized for another terminal" with
  Fit, which re-sends the tab's size and so claims. A smaller pane sits in the
  top-left corner with no band (client-architecture.md §5.4).
- **Why:** a window sized for another terminal is for glancing: the left of each line
  and the cursor area stay readable, and Fit is one tap away when Jimmy wants the whole
  screen. The band needs nothing from the daemon: a claimed window is never larger
  than the tab.
- **Rejected:** scaling the font down to fit (200 columns on a 56-column phone is
  unreadable at any floor, and a font change would feed the sizer and claim the window);
  CSS scaling (blurs the WebGL renderer and breaks cell mapping); horizontal panning
  (horizontal swipes belong to the system back gesture); centring a smaller pane
  (text moves away from where the eye expects it); keeping WebGL at any pane size
  (review p119: its canvas grows with the other terminal, about 17 M device pixels for
  250×70 at 3×, past WebKit's canvas limit); a band shown the moment the pane is larger
  (it would flash on every rotation, Fit and tab open).
- **Changed 2026-10-25:** the band shows whenever the window's size differs from the
  tab's, smaller included, and the daemon reports the window's size in `watching` ("The
  band shows whenever the window isn't at this screen's size").

### Files in landscape lowers the keyboard, as in portrait

- **Decided:** 2026-10-24, Jimmy ("yes").
- **What:** leaving Terminal for Files lowers the keyboard in landscape as in portrait
  ([browser-behaviors.md](client/browser-behaviors.md#phone-dock)); no layout keeps it
  up over Files.

### Touch scroll is JS momentum over xterm and a DOM history view

- **Decided:** 2026-10-24, P3b build.
- **What:** one recognizer owns every touch on the terminal and a release coasts with an
  exponential decay (time constant 500 ms). The normal screen scrolls xterm's buffer by rows,
  then slides the terminal down onto a DOM view of tmux's older rows fetched on demand;
  full-screen and mouse-mode applications get wheel events or ↑/↓. A long-press hold with a
  drag is the arrow pad; a release without moving selects the word in an immutable snapshot
  of one DOM row per grid row.
- **Why:** the recognizer must tell a tap, a scroll and a hold apart before anything reaches
  tmux, which a native scroller cannot do; rows of fixed height keep the snapshot, the history
  and the canvas on one grid however the text wraps, and joining them at the wrap flags the daemon
  sends keeps copy logical.
- **Rejected:** a native `overflow: auto` scroller (it owns the touch, so long-press and
  taps cannot be arbitrated, and it cannot reach rows xterm does not hold); tmux copy-mode
  (the plan's fallback: every scroll would change the pane's state, and tmux's own state is
  what tether must not disturb); CSS-wrapped logical lines in the snapshot (wide characters
  and fractional cell widths misalign it); custom selection handles (the spec chose the system's;
  the device check decides whether they appear on a programmatic selection).


### iOS Link resolves the socket without exposing host routing in page state

- **Decided:** 2026-10-24, tech lead (P4a review, p142).
- **What:** a `HostLink` asks native with `{type:"socket", host}`; native replies with
  `{url, token}`, `{locked:true}` or `{notEnrolled:true}`. The URL is
  `wss://<stored host>/ws`. The URL and token stay inside that Link and are never
  persisted or copied into `PlatformHost`, workspace or general app state.
- **Why:** the web must own the socket for direct frame delivery, but it does not need
  the native host registry or a second credential store.
- **Rejected:** putting `baseURL` on `PlatformHost` (host routing leaks into ordinary
  page state); WebSocket over `tether-app://` (a scheme handler cannot carry it); native
  `URLSessionWebSocketTask` (keep as fallback only if spike 3 finds stuck sockets).

### Native caches the web's active tab for keyboard batches

- **Decided:** 2026-10-24, tech lead (P4a review, p142).
- **What:** web sends `activeTab { tab: TabKey | null }` when selection changes; native
  uses that cache to tag a whole coalesced keyboard batch. The web still drops input
  for a stale or closed tab.
- **Why:** the hot input path needs one native-to-web bridge crossing per batch.
- **Rejected:** asking `activeTab()` for every batch (a second bridge round trip for
  every keystroke); native mirroring the workspace's tab model.

### Host management has a typed native presentation request

- **Decided:** 2026-10-24, tech lead (P4a review, p142).
- **What:** the web's Home/Settings host-management entry sends `manageHosts`; native
  presents the server sheet. Remove the floating native Servers control when that web
  entry lands.
- **Why:** one intentional web entry avoids covering application content while the
  sensitive host/enrolment screen remains native.
- **Rejected:** a generic `nativeModal` bridge (arbitrary page-driven native UI is not a
  stable contract); retaining the floating overlay after the web entry exists.

### User Copy is not an OSC 52 server write

- **Decided:** 2026-10-24, tech lead (P4a review, p142).
- **What:** bridge `copy { text }` always writes user-selected terminal text to the
  system pasteboard. Server-origin OSC 52 remains a separate, disabled web policy.
- **Why:** applying the server-write gate to user-initiated Copy made the terminal's
  Copy command silently fail by default.
- **Rejected:** gating every copy through a native setting; conflating user and server
  clipboard provenance in one bridge message.

### Restore the existing iOS auth and background policy

- **Decided:** 2026-10-24, tech lead (P4a review, p142), per
  [auth.md](auth.md#swift-side-keychain-item-and-app-lock).
- **What:** one `tether.tokens` Keychain item stores the token map with
  `WhenPasscodeSetThisDeviceOnly` and `.biometryCurrentSet`. Reading it is the Face ID
  unlock, done off the main thread; tokens stay in memory until lock. Reset tokens is
  explicit recovery. Background starts a short task so the web closes sockets; the app
  locks only on foreground after more than five minutes away.
- **Why:** one read unlocks all hosts without repeating prompts, while short app
  switches do not force another biometric check.
- **Rejected:** a Keychain item per host; app-level passcode authentication in front of
  a separately protected token; locking at every background transition.

### Keep the Termius-quality keyboard layout without a WebKit bar

- **Decided:** 2026-10-24, tech lead (P4a review, p142).
- **What:** suppress the WebKit form accessory bar through the private
  `WKContentView` input-accessory path; if the class path is absent, leave the bar in
  place rather than fail the app. Keep the ^C/^D warning haptic for native hardware
  input and expose the warning kind for the web key row.
- **Why:** the `⌃ ⌄ ✓` strip between keyboard and dock falls below Jimmy's Termius UI
  bar; explicit warning feedback stays attached to terminal interrupts.
- **Rejected:** accepting the form bar as a permanent layout element; dropping the
  warning haptic and treating ^C/^D as ordinary key taps.

### Defer the Debug dev-server asset source

- **Decided:** 2026-10-24, P4a review (p142).
- **What:** P4a always bundles its web assets. A Debug-only dev-server source/HMR path
  is deferred to `ios/.context/FUTURE`; the bundled CSP is not relaxed for it.
- **Why:** the optional shortcut needs a separate trusted-origin, certificate, HMR and
  CSP check; desktop browser/Vite remains available for iteration.
- **Rejected:** shipping an unverified dev-server route and broader CSP with the shell.

### P3b touch state is per shown tab, in one object

- **Decided:** 2026-10-24, tech lead, after the P3b reviews (p141 correctness, p144 structure).
- **What:** the recognizer shell, scroll with momentum, history view and selection snapshot
  live in `screens/terminal/view.ts`, which is told the shown tab and resets all of it when
  that changes, on a snapshot, on `visibilitychange` and on a lost pointer capture. Its sends
  are bound to the tab id they began on. Touches on the selection layer are left to the system
  (handles, scrolling). History chunks overlap the oldest known row by one and restart the view
  on a mismatch; wrap flags are carried across chunk and buffer seams; rows are dropped on return
  to the newest line; a refused chunk waits 1.5 s. `Row` carries cells (exact for xterm rows).
  The desktop wheel continues past xterm's top into the history; `scrolled` follows the renderer.
  `term/buffer.ts` and `bufferText` are deleted (the touch copy path joins `Row`s).
- **Why:** a coast or held pad is state of one tab on a surface every tab shares; resetting only
  on the next snapshot let it type into the next tab. Resetting at the one place the shown tab
  changes ends the class.
- **Rejected:** capturing the tab id in the scroll control alone (patches one instance); keeping
  a second logical-text path in `term/`; guessing cell widths from text for xterm rows.

### Native lifecycle messages are full snapshots

- **Decided:** 2026-10-24, P4a review (p142).
- **What:** app visibility, reachability, lock and native coverage travel together in a
  complete `lifecycle` snapshot; `covered` is not a separate bridge event.
- **Why:** web admission and socket watching recompute one predicate from the current state,
  without merging deltas that may arrive after a page restart.
- **Rejected:** a separate `lifecycle.covered { covered }` event alongside a partial lifecycle
  update. Reconcile the earlier bridge table in the P4b design source before implementing it.

### Track expected token-item state without storing credentials in app preferences

- **Decided:** 2026-10-24, P4a review (p142).
- **What:** a non-secret preference records whether a non-empty Keychain token map is
  expected. A missing expected item stays locked so the user can explicitly reset it;
  Reset clears the marker while preserving saved host labels as not enrolled.
- **Why:** Keychain can report an item as missing after a Face ID change, which must not
  silently turn an auth recovery state into an ordinary un-enrolled state.
- **Rejected:** treating every missing item as an explicit reset (the recovery screen
  becomes unreachable) or persisting any token data outside the one Keychain item.

### P4a round-two review: gate focus, validate keys, and bind revocation to its token

- **Decided:** 2026-10-24, implementation follow-up to review p148.
- **What:** `FocusController` records focus requests while a native cover is up and
  applies the latest request on uncover; queued terminal input is discarded while locked
  or covered. `KeyMapper` omits Shift for names outside the daemon's shiftable set,
  exhaustively checks mapped key codes and modifiers against `is_key_name`, and sends
  Option plus printable non-alphanumeric ASCII as ESC-prefixed bytes (Option+Space is
  `M-Space`). Keychain updates reuse the successful unlock's `LAContext` and all
  Keychain operations run on a serial background queue; lock invalidates that context.
  A 401 refusal carries the exact sent token and revokes only a matching stored token;
  a refusal arriving while locked keeps only a token digest. Native media requests use
  the cached `activeTab` bridge message rather than querying page state.
- **Why:** review probes found that focus/input could bypass covers, Shift on Escape or
  Backspace generated names rejected for the entire batch, and a late 401 could erase a
  replacement credential. The one cached active-tab path keeps media and keyboard targets
  consistent without a second WebKit crossing.
- **Rejected:** restoring only the focus saved when the cover first appeared (it loses
  requests made under the cover); accepting unvalidated named keys; deleting by host id
  alone; and asking page JavaScript for its active tab a second time.

### P3b round 2: the snapshot window, anchors, one shown rule
- **Decided:** 2026-10-24, tech lead, after review p147.
- **What:** the selection snapshot holds `[viewTop − 2,000, viewBottom]` rows with the 512 KiB budget counted up from the view's bottom, so a long-press works wherever the view is in a 5,000-row buffer (`renderer.rows(from, to)`). A history chunk is asked for with up to 8 rows already known (the oldest fetched, or xterm's first rows for the first chunk) and `anchor.ts` finds them in it, nearest to where they should be; the rows before them are the new ones. Only a later chunk that does not contain them restarts the view. `ScrollControl.scrolledChanged()` is the one place `scrolled` is reported and fetched rows are dropped on the way back to the newest line. The paste, copy and inserted-path concern is `Pastes` in `paste.ts`. The view resets on `shownTerminalTab` (selected and not covered by a native screen), the same rule its sends use.
- **Why:** the window was anchored on the newest rows, so a view more than 2,000 rows up found nothing. One byte-row compare at a seam passed on blank or repeated rows and hid a shift; a run found nearest the expectation does not, and recovers a shift instead of discarding the history.
- **Rejected:** the daemon's `historySize` for re-anchoring (it says the size, not where the known rows moved to, and the first chunk would still need xterm's rows); keeping two "shown" rules (a coast kept ticking under a native cover, every send dropped).

### Guard the client subscription against unidentified tmux clients

- **Decided:** 2026-10-24, investigation of the scratch-server crash.
- **What:** the `L:` subscription checks `client_height` before expanding `client_name`.
  On tmux 3.4, an accepted socket is visible to `L:` before IDENTIFY finishes and
  before `client_name` exists; its format callback calls `xstrdup(NULL)`. An initialized
  terminal client has a height, so this guard keeps the same entries for every attached
  non-control client while skipping the transient state. Keep the gated real-tmux test
  that holds an unidentified Unix-socket client through the subscription timer.
- **Why:** the exact subscription crashed an isolated tmux 3.4 server with the same
  `format_find → xstrdup(NULL)` stack as the reports. The raw-socket repro also passes
  on 3.7b and 3.8, but tether cannot rely on a tmux version's incidental client-list
  filtering to keep the server alive. Evidence and the minimal repro are in
  [tmux-subscription-format-crash.md](research/tmux-subscription-format-crash.md).
- **Rejected:** changing only `client_control_mode` or the membership match (the crash
  happens when the selected format looks up `client_name`); requiring a newer tmux
  (3.4 is a supported server version); or omitting client names/activity and losing
  the act detection behavior.

### Native uploads are named by the web, not guessed by native

- **Decided:** 2026-10-24, tech lead, after the P4b review (p159). Bridge v2 had not shipped, so v2 changed in place.
- **What:** `pickMedia { id, host }` and `readPasteboard { tab, id }` carry an id the web chose and the host to upload to; every `upload { id, progress, path?, error?, cancelled? }` event carries that id back, and the adapter routes events by id alone. A dismissed picker sends a terminal `cancelled` event. Native sends an upload's first event after its reply. Upload works with no tab open. Native keeps no tab for media, so `activeTab` serves keyboard batches only. This supersedes the `activeTab()` page callback in "Bridge cleanup" (already replaced by the cached `activeTab` message) and the cached-tab media targeting in "Native caches the web's active tab". A pasted image inserts its path into the tab pasted into (the user's intent is clear); a Files upload only offers "Insert path".
- **Why:** native chose the host and stream from its own cached state, so a pasted image could be claimed by an abandoned Files pick, and Upload did nothing with no tab or went to the active tab's host rather than Files'.
- **Rejected:** a first-match by host (the bug); a host and optional tab on `pickMedia` with a version bump (the tab would only be echoed back, and the web already knows its target); native reporting `upload` events with `host` and `tab` for the web to match.

### Native draft conflicts: stored revision greater than the base

- **Decided:** 2026-10-24, tech lead, after the P4b review (p159).
- **What:** `DraftStore.put` returns `conflict` only when the stored revision is greater than `baseRevision`, as the browser does. The check runs in Swift, and client-architecture.md §5.6 says so.
- **Why:** the web's base is the last revision it issued, so after one `failed` put the retry's base is ahead of the store. An equality check answered `conflict` and the reducer dropped the draft.
- **Rejected:** moving the check to JS (the page cannot see the stored revision without another round trip).

### The app registers a stand-in `terminal` focus target

- **Decided:** 2026-10-24, tech lead, after the P4b review (p159).
- **What:** `FocusController.nativeTerminal()` returns a hidden element whose `focus()` and `blur()` announce themselves as DOM focus events (so owner tracking, dialog returns and the viewport's keyboard-drop rule work unchanged) and ask native for the resting mode. There is no separate native branch in `toggleKeyboard`.
- **Why:** the keyboard toggle, leaving Terminal and returning from a dialog had one path in the browser and a special case in the app, which missed the dialog return.
- **Rejected:** a `directInput === "native"` branch in the controller.

## The Mac front

Decided 2026-10-24 by design (p171), within Jimmy's decisions above, revised after
reviews p172 and p173, and simplified for Jimmy's answers (one account, a LaunchAgent,
log upload left on). Probe results: `.meridian/work/tether-mvp/mac-front-probes.md`.

### Publication and admission use one canonical-origin rule

- **What:** one `MacFront { port, secret }` owns target formatting, recognition of
  earlier tether-shaped handlers, and assembly of the Serve target, publication and
  request gate. Publication first plans edits to the raw Serve JSON, preserving
  unrelated fields and handlers, then deserializes the planned config and judges it
  with `ServeConfig::canonical_origin(&target)` before any POST. A plan refused by
  this rule never writes; request admission applies the same rule to the current
  config.
- **Why (review p184):** the previous publication-specific checks accepted configs
  the canonical-origin rule later rejected (including a TCP forward and a handler at
  another port), so tether could publish a front that then refused every browser. One
  policy boundary prevents those checks from drifting apart.
- **Rejected:** separately re-implementing Funnel, TCP/443 and handler checks in the
  publication plan; validating the daemon-generated proxy URL by parsing it back into
  a URI; overwriting an existing handler to make the proposed config appear canonical.

### Canonical-origin refusals retain their cause

- **What:** `canonical_origin` returns a typed refusal reason, and renders a
  target-specific message naming the actual conflict and its repair. In particular,
  messages distinguish Funnel, a TCP forward on the HTTPS port, and a sibling handler
  at its real mount path. Never include proxy URLs in messages: a Mac proxy contains
  the path secret.
- **Why (review p186):** returning only the offending target reference made a plan
  report tether's newly invented `/_` handler instead of the app's real `/` handler,
  and hid the Funnel or TCP-forward condition that caused rejection.
- **Rejected:** reconstructing the cause from the final message or logging an entire
  proxy target to make the conflict more specific.

### tether writes its own Serve entry and picks a new path secret at each start

- **What:** `tether serve --publish` reads the serve config and its `Etag` through
  LocalAPI, changes only `Web["<MagicDNS name>:443"]`, `TCP["443"]` when it is
  missing, and its own earlier handlers (tether-shaped:
  `http://127.0.0.1:<its port>/tether-<43 base64url chars>`), and writes it back with
  `If-Match` only when the resulting config passes canonical-origin validation. It
  publishes once per start and never unpublishes.
- **Why:** the macsys proof token, which tether already needs to read LocalAPI, can
  write the serve config, and `If-Match` turns the write into a compare-and-swap
  (probed: a wrong `Etag` gets `412`). The extension logs the full target at every
  write, so a secret that never changes would stay valid in every log copy forever;
  a new one each start makes those copies stale.
- **Rejected:**
  - Jimmy running a publish command with a secret stored in `config.toml`: one more
    copy of the secret on disk, no rotation, and a step to repeat by hand.
  - Rotating on a timer: each rotation is another write and log line, and live sockets
    would need both secrets for a while; the threat it shortens needs local code on
    the Mac.
  - Re-publishing whenever the config loses tether's entry: it would undo Jimmy's own
    `tailscale serve reset`.
  - Removing tether-shaped handlers for any port: a handler for another port isn't
    this front's publication, and tether changes only what it published.
  - Putting the secret somewhere the extension doesn't log: a Serve target is a URL
    and the extension logs it whole, userinfo included; Serve can't add a header.

### Publishing needs `--publish`

- **What:** without it a Mac daemon binds only `local.sock` and never touches the
  serve config. On Linux the flag is a configuration error (exit 78).
- **Why:** the real-daemon e2e stack and dev runs start `tether serve` on the Mac; a
  daemon that published on every start would overwrite Jimmy's Serve entry during
  tests.
- **Rejected:** always publishing on macOS (the above); a `config.toml` key (it would
  apply to every daemon that reads Jimmy's config, including one he starts by hand to
  debug; the flag puts publishing in the command, which the LaunchAgent carries); a separate `tether publish` command (the publication must follow the
  daemon's life, which only the daemon knows).

### launchd holds the Mac front's socket

- **What:** the LaunchAgent's `Sockets` entry `Listener` binds `127.0.0.1:7851` when
  Jimmy logs in; the daemon takes it through `src/launchd.rs`, sets `FD_CLOEXEC`
  unconditionally, makes it non-blocking and hands it to tokio. `--publish` without it exits 78 with "no launchd socket
  `Listener`", since launchd's `ESRCH` means either "not a launchd job" or "no such
  socket" (p175). The front is published on the MagicDNS name's port 443 only.
- **Why:** the publication must not point at a port something else can bind while
  Jimmy uses it. If the daemon owned its listener, every crash, `kill -9`, jetsam kill
  or hub failure would free the port while Serve still pointed at it, and whatever
  bound it would receive the iOS app's device token (review p172). launchd keeps the
  port bound across all of those (probed). The iOS app adds a host by its MagicDNS
  name, so 443 is the port it uses.
- **A socket launchd couldn't bind:** if a process holds the port when the agent
  loads, launchd's bind fails silently and the job gets one unbound fd (probed, p177),
  while Serve's entry from the last session points at that process. The daemon
  requires the socket at `127.0.0.1` with a non-zero port; otherwise it withdraws
  every tether-shaped handler (any port) from `Web["<name>:443"]`, trying for 2 s, and
  exits 78. launchd's 10 s restarts retry it. Rejected: exiting without withdrawing
  (the phone's device token keeps going to that process); checking only in gate M0
  (a login item can race launchd at any login).
- **Costs:** a fixed port that something else may hold (the plist's to change); the
  plist must carry `PATH`; one module with `unsafe`.
- **Rejected:**
  - A port the daemon binds itself, kernel-picked or fixed: freed by every crash. A
    probe showed a wildcard bind with `SO_REUSEADDR` on the same port can even
    pre-position while tether's own listener runs, and receive Serve's connections
    the moment tether stops.
  - A watchdog parent process holding the socket: dies with the daemon under `kill
    -9` of the process group or jetsam.
  - A wildcard or tailnet address: tailnet clients would reach tether without Serve.
  - A configurable HTTPS port: the app can't use it.

### The path secret is checked first, in constant time, and answers an empty 404

- **What:** before any header is read, the raw path must start with
  `/<path secret>/`, compared with `subtle`; a mismatch is a `404` with no body and no
  log above `debug`. A match strips the secret from the URI, so no later layer or log
  sees it. The check runs in the accept loop's per-request service, before the
  router: axum routes before `Router::layer` middleware runs, so a gate there would
  see paths already routed as `/<secret>/…` (review p172).
- **Why:** everything after the gate trusts headers that only Serve should be able to
  write. An empty 404 tells a local prober nothing about what listens.
- **Rejected:** checking `Host` or the Tailscale headers first (they are forgeable,
  and judging them costs a tailnet-state read); `403` with tether's JSON error body
  (identifies tether to a prober).

### The Mac front's `Host` rule uses the authority tether published

- **What:** `Host` must equal `<MagicDNS name>` (`:443` optional) and exactly one
  `X-Forwarded-Host` must equal it, both held in memory from the publication; before
  a publication, `503 identity_unavailable`.
- **Why:** Serve passes a TCP target the browser's `Host` and sets `X-Forwarded-Host`
  to the same value (probed by p170). The rule is a cheap filter like `serve.sock`'s
  `localhost` check; the node lane still compares `X-Forwarded-Host` with the canonical
  origin. Holding it in memory keeps the native lane free of a LocalAPI read it
  doesn't otherwise need.
- **Rejected:** no `Host` rule (a misdirected publication would go unnoticed); comparing
  with the canonical origin on every lane (a handler added beside tether would refuse
  the native app too, which on Linux keeps working).

### The LocalAPI transport is chosen at startup and its endpoint found per connection

- **What:** Linux keeps its Unix-socket search. macOS uses the proof-token TCP
  transport: the macsys files first (`/Library/Tailscale/ipnport`,
  `sameuserproof-<port>`), then the App Store app's `lsof` lookup. The endpoint is
  looked up again whenever a connection opens. Failures stay `503
  identity_unavailable`, never a startup refusal.
- **Why:** the extension's port and token change when it restarts. The macsys lookup is
  two system calls; `lsof` spawns a process, so it goes second, unlike Tailscale's CLI.
- **Rejected:** a `TETHER_LOCALAPI` override (a test hook in the production identity
  path, rejected before for the e2e stack); resolving once at startup (a Tailscale
  restart would need a tether restart); the App Store lookup first (a process spawn on
  every reconnect on the common install); verifying who listens on LocalAPI's port
  (an unprivileged process can't see root's sockets, p170); re-reading `ipnport`
  before every request, reconnecting on `401`/`403`, and exiting when the endpoint
  the daemon published through changes (reviews p172, p173): they shortened another
  account's hold on LocalAPI's old port, and a one-account Mac accepts the window
  ([auth.md](auth.md#threat-model)).

### macOS binds no `serve.sock`

- **What:** a Mac daemon binds `local.sock`, plus the Mac front with `--publish`. The
  Unix Serve front stays in the code, and integration tests build it on any platform.
- **Why:** the extension can't connect to it, so it would be a front nothing can use,
  and the canonical-origin rule would point Jimmy at a `sudo tailscale serve unix:…`
  command that gives 502.
- **Rejected:** keeping it for a Homebrew `tailscaled` setup (rejected as a setup;
  the macOS transport doesn't look for its socket).

### The publication has one owner, and `tether enroll` asks the daemon on a Mac

- **What:** one task owns the publication's state. Publishing removes every
  tether-shaped handler that targets the front's port, wherever it is, and drops
  entries and plain-HTTPS `TCP` ports it leaves unused. Refusal text comes from each
  serve target, so a Mac never shows the Linux `sudo tailscale serve` command. On a
  Mac `tether enroll` prints what the running daemon's `GET /auth/info` says over
  `local.sock`.
- **Why (review p172):** a handler left under an old MagicDNS name would make the
  serve target appear twice and refuse browsers; only the daemon knows its secret, so
  a separate computation in `tether enroll` couldn't apply the "named exactly once"
  rule.
- **Rejected:** a file in the runtime directory recording the published origin for
  `tether enroll` (a second copy of state the daemon already serves).

### tether never removes its Serve entry

- **What:** no exit path unpublishes. The next start replaces a stale handler; in
  between Serve answers `502`. To stop tether, Jimmy runs `launchctl bootout` and then
  `tailscale serve --https=443 off`, which removes tether's entry: tether refuses to
  share it, so the whole entry is tether's. Stopping for good also removes the plist.
  The one removal tether makes is the withdrawal below, at a start whose socket
  launchd couldn't bind.
- **Why:** unpublishing guarded the port from other accounts after a stop (reviews
  p172, p173). On a one-account Mac, while Jimmy is logged out only trusted processes
  run; after a deliberate stop, Tailscale's own command closes the window. A crash
  needs nothing (launchd holds the port), and a logout needs only the next login's
  start, which replaces the entry or withdraws it.
- **Rejected:**
  - Unpublishing on `SIGTERM`, with the publication task cancelled and joined first and
    a 2 s compare-and-swap retry (p171–p173): a shutdown path, its race with a late
    publish write, and a deadline, for no account that needs it.
  - `tether unpublish [--port]` as the stop's second step: duplicates `tailscale serve
    --https=443 off` for an entry that is tether's alone.
- **Changed:** by "Teardown removes tether's Serve handlers" (2026-10-25): the daemon
  still never removes its entry, and `tether teardown` does the whole stop.

## tether setup

### Setup runs in the foreground by default

- **Decided:** 2026-10-25, Jimmy.
- **What:** plain Linux `tether setup` runs tether in the terminal until SIGINT or
  SIGTERM; `tether setup --background` installs the systemd user service. Plain setup
  on a Mac refuses before changing anything; the LaunchAgent is still the only Mac
  front phones can reach.
- **Why:** Jimmy chose plain `tether setup` to stay attached to the terminal; background
  installation requires an explicit flag. Stopping the process does not imply ownership
  of the tailnet's Serve config.
- **Rejected:** background by default (Jimmy chose foreground); a foreground Mac run
  over loopback TCP (phones cannot reach it without launchd's socket, and an unsecreted
  loopback port is the Mac front's known hole); withdrawing Serve on Ctrl-C (a crash
  would leave the entry anyway, and reruns would churn the config).

### Linux setup publishes as the operator

- **Decided:** 2026-10-25, lead (setup review findings).
- **What:** Linux `tether setup` writes Serve through LocalAPI as Jimmy, the Tailscale
  operator, after the first-run grant.
- **Why:** reruns and teardown need no root command when the account has the operator
  grant, and LocalAPI's compare-and-swap preserves concurrent changes from other apps.
- **Rejected:** running `sudo tailscale serve` by hand each time.

### The Linux daemon never writes Serve

- **Decided:** 2026-10-25, lead (setup review findings).
- **What:** on Linux only setup publishes Serve; the daemon never writes it.
- **Why:** the daemon may start at boot before setup has granted the operator, and
  setup and the daemon would otherwise race as two publication owners.
- **Rejected:** having the Linux daemon publish like the Mac daemon.

### Every background setup run restarts tether

- **Decided:** 2026-10-25, lead (setup review findings).
- **What:** every successful `tether setup --background` run restarts the service,
  even when its installed file is identical. Foreground setup starts the daemon in the
  current process instead.
- **Why:** rerunning background setup is how Jimmy applies a config change, upgrade or
  fix.
- **Rejected:** restarting only when the service file changes.

### Automatic setup uses only `~/.cargo/bin/tether`

- **Decided:** 2026-10-25, lead (setup review findings).
- **What:** background setup installs a service that runs only `~/.cargo/bin/tether`.
- **Why:** both embedded service definitions use that fixed path and setup can verify
  the invoked binary against it.
- **Rejected:** templating Linux `ExecStart`; deferred under "Not in setup".

### systemd is the only automatic Linux service manager

- **Decided:** 2026-10-25, lead (setup review findings).
- **What:** background Linux setup supports systemd only; foreground setup needs no
  service manager.
- **Why:** no target host uses another service manager.
- **Rejected:** adding OpenRC and runit support.

### Mac background setup refuses a second login account

- **Decided:** 2026-10-25, lead (setup review findings).
- **What:** background setup refuses to install on a Mac with another login account.
- **Why:** the loopback front's local-process defences assume Jimmy is the Mac's only
  user account.
- **Rejected:** warning and proceeding with the second account present.

### `/auth/info` reports `browserPending`

- **Decided:** 2026-10-25, lead (setup review findings).
- **What:** `/auth/info` has an explicit `browserPending` field while Mac publication
  waits or retries; it is false on Linux.
- **Why:** setup must distinguish a retrying publication from a final refusal while
  `browserRefused` retains the latest error.
- **Rejected:** inferring pending state from the error text.

### Teardown removes tether's Serve handlers

- **Decided:** 2026-10-25, lead (setup review findings).
- **What:** `tether teardown` stops the service, withdraws only matcher-recognized
  tether handlers, and removes the service file. The daemon still never unpublishes
  on exit.
- **Why:** teardown reverses setup while preserving other Serve entries and handlers.
- **Rejected:** removing the publication on every daemon shutdown, or asking Jimmy to
  clear the whole HTTPS entry by hand.

### Setup's prompts, clipboard and QR

- **Decided:** 2026-10-24, lead, on the design's open questions.
- **Status:** The QR and code-in-link choices below supersede the QR decision here.
- **What:**
  - Setup prints each privileged command before it runs it, with no `[y/N]`; `sudo`'s
    own prompt is the consent.
  - It copies the link with OSC 52 when stdout is a terminal.
  - The QR encodes the link alone.
- **Why:**
  - Jimmy asked to run setup and "copy the link". Every run of setup is a deliberate
    act, so a confirmation adds a step and blocks no mistake.
  - OSC 52 costs one escape sequence and reaches the clipboard over SSH.
  - A code in the link needs web and iOS work, and leaves the code in browser history.
- **Rejected:**
  - A `[y/N]` before `sudo`.
  - Shelling out to `pbcopy`, `wl-copy` or `xclip`: over SSH they copy on the server.
  - A code in the QR.

### The app reports no keyboard inset, because its view moves

- **Decided:** 2026-10-26, lead, from a phone screenshot with the keyboard up.
- **What:** `keyboardInset` in the v2 `viewport` object means how far the keyboard covers
  the page the web can see. The browser reports the covered strip; the app reports 0,
  because the native shell moves its web view's bottom edge above the keyboard.
  `keyboard` (the frame taken, at least 120 pt) still says the keyboard is up.
- **Why:** both platforms were describing the keyboard, so the app's dock, sheets and
  toasts rose by the keyboard height inside a view that had already shrunk, leaving a
  keyboard-height gap under them. Measured in a real-daemon browser run at phone size:
  a 593 px view with `--keyboard-inset: 259px` leaves the dock with 259 px of blank
  space under it; with 0 the dock's bottom sits on the view's bottom.
- **Rejected:**
  - Stopping the native resize and letting the web rise by the inset everywhere (the
    design's documented fallback). It keeps one number but gives up the frame animation
    and reopens WebKit scrolling the focused line field.
  - A web-side check of whether the page height already excludes the keyboard. The
    platform knows what it did; the page would have to measure it back.
  - Making the dock's lift depend on `keyboard` instead of the inset: the strip shows on
    the same flag, and the gap is the inset's job in the browser.

### Setup links carry enrolment codes in fragments

- **Decided:** 2026-10-26, Jimmy.
- **What:** Setup prints one link, `<origin>/#code=<CODE>`, and encodes that exact
  link in its QR and terminal clipboard. The browser reads the code from the fragment;
  the daemon does not parse it. `tether enroll` prints the bare MagicDNS name on
  `Host:` and the same code-bearing URL on `Browser:`.
- **Why:** Scanning or opening the link can enrol a browser without transcribing the
  code. Unlike the earlier decision, the web and iOS flows now consume the fragment.
  Fragments do not reach the daemon or appear in `Referer` headers. Browser history
  still retains the URL, including its fragment; that remaining exposure is accepted
  for a one-use code that expires after 10 minutes.
- **Rejected:**
  - A query string, which would reach the daemon and could be forwarded as a referrer.
  - A deep link into the iOS app, which would not cover Safari and would require the
    app to be installed.
  - Keeping the plain link and separate code as the only browser path, which still
    requires entering the code on the phone and leaves the screen with multiple links.

### Setup keeps platform policy behind one boundary

- **Decided:** 2026-10-25, lead (setup review round 2).
- **What:** `systemd.rs` and `launch_agent.rs` each own their setup and teardown host
  state and expose one shared surface through the `platform` alias. Checks return a
  validated tailnet value, and both setup modes share one success-report tail. Install
  planning uses a distinct action type per platform, with the previous bytes carried by
  a differing-file state.
- **Why:** the setup sequence should express the shared workflow, not repeat it behind
  paired `cfg` branches or recover validated facts by matching their raw form again.
- **Rejected:** one cross-platform action enum with impossible variants and
  `unreachable!` executor arms; separate report tails; wrappers used only by tests.

### Setup probes the daemon lock before changing host state

- **Decided:** 2026-10-25, lead (setup review round 3).
- **What:** the non-blocking probe uses the daemon's existing runtime flock. Background
  setup refuses before grants or installation when that lock belongs to a terminal run;
  an active service may be restarted. Teardown reports a terminal run that remains
  active. Foreground setup requires `config::runtime_dir()` to equal
  `/run/user/<uid>/tether`. `daemon::open` owns the budget, runtime directory, flock,
  binds, state store and auth before setup grants the operator. Setup publishes Serve,
  refreshes the daemon's cache, issues the code and prints; `Opened::run` then registers
  signals and serves. Exit 78 is mapped only for `tether serve`, and teardown mentions
  linger only when `loginctl` reports `Linger=yes`.
- **Why:** setup must refuse before a change if another process owns tether's daemon
  slot; one flock keeps setup and serving on the same instance rule. Opening state and
  auth before the grant keeps filesystem refusals on the no-mutation side of the setup
  boundary. Keeping publication in the foreground sequence removes a split assembly
  hook, while registering signals only in `run` preserves default signal exit during
  grants and setup writes. The exact runtime path keeps the published Unix target and
  teardown matcher aligned.
- **Rejected:** a setup-only lock or PID check; granting the operator before daemon
  startup checks complete; a post-bind publication hook; mapping daemon configuration
  failures to exit 78 for setup; unconditional linger advice.

### Setup's report prints only what Jimmy acts on

- **Decided:** 2026-10-25, Jimmy ("really verbose", first Linux run).
- **What:** the success report is the mode line (with "starts at boot" or "starts when
  you log in" for a service), one line per change, any notes, the link, its QR code and
  "Enrolment code: <code> (one device, 10 minutes)", then "For another device, run
  `tether enroll`." A terminal run logs at `warn`
  unless `RUST_LOG` is set, from before the daemon opens so its budget warnings show.
  An unenrolled node logs at `debug` on every route: the response already reports it,
  and every phone is unenrolled until it enters its code.
- **Why:** each dropped line repeated another one or explained something a second run
  doesn't need: "Nothing else to change" (no change lines says it), "Published on your
  tailnet", per-client enrolment steps (the phone page asks for the code; the iOS host
  name is the link's), the `teardown` line (in running.md; `tether enroll` keeps a line under the code, since
  Jimmy had to ask how to get another code), the clipboard
  sentence (setup can't tell whether OSC 52 landed), the daemon's "listening" line
  under a report that already says tether is running, and a warning for the expected
  enrol-after-opening order.
- **Rejected:** a `--quiet` flag (two output formats to keep correct); keeping the
  banner for the foreground Serve entry that outlives Ctrl-C (running.md says so, and
  the phone shows 502, not someone else's page).

### Setup's `401` names Tailscale's full-name check

- **Decided:** 2026-10-25, lead (first Linux setup run on pop-os, review p210).
- **What:** on a `401` from the Serve write, setup explains that tailscaled 1.98.9+
  checks `sudo --other-user=<full name> --list tailscale` with the account's full name
  (tailscale/tailscale#21204), suggests `sudo chfn -f $USER $USER` when the names
  differ, then checking `sudo -l tailscale`. Teardown adds `sudo tailscale serve
  --https=443 off`, stating that it removes every handler on port 443.
- **Why:** pop-os's account had a sudo rule for tailscale and still got the `401`; the
  old message asked for that rule. `chfn -f` changes only the full name; Go's user
  lookup, which tailscaled tries first, cuts the name at the first comma.
- **Rejected:** setup reading the account's full name and choosing one of two messages
  (another lookup, wrong for LDAP accounts, for a rare error); `usermod -c` (replaces
  the whole GECOS field); a narrower teardown command with `--set-path` (unverified);
  naming tailscaled's `PATH` lacking `tailscale`, the other cause reported on #21204
  (seen with Homebrew's launchd tailscaled; a Linux tailscaled finds `/usr/bin`).

### Session listings omit client-attachment state

- **Decided:** 2026-10-25, Jimmy.
- **What:** Remove `attachedElsewhere` / `attached_elsewhere` from session listings and
  stop querying tmux clients just to compute that value. Do not bump the wire protocol:
  protocol 1 never shipped (v0.0.1 has no web, iOS or protocol code), and a v1 web peer
  reads the missing field as false, so it only omits the note.
- **Why:** Jimmy said the note is not useful; acted-last sizing makes a switch between
  his laptop terminal and tether's resize harmless, and removing the value saves one
  field per listed session and the tmux query that computed it.
- **Rejected:** keeping the field for a possible future use (listing and wire cost with
  no current reader); bumping to 2 while keeping minimum 1 (the daemon would claim a
  range it does not shape messages for, the incompatible fixture stopped being
  incompatible, and the Swift app version was left behind); setting minimum 2 (locks
  out dev builds over a note); sending the field to v1 peers (per-version message
  shaping for a misleading `false`).

## Tabs follow a session

### One tab per session, like `tmux attach`

- **Decided:** 2026-10-25, Jimmy, from first real use.
- **What:** a tether tab is a tmux session. It shows the session's current window and
  follows it when any client changes it (the laptop's prefix-n, a script, a window
  exiting, tether's window switcher). Home, the picker and the switcher list sessions
  only. A small window switcher, with the session's windows when it has two or more,
  changes and creates windows. This replaces one tab per window, its window rows and
  accordions (browser-behaviors.md, plan.md, daemon-core.md).
- **Why:** Jimmy, on Home listing "0: python / open / + New window" under every session:
  "default just list the session … by default it should just load the whole thing
  (especially if there is only 1 window)".
- **Rejected:** opening the session's active window as a fixed tab (today's model, one
  tap shorter, but the tab stops matching what the laptop shows after a prefix-n).

### The daemon follows the window; the client never re-watches

- **Decided:** 2026-10-25, design (p222).
- **What:** a watch names a session. The hub keeps one view per watched session, owned
  by the control client attached to it; that client's `%session-window-changed` for its
  own session sets the view's current window, and a Locate on the owner
  (`display-message -t '$S'`) finds the window's pane. The tab gets one `watching` and
  one snapshot per change. `Locate { window }` and `LocateSession` become one
  `Locate { session }`; window phases, `windowClosed` and `windowRenamed` are deleted.
- **Why:** following costs the network the minimum: the snapshot the new window needs
  anyway, with no client round trip. Sessions don't move, so the owner is known without
  asking tmux, which removes the moved-window rebinding the window model needed. The
  probe ([research/probe-session-follow.md](research/probe-session-follow.md)) showed
  the notification on 3.4 and 3.7b for every trigger, ahead of the new window's layout.
- **Rejected:** the daemon telling the client and the client re-watching the new window
  (an extra round trip on every switch, on the connections where it hurts most); a
  session-scoped subscription carrying the acts and cwd in place of the per-window one
  (the laptop riding along on a switch would read as an act and yield tether's claim;
  a session subscription carrying only the current window id is kept, as the backstop
  for `swap-window`); grouped sessions so tether's window choice doesn't move the laptop
  (tether would create sessions in Jimmy's tmux, against "a window onto tmux, never its
  owner").

### A claim names a window and moves only by tether's own act

- **Decided:** 2026-10-25, design (p222).
- **What:** a view's claim is (watch, window), and its window is always the current
  window or the one a `selectWindow` in flight is selecting (`selecting`). tmux
  announces the switch after the group's reply and the owner's replies are ordered with
  its notifications, so `selecting` clears at the group's failure or at the owner's
  first `CurrentWindow` or Locate answer after the reply. `selectWindow` selects and
  then takes `latest` with its vote, in one group; `newWindow` with a watch claims the created window. Any
  change of current window (`CurrentWindow` from the notification or the current-window
  subscription, a Locate answer naming another window) drops the claim unless the new
  window is the claim's own; the old window's vote clears and the new window keeps its
  size until the tab acts. Input aimed at a window that is no longer current claims
  nothing; while `selecting` is set, input aimed at the window being left still goes
  there but leaves the claim on the selected window, and `Acted` yields only the
  claim's own window. A failed select drops the claim, and a select's reply triggers a
  Locate, which ends `selecting` for a select of the window already current (review
  p233).
- **Why:** it is acted-last applied literally. The probe showed a control client's
  `select-window` makes no client `latest`, so without the take the
  selected window would keep the laptop's size; select then take reflows it once,
  where a vote ahead of the select reflowed it twice (probe §16). A laptop prefix-n
  then leaves the laptop's windows at the laptop's size.
- **Review (p226):** an earlier draft only stopped counting a claim whose window was
  no longer current, so a laptop's prefix-n then prefix-p brought the phone's vote back
  onto a window the laptop had just switched to; and reconcile, still seeing the old
  current window, cleared `selectWindow`'s own vote before tmux announced the switch.
  Dropping the claim and holding `selecting` fix both.
- **Rejected:** a session-wide claim that carries the phone's size to whatever window
  becomes current (the laptop's prefix-n would land on a phone-sized window until its
  next key); comparing tmux's `client_activity` with the claim time to guess who
  switched (second resolution, two clocks, and a rule nobody could predict).
- **Accepted cost:** with only the phone attached, typing `exit` shows the next window
  at its old size, with the band, until the next keystroke claims it.
- **Superseded in part** by "Claim targets and shown windows have different
  lifetimes": a claim no longer stores a window, and a different `CurrentWindow`
  during an unresolved selection waits for Locate instead of ending `selecting`. The
  acted-last rule and the take after the select stand.

### Input, paste and inserted paths name the window the tab showed

- **Decided:** 2026-10-25, design (p222).
- **What:** `input` and `paste` carry `window`, the window of the tab's latest
  `watching`, and the daemon sends to `-t @W`. Image paste and Files' insert capture
  the window with the tab.
- **Why:** on a slow link the laptop can switch windows between a keystroke and its
  arrival; the key should land where the user was looking. A path inserted after an
  upload lands in the window it was pasted into, not whatever the session shows by
  then; a gone window fails visibly, as a gone tab did.
- **Rejected:** targeting the session (`-t '$S:'`, tmux attach's own semantics, which
  sends a line typed for one window into another); refusing input whose window is no
  longer current (drops keys typed in the instant after a switch made elsewhere).

### The window switcher: the phone's session sheet, the desktop's active pill

- **Decided:** 2026-10-25, design (p222).
- **What:** on the phone, the session switcher sheet gains a "Windows in <session>"
  block for the active tab's session: its windows when it has two or more, then
  "+ New window". On the desktop, the active tab's pill holds a windows button that
  opens a menu of the same rows and "New window". tmux's own prefix keys don't work
  from tether on any platform, because `send-keys` writes to the pane past tmux's key
  tables, so the menu is the desktop's switcher (review p227). The windows button shows on every
  session, one-window sessions included: it is the desktop's only way to create a window,
  and its window rows still appear only with two or more. Choosing a window runs
  `select-window` on the session, so a laptop attached to it moves with it, as prefix-n
  does. Home loses "+ New window"; the label is the session name, then the current
  window's name even with one window (with tmux's automatic naming it names the running
  program), set apart by spacing, never a dot or separator, the window truncating first.
  Jimmy accepted the laptop moving, the button on one-window sessions and the window name
  in every label on 2026-10-25.
- **Why:** the chip already opens the sheet, so switching windows costs two taps, as
  switching tabs does, with no new chrome on the terminal. A strip that appears with a
  second window would change the terminal's height, and so resize tmux, whenever the
  window count crossed one. Creating a window is something done from inside a session.
- **Rejected:** a window strip above the phone terminal (a row of terminal lost, and a
  tmux resize when it appears); a swipe on the dock to change windows (hidden); window
  rows on Home that open a session at a window (the accordions Jimmy asked to remove);
  matching window names in Home's search (a match that opens a different window than
  the one searched for); "+ New window" per Home session row (a row action on a list
  Jimmy wants plain); grouped sessions per tab so tether can show a window
  without moving the laptop (tether creating sessions in Jimmy's tmux); hiding the
  desktop windows button on one-window sessions (no way left to create a window); the
  window name only when the session has two or more windows.

### Protocol 2, bridge 3, and the old saved workspace is dropped

- **Decided:** 2026-10-25, design (p222).
- **What:** `PROTOCOL_VERSION` and `MIN_PROTOCOL` become 2, and so does Swift's
  `DaemonProtocol.version`, which enrolment and the `/fs` scheme handler check; bridge
  version 3 changes `TabKey` to name a session; a saved workspace of version 1 is
  discarded whole on both platforms, with the drafts keyed by its window tabs, and its
  `expanded` field is gone.
- **Why:** a version-1 peer would send window watches the new daemon can't read: the
  bump rule's "an older peer would act wrongly". The web is bundled with the app and
  served by the daemon, so peers move together; a stale tab gets `incompatible` instead
  of a 4003 loop. Migrating window tabs needs the session of each window, which the
  saved workspace never recorded, and the cost of dropping is reopening a few sessions
  once.
- **Rejected:** a daemon range of 1..=2 with per-version watch handling (both models
  kept alive); resolving old window tabs against the first listing (code that runs once,
  for one user).

### `%session-changed` closes the control client

- **Decided:** 2026-10-25, design (p222).
- **What:** when tmux moves a control client to another session (its own destroyed
  under `detach-on-destroy off`), the hub closes it and checks the session, which
  reports `sessionClosed`. Only a `%session-changed` naming another session counts:
  tmux also sends one naming the client's own session at attach and for every take
  ("tether takes tmux's `latest` with a same-session `switch-client`"), and `Session`
  drops those.
- **Why:** a control client belongs to one session for life; reusing it for the
  session tmux picked would bind views to a session nobody watched.
- **Rejected:** adopting the client for the new session.

## Files: find a folder by path completion

### A path field with completion

- **Decided:** 2026-10-25, Jimmy, from first real use.
- **What:** Files gets a path field: type a path; it predicts the next existing folder;
  accepting takes it; a list below narrows as you type. Mobile first.
- **Why:** Jimmy: "/#/files needs a ui rework … there should be a search for a folder
  … maybe like vscode, prediction match the next folder … it should be mobile first".
- **Rejected:** fuzzy search over all folders (needs a server index); both modes in one
  field.

### The field heads Files, and Go opens

- **Decided:** 2026-10-25, design (p222).
- **What:** one field at the top of Files on every platform, showing the current path
  at rest. Editing starts from the current path plus `/`. A row tap, a `/` after a name
  that isn't a folder, Tab, or → at the end accepts the prediction into the field
  without leaving the current folder; Go (Return) opens the highlighted folder or the
  one typed. Completion lists folders only. Hidden folders appear when the segment
  starts with `.` or the hidden toggle is on.
- **Keyboard:** the ordinary text keyboard, not `inputmode="url"`: the iPhone's URL
  keyboard has `/` on its first layer but no space bar, and folder names can hold
  spaces. With the empty-segment rule, Go right after an accept opens the accepted
  folder (review p226, p227 found Go opening its first subfolder).
- **Why:** at the top the field doubles as the path context Files already had, and the
  best match sits right under it, above the keyboard. A phone keyboard has no Tab, so
  the thumb's accept is the row tap, and `/` (which the user types anyway) accepts a
  prefix ("rep/" becomes "repos/"). Keeping accept and open apart lets the user go
  several folders deep without a listing of files at every step.
- **Rejected:** the field at the bottom in thumb reach, like the session switcher's
  search (the location display would sit at the bottom, and matches would read upward);
  a row tap that opens the folder (every step would leave the field); a ghost-text tap
  target (too small beside the caret); files in completion (Jimmy asked for folders;
  the folder view lists files once opened).

### One listing per folder, never one per keystroke

- **Decided:** 2026-10-25, design (p222).
- **What:** completion filters listings the client holds. Entering a folder fetches its
  listing once, after typing pauses 250 ms, only for the folder the field settles on;
  listings are cached per host for the Files session (32 folders, shared with
  browsing). Folders-only first pages page on to 1,000 folders. Above the roots and
  outside `$HOME`, completion uses the root paths already loaded and asks for nothing.
  No daemon change: `/fs/list` sorts directories first and `/fs/dirs` lists only them.
- **Why:** each request costs a round trip on a spotty link; a folder is entered far
  less often than a key is typed.
- **Rejected:** a `prefix` query on `/fs/list` (a request per keystroke pause, and a
  daemon change for folders with more than 1,000 subfolders); prefetching the
  predicted folder (bytes spent on guesses).

### Add folder becomes the path field

- **Decided:** 2026-10-25, design (p222); confirmed by Jimmy the same day.
- **What:** the path field completes under `$HOME` outside the roots from `/fs/dirs`,
  marking those rows "not added"; opening such a folder lists its subfolders under
  "Not one of your folders" with "Add this folder", keeping the dialog's refusals
  ($HOME itself, already added, outside `$HOME`, read-only `config.toml`). "Add folder…"
  starts the field at `~/`. The Add folder dialog and its one-folder-at-a-time browser
  are deleted. This changes "Add folder in Files" (2026-10-23).
- **Why:** the dialog was a second folder browser with its own field-less navigation;
  the path field now does what it did, faster. "Add folder in Files" rejected a path
  field because there was no way to see what exists; completion is that way.
- **Rejected:** keeping the dialog beside the field (two ways to browse `$HOME`).

### `swap-window` is caught by a current-window subscription

- **Decided:** 2026-10-25, design (p222), from reviews p226 and p228.
- **What:** each owner with a view subscribes to its session's current window id
  (`refresh-client -B 'c::#{window_id}'`); a value naming another window becomes
  `CurrentWindow`, as the notification does.
- **Why:** `swap-window` without `-d` changes a session's current window without
  `%session-window-changed` (it never calls `session_set_current`; tmux's window menu
  offers Swap Left and Swap Right). The session subscription sends one line per change,
  costs one evaluation per owner per second and bounds a swap's lag at about a second.
  It carries no client entries, so it doesn't reopen the rejected session-scoped
  subscription for acts: that one was rejected because its value changes whenever any
  client types anywhere and can't say which window a client is on ("The other client's
  act is seen through the window subscription"); this value is a window id, which
  changes only when the current window does, and carries no clients. Probed on 3.4 and
  3.7b (p231, p232): a line 0.2–0.7 s after each swap that changes the current window,
  `-d` included, and none for typing, idling, a cwd change, a swap of two other windows
  or a window linked twice.
- **Rejected:** `#{window_active}` in each `w<W>` value (an earlier fix: a window
  linked twice into one session sends a 0 line from its other place on every value
  change, about once a second while anyone types, which would re-locate and drop the
  claim each time); polling the session's current window; ignoring swaps (the tab
  would show and vote a window the session no longer shows).

### Scrollback names its pane

- **Decided:** 2026-10-25, design (p222), from review p226.
- **What:** `historyChunk` carries `pane`; the client drops a chunk for any pane but its
  latest `watching.pane` and restarts its history cache when the pane changes.
- **Why:** a window change made elsewhere swaps the pane under a tab mid-scroll; without
  the pane, one window's rows could sit above another's.
- **Rejected:** a `pane` in the request that the hub refuses when stale (a refusal to
  handle for a race the client can settle alone).

### tether takes tmux's `latest` with a same-session `switch-client`

- **Decided:** 2026-10-25, Jimmy (typing, pasting or Fit in tether takes the window to
  tether's size even when the laptop is smaller; laptop typing takes it back), design
  (p229). Probes: [probe-latest-client.md](research/probe-latest-client.md) (p225, 3.4,
  3.7b, 3.8) and [probe-session-follow.md](research/probe-session-follow.md) §9–14
  (p231, 3.4 and 3.7b).
- **What:** when a take is due, the owner **takes** `latest` before its vote: when it
  starts voting a window (a new claim, a claim after a yield, a claim on a window just
  made current, the first vote on a respawned client), when the window's size has moved
  off a standing vote since tmux last showed it at the vote (a laptop act the
  subscription didn't report, review p233), and on every Fit. A take that leaves the
  window off the vote isn't repeated until the vote is cast again or Fit. The take is `switch-client -c '<client>' -t '$S' ;
  refresh-client -C '@W:CxR'`, its own name (from the startup line) and its own
  session, then the vote. `selectWindow`'s group is the select, then the take. A claiming
  `input` or `paste` writes its take-and-vote group just before its own group. The yield
  is unchanged: another client's act clears the vote, and tmux has already made that
  client `latest` (daemon-core §3.6).
- **Why:** under `window-size latest` a vote only caps, so the phone could never be
  larger than the laptop's terminal: p216 reproduced a 274×53 browser held at the
  laptop's 80×23 after typing. `server_client_set_session` sets `latest` for the
  session's current window on every `switch-client`, the session it is already on
  included; on 3.4 it does so after its own recalculation, so the vote after the
  switch recalculates. The take injects no key, leaves `window-size` alone and dies
  with the control client, so tmux's state never depends on tether's: after a crash,
  the laptop's next key sizes the window as before. Since tabs follow sessions, a claim
  is always on the session's current window, the one window a switch can take.
- **Rejected:**
  - `resize-window`: it sets the window's `window-size` to `manual`, which tether would
    have to restore on every yield, and a crash would leave behind.
  - `send-keys -K` for input: keys go through tmux's key tables, so `C-b` starts the
    prefix and the next key runs a binding; on 3.4 ASCII and Enter didn't reach the pane.
  - Keeping the cap (Jimmy's requirement unmet; the band never showed).
  - A take with every keystroke: each take runs the `client-session-changed` hook and
    sends a line to every other control client; the window's size says when tmux has
    stopped sizing by the vote.
  - A take only when no vote stands (the first draft, review p233): a laptop key in the
    same second as its last reported act makes it `latest` unreported, and typing on
    the phone would then never take the window back.
  - The switch alone, without the vote after it: 3.4 doesn't recalculate.
  - The take inside the input's own group: tmux skips a group's remaining commands
    after an error, so a failed take would drop keys.
  - Handing the window back to the laptop's size when a claim ends without a yield:
    tmux has no way to make another client `latest`; the window takes the owner's
    client size until the laptop's next key.
- **Cost:** a take is a real `switch-client`: the owner gets `%session-changed` for its
  own session and other control clients `%client-session-changed` (both dropped by
  `Session`); a `client-session-changed` hook runs once per take; the session's activity
  and last-attached times advance; the control client's key table resets (unused). A
  window the owner took and no longer votes takes the owner's client size until a
  terminal acts there. Under `window-size smallest`, `largest` or `manual` the take does
  nothing.

### The band shows whenever the window isn't at this screen's size

- **Decided:** 2026-10-25, Jimmy ("Sized for another terminal" + Fit whenever tmux's
  size differs from tether's, nothing when tether holds it), design (p229).
- **What:** `ShownWindow` carries the window's `size`, from Locate and from each
  `%layout-change`'s root, and `watching` is re-sent when it changes. The band shows
  after the window's size has differed from the size the tab sent, in either
  direction, for longer than the wait: one second or the last ping round trip plus
  half a second, whichever is longer, restarted at each claiming send; Fit re-sends the size and takes `latest`. A smaller window still
  sits in the top-left corner.
- **Why:** with the take, a window this screen holds is exactly its size, so a
  difference means another terminal holds it, whichever is larger. The p216 probe's
  window was smaller than the browser, the case the old rule (band only when larger)
  never covered.
- **Rejected:** a `held` flag from the daemon (a second fact that can disagree with the
  size on screen, which is what the band is about); comparing the pane's size (a split
  pane is always smaller than its window); showing the band at once (it would flash on
  every claim while the resize is on its way); a fixed one-second wait (review p233: a
  round trip on a spotty link often takes longer, so every open and rotation would
  flash it).

### Late completion answers are kept; Back ends a path edit

- **Decided:** 2026-10-25, design (p230 build, review p234).
- **What:** an answer for a folder the path field has left is never shown but is kept
  in the cache, not dropped. Editing the path is a `files/find` router overlay, so Back
  ends the edit before it leaves the folder. The first page a completion fetch gets is
  handed to browsing (opening the folder costs one listing), and a failed listing is
  asked for again.
- **Why:** completion reads only the listing of the folder the field names now, so a
  late answer cannot appear in the wrong place; the bytes are already paid for, and
  backspacing into that folder then costs nothing. Cancelling the pending 250 ms timer
  is what saves requests.
- **Rejected:** discarding late answers (a request wasted for nothing); a second,
  browsing-only cache of the same listing (two copies to keep in step).


### Claim targets and shown windows have different lifetimes

- **Decided:** 2026-10-25, implementation review and runtime verification (p237,
  p242, p243, p246; lead fixes).
- **What:** a session view keeps the last coherent shown window/pane until its
  owner's Locate answers. Its claim target is the pending selection, otherwise
  the latest reported window once the view has bound, otherwise the shown window.
  Before first binding, a claim waits for Locate. Claims hold a watch and take
  intent, not another mutable copy of the window ID. The owner's tmux subscription
  state owns each window's cwd; `watching` reads the shown window's path from it.
- **Why:** independently assigning claim windows in watch, resize and notification
  handlers left claims on windows the tab had already left. Updating only the
  shown window ID exposed new IDs with old names, panes and working directories.
  Two notifications before the first Locate also dropped the initial claim.
- **Rejected:** patching each handler separately (the same invariant still had
  multiple owners); making a view unbound during every switch (rejects input for
  the Locate round trip and discards a still-useful stream); retaining a per-view
  cwd (belongs to a window, not to the session).
- **Supersedes in part** "A claim names a window and moves only by tether's own act":
  its stored claim window, and `selecting` ending at the first `CurrentWindow`
  whatever window it names. Its acted-last rule and the take after the select stand.

### Report the first current-window subscription value

- **Decided:** 2026-10-25, implementation review p246 and lead verification.
- **What:** the first `c::#{window_id}` value emits `CurrentWindow`, just like later
  changed values. The hub ignores an observation matching its shown window when
  no transition is pending.
- **Why:** silently accepting the first value could miss a `swap-window` between
  the initial Locate and that value. Reporting it costs no extra request when it
  merely confirms the shown window.
- **Rejected:** a silent initial baseline (loses a real change); polling to repair
  it (the subscription already reports the needed fact).

### New session-follow checks are temporary verification

- **Decided:** 2026-10-25, Jimmy: “Temporary verification only”.
- **What:** exercise new claim races, session/bridge contracts and window-switch
  behavior with disposable checks; retain the evidence, not new regression cases.
  Existing tests are migrated to the changed behavior.
- **Rejected:** retaining a new focused regression suite without Jimmy's approval.

### The keyboard pan keeps the terminal bottom visible unless that would hide the cursor

- **Decided:** 2026-10-26, tech lead; Jimmy agreed either implementation works.
- **What:** tmux keeps the keyboard-down size. When the visible terminal area is shorter
  than its rows, `terminalBottomPan` moves the terminal so its last row meets the area's
  bottom. If that offset would put the cursor above the area's top, it instead puts the
  cursor row at the bottom, as before. It never pans past the last row, does nothing while
  all rows fit, and does not pan while scrolled into history. The dock refreshes its area
  when `Viewport.visibleHeight` changes, including the native app's keyboard resize where
  `keyboardInset` remains 0. The tether chrome is measured from the surface in a short
  window after layout, density, directInput, width, stable height or the safe area change,
  and at the start, as client-architecture.md §5.4 says; a keyboard changes none of those,
  so a shrinking web view never becomes chrome.
- **Why:** full-screen harnesses often park the cursor above their input/status/footer
  rows; cursor-only anchoring hides those rows. The cursor guard keeps an editor cursor
  near the top visible. Recomputing from `visibleHeight` makes the app use the geometry
  native actually changed instead of waiting on `keyboardInset` or a strip size change;
  measuring the short surface as chrome on every resize could also resize tmux during its
  frame animation before the final viewport message arrived. Guards that compared
  `visibleHeight` with `stableHeight` or checked the focus owner were rejected: they patched
  a per-resize derivation, and the first misfired at fractional zoom, where the visual
  viewport is a fraction below the rounded stable height.
- **Rejected:** resizing tmux to the visible rows while the keyboard is up (each keyboard
  toggle redraws every TUI over a spotty link and resizes the laptop's view); cursor-only
  anchoring (hides harness status lines); bottom-only anchoring with no cursor guard (can
  push a cursor near the top off-screen).
- **Supersedes:** the cursor-only pan anchor in "The keyboard pan belongs to the renderer
  and follows the cursor" and "The suggestion strip pans the terminal like the keyboard
  and never resizes tmux" above.

### The terminal long-press selects at once; arrows are keys; a tap near the cursor opens the keyboard

- **Decided:** 2026-10-26, Jimmy, with the tech lead's call on the one open choice.
  Round 3: "selection - yes" (drop the pad, long-press-drag selects, ← → in the key row);
  and on keyboard-up typing, "if i clicked somewhere where I wanted to enter text, the
  keyboard should open on its own". Round 4 (correction): "holding finger down and dragging
  turns into the arrow pad IF YOU MOVE, but if you don't move i think it should select the
  text, and then u can drag it with the things to the side (like termius)". Round 5:
  "unless you think it would be better ur way to just remove the drag thing", settled by
  removing it.
- **What:**
  - **No arrow pad.** The long-press highlights the word under the finger the moment it
    fires (haptic as before). Dragging while still held moves the selection's far end to
    the cell under the finger, across rows, inside the snapshot; release shows the handles
    and the edit menu (Copy / Paste; Paste alone over a blank cell). No mouse event, in
    mouse-mode apps too. The pad's states, dead zone, range and repeat speeds, and the
    ring that drew nothing useful, are deleted.
  - **← and → join the key row**: esc, ←, ↑, ↓, →, ^R, ^C, tab, ctrl, alt, `|`, `~`, `/`,
    `-`. They repeat while held as ↑ and ↓ do. The four sit together in a keyboard
    cluster's order rather than ←→ apart from ↑↓, which a thumb on one row reads as one
    control.
  - **A tap on the cursor's row, or the row directly above or below it, raises the
    keyboard for the terminal** (the toggle's action) when it is down. The cursor is
    tmux's (xterm `cursorY`); scrolled back into history it is off screen and nothing
    opens. In app mouse mode the tap is still sent as a click and also opens the keyboard.
    A tap never lowers the keyboard; taps elsewhere keep their meaning. The tap that
    raises the keyboard does not also move the prompt's cursor: that happens only when the
    terminal's input held the keyboard before the tap.
  - **`focus select` goes to native when the finger lifts.** The highlight and the drag
    are the web's while the finger is down, over a snapshot layer that takes no pointer
    events, so WebKit's own long-press cannot take the touch and send `pointercancel`.
- **Why:** the pad drew nothing, so a press meant to select looked like a dead control
  once the finger moved past 16 px; hold-to-select with a visible highlight is what iOS and
  Termius do, and arrows as keys cost nothing in the terminal's gesture space. Typing
  where the cursor is should not need a trip to the toggle.
- **Rejected:** keeping the pad and adding visuals (a second mode under one gesture, and
  the jitter between select and pad stays); a line-field-aware opening when the line field
  holds the keyboard (a tap near the cursor changes nothing then, as the keyboard is up).
- **Supersedes:** "The key row's keys, and arrows by long-press" (the arrow pad, and "←
  and → go"); "Two keyboard openers, one closer, with Termius's focus cues" ("terminal taps
  open and close nothing"); and "Touch scroll is JS momentum over xterm and a DOM history
  view" ("a long-press hold with a drag is the arrow pad").

## Client redesign

### Home is server-first, with Settings behind a gear

- **Decided:** 2026-10-27, Jimmy.
- **What:** Home has a card per server with status, its open terminal and Files tabs,
  All sessions and Files; Add server and enrolment are on Home. One server uses the
  same card and does not cause an automatic jump. Offline, no servers, no sessions and
  tmux not running are distinct states. Home has no phone tab strip. A gear opens a
  separate Settings screen for appearance, terminal text size, device/browser data and,
  in the app, Face ID. The phone browser offers Add to Home Screen.
- **Why:** Jimmy wanted a place to find and manage servers, rather than a screen that
  looked like Settings without showing his servers or sessions. Listing open tabs in
  each card makes a second tab strip on Home redundant.
- **Rejected:** a settings-style Home without server cards; Home as a full-height detent
  of the session sheet; putting Settings directly on Home; an automatic jump for one
  server; retaining a Home tab strip alongside the open-tab rows.
- **Supersedes in part:** “Home, picker and Settings details” and the Sessions/Files
  Home navigation in “Browser/mobile client direction and portable design record”.

### Sessions and tabs share the phone sheet; desktop uses a popover

- **Decided:** 2026-10-27, Jimmy.
- **What:** a current-tab button opens a half-height sheet over the current phone tab;
  Home opens a full-height sheet with Back. Its session list has search, server groups
  and open markers. In the half-height sheet a horizontally scrolling strip at the bottom
  has the open terminal and Files tabs, × on the active tab, and + for New session /
  Browse files; the full-height sheet has no strip (Home lists the open tabs) and puts +
  beside search. Swiping
  scrolls the strip; tapping a tab switches the view behind without closing the sheet.
  Desktop has Home, tabs and + across the top; + opens a session popover with the same
  creation choices, not an attach-only modal.
- **Why:** Jimmy can see a switch happen in the background and reach tabs and creation
  in the thumb zone. The current-tab button leaves the terminal with less chrome.
- **Rejected:** the tall sheet with tabs at the top and × on each; closing the sheet on
  every tab switch; a phone terminal tab strip with its own +; an attach-only desktop
  picker and a separate Files rail.
- **Supersedes in part:** “The tab chip opens one session switcher”, including its
  attach-only desktop picker and switch-and-dismiss behavior. The brief's earlier
  terminal tab-strip proposal was reversed in round 6 before it became a spec.

### Terminal tabs continue to follow the current session window

- **Decided:** 2026-10-27, Jimmy.
- **What:** a terminal tab remains a tmux session, opening on its current window and
  following it. Only sessions with multiple windows offer a window-switching control;
  on the phone it is within the sessions sheet. The exact control and the route for
  creating a window in a one-window session remain open.
- **Why:** Jimmy uses windows infrequently and agreed that the current window makes more
  sense than selecting the first; the tab continues to match the session as other
  clients change it.
- **Rejected:** making each tab a fixed tmux window; selecting the first window on open;
  a window switcher visible for every one-window session.
- **Supersedes in part:** “The window switcher: the phone's session sheet, the desktop's
  active pill”, specifically its always-available one-window control. It confirms “One
  tab per session, like `tmux attach`”, rather than reversing that decision.

### Multiple Files tabs keep independent places

- **Decided:** 2026-10-27, Jimmy.
- **What:** any number of Files tabs may coexist, including several on a server. Each
  keeps its own folder or open file locally and uses that name as its label. Home Files
  and Browse files open a new tab at the selected server's folder list (its roots); existing tabs
  are reached in Home or the tab strip. A new tab starts at the folder list rather than
  `$HOME`, because outside a root the file API lists subfolders only.
- **Why:** Files is a peer of the terminal, and Jimmy can keep more than one place open
  without losing a folder or preview when switching.
- **Rejected:** one Files destination shared by every tab; the earlier proposal of one
  Files tab per server; opening at the active terminal's cwd by default.
- **Supersedes in part:** “Files details”, where the router kept a single Files place.

### A parent row and path field navigate Files

- **Decided:** 2026-10-27, Jimmy.
- **What:** Files retains its path field and uses a “‹ parent” row at the top of the
  list, absent at a root; swipe Back also navigates back.
- **Why:** moving up stays in the list and does not need another row of chrome.
- **Rejected:** a separate up button in the path bar; folder accordions.

### Keep Mermaid in the Markdown viewer

- **Decided:** 2026-10-27, Jimmy (“mermaid is important”).
- **What:** render Mermaid in Markdown in this redesign rather than waiting for v2.
  Load it lazily, use strict mode, and sanitize the rendered content with DOMPurify.
- **Why:** diagrams are part of the documents Jimmy needs to read; untrusted rendered
  content must remain sanitized.
- **Rejected:** deferring diagrams with the rest of repo-viewer parity; rendering
  Mermaid without the existing strict and sanitization boundaries.

### Choose System, Light or Dark; use a black dark terminal

- **Decided:** 2026-10-27, Jimmy, approving the redesign direction.
- **What:** Settings offers System / Light / Dark on the app and browsers. System
  follows the device; explicit choices override it. The approved dark direction uses a
  true-black terminal and neutral greys. The native app and web use the same effective
  scheme.
- **Why:** Jimmy wanted a selectable light and classic dark appearance rather than
  being limited to the phone's current system choice.
- **Rejected:** system-only appearance and the existing blue-tinted dark terminal.
  True black was the brief's assumption, not a separately recorded comparison with
  near-black.
- **Extends:** “Browser theme tokens set the minimum browser floor”; the choice now
  participates in selecting the effective scheme.

### Phone dock: current tab at rest, compose above keys when typing

- **Decided:** 2026-10-27, Jimmy.
- **What:** with the keyboard down the bar has the current-tab button, tab count and
  keyboard control, without a tab strip or +. With it up, no session pill shows; an
  always-visible compose box sits above a text-only key row with Hide keyboard. The row
  meets the keyboard, except for Safari's system form bar, and the resting bar meets the
  bottom inset. Files and previews use the same current-tab bar.
- **Why:** Jimmy wanted the session sheet behind a button, the keys nearest the thumbs,
  an available compose box and no empty band. He accepted Safari's system form bar.
- **Rejected:** a tab strip on the terminal; a session pill while typing; hiding or
  shrinking away the idle compose box; placing the key row above the box; reserving a
  blank band beside the keyboard or home indicator.
- **Supersedes:** the layout in “The phone dock: one row at rest, the key row with the
  keyboard”. The earlier redesign tab-strip proposal was reversed in round 6.

### The compose box and terminal make focus visible and switchable

- **Decided:** 2026-10-27, Jimmy.
- **What:** the idle compose box has no caret while the terminal cursor is solid. When
  composing, the box has a ring, caret and Send, the terminal cursor is hollow, and
  Send keeps box focus. A terminal tap or esc returns
  typing to tmux without lowering the keyboard. While composing, ← and → move the
  box caret; ↑, ↓, ^R, ^C, tab and other terminal keys still go to tmux, with their
  destination visible in the key row.
- **Why:** a blinking box caret alongside the terminal cursor obscured where typing
  went, and escaping the box previously required lowering the keyboard.
- **Rejected:** two active typing cursors; forcing a keyboard close to return to tmux;
  a separate "type in the terminal" button in the compose row (Jimmy: "i dont think we
  need it": esc and a terminal tap already do it);
  sending esc and horizontal arrows to tmux while the box is focused; sending all the
  key-row controls to the box.
- **Supersedes in part:** “What the toggle raises, and where key-row keys go” and the
  rejected line-aware tap in “The terminal long-press selects at once; arrows are keys;
  a tap near the cursor opens the keyboard”.

### Bell attention is a UI intent pending a real-tmux probe

- **Decided:** 2026-10-27, Jimmy (“if we can find it”).
- **What:** show an attention dot on session rows and tabs for a terminal bell, and
  surface attention on the current-tab button. The mechanism, coverage and clearing
  remain pending the tmux 3.4 and 3.7b probe. Show a connection indicator on the
  terminal only when not live; it is separate from the bell dot.
- **Why:** an agent may need attention without the user watching its tab, and a weak
  connection needs a visible reconnecting state.
- **Rejected:** promising bell coverage from `window_bell_flag` before probing whether
  it exposes a bell in an unwatched one-window session; relying on connection color as
  the attention signal.
- **Supersedes in part:** the ban on dot status markers in “Browser/mobile client
  direction and portable design record”, and the always-colored terminal host indicator
  in “Terminal and desktop input details”. It does not add an agent dashboard.

### Face ID relock is selectable, not disabled

- **Decided:** 2026-10-27, Jimmy.
- **What:** keep the Keychain and Face ID lock, with a Settings choice of 5 min, 1 hour
  (default), or At launch. At launch means one unlock per process launch, not removal of
  Face ID protection from the Keychain item.
- **Why:** frequent prompts were annoying, while keeping Face ID preserves the token's
  biometric boundary at launch and at the chosen relock points.
- **Rejected:** disabling Face ID and re-saving tokens without biometry; fixed five-minute
  relock; calling the launch-only choice “Never”.
- **Supersedes in part:** the fixed five-minute threshold in “Restore the existing iOS
  auth and background policy”. The one-item and lock behavior otherwise remain.

### Compact phone headers

- **Decided:** 2026-10-27, Jimmy.
- **What:** use one 44 pt phone header row, with a back icon where the screen has a
  parent and a 17 pt title; no large titles.
- **Why:** Jimmy wanted Settings higher and more vertical space for the content.
- **Rejected:** large titles and a separate back/header row.
