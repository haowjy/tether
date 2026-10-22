# tmux control-mode clients: pane restoration and live output

## Executive summary

A server-side terminal emulator is **not a protocol requirement**. tmux already owns a pane's authoritative grid, mode state, dimensions, and pending input parser. A daemon can seed xterm.js from `capture-pane`, keep the client as the only emulator, and stream raw `%output` thereafter. However, that is only safe if the daemon treats the capture/live transition as a protocol boundary and restores the mode state that `capture-pane` cannot represent. A naïve “capture, then append future `%output`” implementation will lose or duplicate bytes and will produce the wrong cursor, alternate-screen, mouse, keypad, wrap, and scroll-region behavior.

For tether, I recommend:

1. Keep tmux as the authoritative screen model for the first implementation; do not require `vt100` or `alacritty_terminal` per pane merely to bridge output.
2. Make the initial snapshot a serialized transaction: request a private marker after the capture/state commands, consume every queued `%output` before that marker exactly once, then send the snapshot and only post-marker bytes to xterm.js. Use a small adapter modeled on libtmux-rs's tested snapshot boundary.
3. Capture both primary and alternate grids, and send a compact mode/cursor record from `list-panes -F`; apply it to the browser terminal before/around the captured content. Capture `-P` pending parser bytes only if the client-side path needs to preserve a partial escape sequence.
4. Keep an optional `vt100` model as a recovery/validation path only if the product needs server-side semantic state (server-side search/current command/OSC sidecars), deterministic replay, or a client that cannot be trusted to preserve state. `alacritty_terminal` is a substantially heavier choice.
5. Treat pause/resume and resize as snapshot-triggering state transitions, not as transparent flow-control details. Pausing discards queued output; a continuation must be reconciled with a fresh snapshot.

This recommendation is based on tmux's control implementation and existing clients, not just the man page. iTerm2 restores tmux's state with capture commands plus format variables and relies on the client terminal for rendering; tmuxy is a useful web precedent for adding a server emulator, but its emulator is a product choice rather than a control-mode requirement.

## 1. The plan sections that matter

The reviewed plan (`plan-snapshot.md`, §4 and §6.3) proposes one tmux `-CC` control client, lazy per-viewed-pane `vt100`/`alacritty_terminal` models, `capture-pane -e -p` snapshots, `%output` input, bounded buffers, `pause-after`, `refresh-client -C`, and OSC 133/current-command extraction. The useful split is: tmux is the source of truth, while the daemon may maintain a derived model for client delivery.

The risky implicit assumption is that `capture-pane -e` plus subsequent `%output` is a complete and lossless terminal state transfer. It is not. `-e` serializes the grid's visible attributes, not the terminal parser's state or all tmux pane modes. The handoff also has a real ordering problem that cannot be solved by waiting for `%end` alone.

## 2. Ordering, capture/live handoff, and duplicate avoidance

### tmux's ordering guarantee

The tmux control server deliberately serializes pane output and command replies. In current tmux source, `control.c` has this invariant (comments around lines 32–45):

```c
/* Block of data to output. %output blocks are added to both queues...
 * This means a %output block holds up any subsequent non-%output blocks until
 * it is written which enforces ordering even if the client cannot accept...
 */
```

`control.c` queues `%output` and non-output blocks together, so bytes already queued before a command reply are delivered before that reply. Notifications are also deferred while a command block is open (`control.c`, roughly lines 550–590), and are flushed after `%end`/`%error`. `control.c` formats output at roughly lines 814–842 and emits a command reply in the usual `%begin`/payload/`%end` form.

This means a capture reply does **not** mean “all pane output before this point has already been delivered to the caller” unless the client has also observed a deliberately requested boundary. Output generated before the capture command can precede the reply. Output generated during the command can be queued after the reply. There is no useful tmux guarantee that `%end` alone separates “bytes represented by this capture” from “bytes to apply after this capture.”

The control protocol's normal guard is still essential: a command payload can contain lines beginning with `%`, so parse `%begin`, `%end`, and `%error` only with the matching command guard, not by treating every line beginning with `%` as a notification.

### A workable handoff

A robust sequence is:

1. Stop or classify the pane's live output for this client while a snapshot is being assembled; do not drop it.
2. Issue the capture/state commands and then a private no-op/marker command. The marker must be emitted only after tmux has emitted the preceding command reply and any output queued ahead of it.
3. Consume all `%output` before the marker into a temporary pre-snapshot buffer. Do not deliver it to the browser yet.
4. At the marker, install the captured primary/alternate grid and mode/cursor record. Discard only bytes proved to be represented by the capture; do not blindly discard all bytes read “around” the command.
5. Deliver the buffered post-boundary bytes once, in wire order, then resume normal streaming.

The Rust `libtmux-rs` implementation is the clearest reusable precedent. `crates/libtmux/src/control/actor.rs` (around lines 717–725) documents that tmux queues pane output and command replies in one order and emits a private marker after `%end`. `crates/libtmux/src/control.rs` (roughly lines 1480–1538) has a `PaneOutput::snapshot` path that consumes output through a callback until the boundary. Its tests (`crates/libtmux/src/control/tests.rs`, roughly lines 405–456) show `before` output consumed once while `after` output is delivered once. Tether should copy that *boundary model*, not merely issue `capture-pane` and hope the ordering works.

### iTerm2's practical approach

iTerm2 does not treat the initial command list as a general-purpose live boundary. `TmuxWindowOpener.m` sends the initial capture/state commands and only later enables normal notification acceptance in `TmuxGateway.m`; dropped output is considered recoverable by another capture. That is acceptable for a GUI with a recovery path, but tether needs an explicit per-pane snapshot boundary because a phone connection can reconnect while output is active.

## 3. What iTerm2 restores from tmux

The main files are:

- `iTerm2/sources/tmux/TmuxWindowOpener.m`
- `iTerm2/sources/tmux/TmuxGateway.m`
- `iTerm2/sources/tmux/TmuxController.m`
- `iTerm2/sources/tmux/TmuxStateParser.m`
- `iTerm2/sources/tmux/TmuxDroppedOutputScanner.swift`
- `iTerm2/sources/PTYSession/PTYSession.m`

`TmuxWindowOpener.m`, roughly lines 220–234 and 265–315, issues commands of this shape (with target/history values substituted):

```text
capture-pane -peqJ[N] -t "%wp" -S -<maxHistory>
capture-pane -peqJ[N] -a -t "%wp" -S -<maxHistory>
list-panes -t "%wp" -F "<TmuxStateParser format>"
capture-pane -p -P -C -t "%wp"
refresh-client -A '%wp:continue'
show-options -v -q -p -t %wp @uservars
```

The two `capture-pane` calls obtain primary and alternate history. The `list-panes -F` line supplies state that a grid dump does not contain. `capture-pane -P -C` obtains bytes still pending in tmux's input parser, not a normal screen snapshot. `@uservars` is used for integration metadata. The continue command is conditional on whether this pane had been paused.

`TmuxStateParser.m` formats and parses these fields:

```text
pane_id
alternate_on alternate_saved_x alternate_saved_y
cursor_x cursor_y
scroll_region_upper scroll_region_lower
pane_tabs
cursor_flag insert_flag
keypad_cursor_flag keypad_flag
wrap_flag
mouse_standard_flag mouse_button_flag mouse_any_flag
mouse_utf8_flag mouse_sgr_flag
bracket_paste_flag
pane_key_mode
```

The exact list varies with tmux version. The comments note that `pane_key_mode` is available in newer tmux (3.5+ in the iTerm source) and that bracket-paste reporting was not available in released tmux at the time of that code. This is a good version-gated field list for tether, not a promise that every field exists everywhere.

`PTYSession.m`, around lines 11189–11200, shows the recovery policy: if the live session exists, decoded bytes are applied; if it does not, screen-affecting bytes are discarded because a capture will recover the screen. `TmuxDroppedOutputScanner.swift` preserves selected OSC 1337 integration state (`SetUserVar`, `RemoteHost`, `CurrentDir`, `ShellIntegrationVersion`) and replays it after recovery. This is a warning that a screen snapshot alone is not enough if tether wants shell metadata.

### iTerm2's `%output` decoder

`TmuxGateway.m`, approximately lines 188–269, decodes tmux's output escaping: a backslash followed by three octal digits represents one byte; ordinary bytes pass through. High bytes are not UTF-8-decoded by the protocol and must be preserved as bytes. The implementation has compatibility handling for carriage returns; tether should follow tmux's actual escaping rule rather than copy any one client's historical workaround.

The current tmux encoder (`control.c`, around lines 814–842) octal-escapes C0 bytes and backslash, while passing bytes at or above 0x80 through. The decoder therefore must be byte-oriented, not a Unicode string replacement. Invalid UTF-8 is legal pane output.

`TmuxWindowOpener.m`, around lines 403–431, also handles pending parser output from `capture-pane -P -C`. Its comments mention a tmux bug/quirk in which controls are escaped but backslashes are not in that path. Do not conflate this pending-output format with ordinary `%output`.

## 4. Capture-pane's exact limits

The tmux 3.4 man page (`tmux.1`, `capture-pane` section, around lines 2895–2975) says, in substance:

- `-e` includes escape sequences for text and background attributes.
- `-P` captures only incomplete/pending output from the pane's input parser.
- `-C` octal-escapes control characters.
- `-a` selects the alternate screen.
- `-M` captures the mode/overlay screen when applicable.

The implementation in `cmd-capture-pane.c` confirms the distinction: around lines 336–348, `-e` sets `GRID_STRING_WITH_SEQUENCES`; around lines 183–215, `-P` reads `input_pending(wp->ictx)`; around lines 435–460, the captured string is placed in the control reply.

`capture-pane -e` is a reconstruction of tmux's grid. It can preserve text attributes and some hyperlinks/SGR-like sequences, but it does **not** preserve:

- the cursor's visible position and visibility as terminal state (the cursor coordinates must come from `list-panes -F`);
- whether the alternate screen is active and its saved cursor coordinates (also state variables);
- insert mode, keypad/cursor-key modes, wrap mode, mouse modes, bracketed paste, focus reporting, origin mode, or scroll-region bounds;
- the terminal character-set designation/shift state and the parser's current state;
- an escape sequence that is partially received, unless separately captured with `-P`;
- the original byte stream and side effects of OSC 133, OSC 7, OSC 52, OSC 8, title-setting, or application-specific OSCs;
- copy/choose/mode overlays unless the appropriate mode-screen path is explicitly captured;
- a browser emulator's exact character-width interpretation for combining marks, variation selectors, ZWJ sequences, and wide characters.

The last point matters for xterm.js: tmux's grid width and a browser terminal's width calculation can diverge on Unicode edge cases. A server emulator does not automatically solve that mismatch, but it can provide a canonical cell model if tether chooses to own one.

The `-e` output should therefore be treated as an initial rendering payload, not as a serialized terminal emulator. The daemon must send a separate state record or inject equivalent control sequences. Prefer explicit structured state over guessing from `-e`.

## 5. Raw output and OSC 133/7/52

In tmux, `%output` represents raw bytes arriving for a pane, after only control-mode framing/escaping. The pane input parser also sees those bytes. Therefore OSC 133 (shell integration), OSC 7 (current directory), OSC 52 (clipboard), OSC 8 (hyperlinks), and title-setting sequences are visible to a control-mode client even when `allow-passthrough` is off.

`allow-passthrough` controls DCS `tmux;...ST` passthrough to an attached terminal. It is not a switch that hides ordinary OSC bytes from `-CC`. This supports the plan's §6.3 premise, but the operational consequence is easy to miss: if xterm.js is the only emulator, it must receive the raw OSC bytes if it is expected to process them; if the daemon parses them for metadata, it must do so as a sidecar without removing bytes needed by the browser.

The plan's “current line” fallback should not assume that OSC 133 is always present. Shell integration can be disabled or customized, and output can be paused/dropped during reconnect. A server emulator can infer the visible line but cannot recover semantic prompt boundaries that never arrived; a sidecar parser has the same limitation.

## 6. Flow control and reconnect

### pause-after and extended output

For tmux 3.2+, `refresh-client -f pause-after=30` enables pause-after behavior. The control client receives `%pause %pane` when output must be stopped, and can request `refresh-client -A '%pane:continue'`, after which tmux emits `%continue`. With pause-after, tmux may emit `%extended-output %pane age-ms ... : escaped` rather than ordinary `%output`.

The important semantic is loss: output queued after a paused pane can be discarded, and continuing resumes from the current point rather than replaying an unbounded backlog. A continuation therefore requires a fresh capture if exact display state matters. The daemon's ring buffer is a delivery optimization, not an authority.

The plan's “unviewed panes get no-output/pause-after” needs a version and safety qualification. `refresh-client -A '%pane:off'` is especially risky: `libtmux-rs` documents crashes in tmux 3.2a, 3.4, 3.5a, and 3.6 when queued output interacts with this mode (`crates/libtmux/docs/findings.md`, roughly lines 117–132). Prefer `pause-after` with a tested version matrix; do not use `off` as a blanket optimization on supported older tmux versions.

### reconnect

On reconnect, the reliable procedure is: stop delivery for that pane, obtain a new snapshot plus mode state and a fresh boundary, then resume. Replaying an arbitrary ring buffer after an old capture is not enough because pause-after may have discarded bytes and because terminal parsers are stateful. A reconnect may reuse the existing tmux control connection, but the snapshot boundary must be per pane and per delivery stream.

## 7. Resize behavior

`refresh-client -C WxH` makes a control client participate in the tmux client-size calculation; without `-C`, the control client does not supply the phone's dimensions. Recent tmux also accepts the `@window:WxH` form in relevant contexts. The plan's `refresh-client -C` is therefore directionally correct.

The risk is `window-size latest`: tmux's shared window size policy can let the most recently active client resize the pane, causing a laptop or another attached terminal to receive a SIGWINCH. `tmuxy` uses `window-size manual` around attach/resize/capture to avoid races. Tether should choose and document a policy (manual while phone-viewed, or latest with explicit interference accepted) and serialize resize, capture, and state restoration. A resize between the capture and browser application is another reason to include dimensions in the snapshot and reject/apply stale snapshots by generation.

## 8. Format subscriptions as a cheap event source

Modern tmux supports `refresh-client -B 'name:target:format'` subscriptions. `control.c`, around lines 961–985, emits:

```text
%subscription-changed NAME $sid @wid idx %pid : value
```

The format can use window/session variables and `#{window_flags}` (including activity/bell-related flags). Targets can be selected by session/window; newer format aliases include `%n`, `%*`, `@n`, and `@*`. tmux coalesces subscription changes and does not promise per-byte or zero-latency delivery; in practice this is a cheap roughly once-per-second-or-change event source, not a high-frequency stream.

Use subscriptions for the session list and per-window activity/bell indicators instead of polling every pane. Keep a fallback to `list-windows`/`list-panes` for older tmux and after reconnect. Treat `%subscription-changed` as a hint that triggers UI state refresh, not as the authority for pane contents.

## 9. Other control-mode implementations

### WezTerm

WezTerm's real `-CC` implementation is in `mux/src/tmux.rs` and `mux/src/tmux_commands.rs`. Its pane-list request (around lines 667–672) asks for:

```text
session_id window_id pane_id pane_index cursor_x cursor_y
pane_width pane_height pane_left pane_top pane_active
```

Its capture path (roughly lines 971–1009) uses `capture-pane -p -t %id -e -C -S`, decodes tmux `unvis`/octal escaping, strips the trailing newline, converts line endings, and writes the result into a local terminal. It also handles early output/backlog and cursor position. WezTerm has a local terminal emulator because its native GUI needs a local mux/pane model; this demonstrates the state needed, not that tether must choose the same architecture.

### tmuxy

`https://github.com/flplima/tmuxy` is the closest web-oriented precedent found. It speaks control mode, uses a vendored `vt100` server-side model, and sends cell state to a web client. Its code explicitly restores alternate/mouse/cursor/keypad/wrap-like modes around capture, suppresses stale output during initialization, uses pause-after, and manages manual sizing. It also documents Unicode width drift. This is strong evidence that a server model is useful when the product wants server-side cells and recovery, but not evidence that xterm.js cannot be the sole emulator.

### Protocol-only Rust libraries

- `https://github.com/ace-rs/tmuxctl` / `https://docs.rs/tmuxctl/latest/src/tmuxctl/lib.rs.html`: young byte-level control-mode parser, reply correlation, layout parsing, and octal decoding; no terminal emulator.
- `https://github.com/tmux/tmux`'s own `control.c`: authoritative protocol behavior and the source to use for version-specific tests.
- `https://github.com/ArcavenAE/tmux-cmc`: persistent reader/writer-thread wrapper, but pre-1.0 and not a complete reconnect/list/snapshot solution.
- `https://github.com/haowjy/libtmux-rs` (local clone `/home/jimyao/.meridian/ref/libtmux-rs`): current alpha library with the most relevant tested snapshot boundary. Its protocol layer is worth adapting or studying even if tether does not take the whole dependency.

Termux-style clients and OmniTerm use ordinary PTYs or use control mode only for activity/metadata; they do not provide a stronger `-CC` snapshot protocol precedent. iTerm2, WezTerm, tmuxy, par-term, and geistty all keep a terminal emulator somewhere, but GUI clients commonly need a local emulator for rendering. Protocol-only clients demonstrate that an emulator is optional at the control layer.

## 10. Rust crate health

| crate | observed release / state | assessment |
|---|---|---|
| `vt100` | 0.18.1, released 2026-10-19; `doy/vt100-rust`; Jesse Luehrs; MIT | Small, focused parser/screen API, active and practical for a lazy per-pane model. Small maintainer footprint; pin and test behavior needed. [crates.io](https://crates.io/crates/vt100), [docs.rs](https://docs.rs/crate/vt100/latest) |
| `alacritty_terminal` | 0.26.0, released 2026-04-06; Alacritty project; Apache-2.0 | Active and feature-rich, but pre-1.0 and substantially larger/heavier. Use only if tether needs its richer terminal/grid semantics. [crates.io](https://crates.io/crates/alacritty_terminal), [docs.rs](https://docs.rs/crate/alacritty_terminal/latest) |
| `portable-pty` | 0.9.0, released 2025-02-11; WezTerm project; MIT | Healthy enough as a PTY abstraction, but irrelevant to a daemon that only attaches to an existing tmux control client. Its blocking I/O should be isolated from Tokio if used for tests or a different path. [crates.io](https://crates.io/crates/portable-pty), [docs.rs](https://docs.rs/crate/portable-pty/latest) |
| `tmuxctl` | 0.1.0, released 2026-06-19; ace-rs | Plausible parser starting point, but young and not a state/reconnect implementation. Hide it behind an adapter if used. [docs.rs source](https://docs.rs/tmuxctl/latest/src/tmuxctl/lib.rs.html) |
| `libtmux-rs` | repository alpha.16; registry/report observed alpha.15 discrepancy | The snapshot boundary and compatibility tests are valuable. Alpha status argues for copying the narrow protocol idea or pinning carefully rather than making it a foundational dependency immediately. [repository](https://github.com/haowjy/libtmux-rs) |

Release dates above are the state observed during this research on 2026-10-21; verify before dependency selection. The main health risk is not that these crates are abandoned, but that `alacritty_terminal` and the alpha control libraries add API and behavior surface far beyond the first tether bridge.

## 11. Plan claims that are wrong or risky

1. **“`capture-pane -e` is the pane snapshot.”** Risky. It is a grid/text snapshot, not cursor, alternate-screen, parser, mode, or raw-stream state. Pair it with `list-panes -F` state and, if needed, `capture-pane -P -C`.
2. **“After `%end`, append `%output`.”** Wrong as a complete handoff rule. Use a private post-reply marker and consume pre-marker output exactly once; see libtmux-rs's `PaneOutput::snapshot` tests.
3. **“The daemon can drop output while a pane is unviewed and resume transparently.”** Wrong if exact state is promised. Pause-after/off can discard bytes; resume/reconnect needs a fresh snapshot.
4. **“`pause-after` is just backpressure.”** Risky. It changes delivery semantics and may emit `%extended-output`; it is a loss/recovery boundary.
5. **“Use `refresh-client -A '%pane:off'` for all non-viewed panes.”** Unsafe on several tmux versions; libtmux-rs records crashes with queued output. Version-gate or prefer pause-after.
6. **“One 256-KB output ring is enough to recover any pane.”** Not an authority. It cannot recover discarded paused output or reconstruct terminal parser state across an arbitrary disconnect.
7. **“A lazy terminal model can be recreated solely from the visible capture.”** Wrong for modes and partial escapes. Either retain tmux state fields/pending bytes or accept a mode-reset/re-render contract.
8. **“OSC 133 is available whenever a shell is running.”** Risky. Shell integration may be absent/customized and output may be lost during pause/reconnect. Treat it as optional metadata.
9. **“`allow-passthrough` controls whether control-mode clients see OSC.”** Wrong. It controls DCS tmux passthrough to terminals; ordinary OSC bytes are in raw `%output`.
10. **“`refresh-client -C` is sufficient resize handling.”** Incomplete. Select a `window-size` policy, serialize resize with capture, and handle another attached client changing the shared size.
11. **“Subscriptions are a real-time activity stream.”** Risky. `%subscription-changed` is coalesced/limited and useful for UI hints, not per-output timing.
12. **“`alacritty_terminal` is needed because tmux cannot restore state.”** Not established. tmux exposes enough state for a no-server-emulator bridge; the crate is a product/recovery choice, with substantial complexity and API surface.
13. **“A raw-output-only design gives server-side semantic current-line state.”** Wrong without an OSC/parser sidecar. xterm.js can render it, but the daemon cannot query its state unless it parses OSC 133 or maintains an emulator.
14. **“The browser's xterm.js state is automatically equivalent to tmux's grid.”** Risky for Unicode width, alternate-screen transitions, modes, and races around snapshot application. Include dimensions/state generation and test real workloads.

## Final recommendation

Proceed with tmux as the only authoritative server-side screen model and xterm.js as the renderer, but make the snapshot protocol explicit: primary/alternate captures, pane format state, pending-parser policy, byte-accurate `%output` decoding, and a tested private boundary marker. Keep a bounded ring only for diagnostics/short buffering; every pause, reconnect, resize generation change, or uncertain boundary must force a new snapshot.

Do not add `alacritty_terminal` per pane to solve the control-mode handoff. If tether later needs server-side search, semantic current-command state independent of client delivery, deterministic multi-client replay, or a canonical cell protocol, add a lazy `vt100` model behind the same snapshot boundary. That is the lowest-complexity escalation: it preserves tmux authority while avoiding the size and maintenance cost of an Alacritty terminal core in the MVP.

## Sources and local clones

- tmux source, current clone: `/home/jimyao/.meridian/ref/tmux`; 3.4 tag was also inspected in `/tmp/tmux-src`. Key files: `control.c`, `cmd-capture-pane.c`, `window.c`, `input.c`, `server-client.c`, `tmux.1`.
- iTerm2 source: `/home/jimyao/.meridian/ref/iTerm2`. Key files listed in §3.
- WezTerm source: `/home/jimyao/.meridian/ref/wezterm`, especially `mux/src/tmux.rs` and `mux/src/tmux_commands.rs`.
- libtmux-rs: `/home/jimyao/.meridian/ref/libtmux-rs`, especially `crates/libtmux/src/control/actor.rs`, `control.rs`, tests, and `docs/findings.md`.
- tmuxy: https://github.com/flplima/tmuxy
- tmuxctl: https://github.com/ace-rs/tmuxctl and https://docs.rs/tmuxctl/latest/src/tmuxctl/lib.rs.html
- tmux-cmc: https://github.com/ArcavenAE/tmux-cmc
- crate pages: https://crates.io/crates/vt100, https://docs.rs/crate/vt100/latest, https://crates.io/crates/alacritty_terminal, https://docs.rs/crate/alacritty_terminal/latest, https://crates.io/crates/portable-pty, https://docs.rs/crate/portable-pty/latest
