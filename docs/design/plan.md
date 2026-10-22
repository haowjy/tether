Mobile tmux client ("tether"): research & plan
Research and planning only. No code written. Revised 2026-10-21 (ET).

Decisions (from Jimmy, 2026-10-21):

Device: iPhone 17 Pro only. The layout stays responsive, so rotation and a future iPad work.
tmux: 3.4 on the server (3.7b on the Mac), with the laptop sometimes attached at the same time. window-size latest is confirmed. The prefix is the default C-b. Jimmy will add the recommended tmux.conf lines (§6.4).
Tabs: 1 tab = 1 tmux window, showing the active pane full screen (he doesn't split panes). Tabs never auto-close on network loss.
Shell: shell-agnostic, with a single OSC 133 snippet (he's OK adding it) and carapace for completion.
Files: project roots picked in the app (saved in the server config), with no file watcher. One uploads folder. HEIC is converted on the phone. No video thumbnails.
Auth: the Tailscale login and hostname are auto-detected through LocalAPI (no manual config), plus a Face ID passkey in the MVP. ACLs are optional.
Scratch shell: kept. A native fallback via TestFlight or Xcode is acceptable.
Scope: tmux tabs plus a session list, cheap reconnect on spotty links, a Termius-grade keyboard with tool autocomplete, and a file manager. Agent status and notifications are out of scope, because Jimmy's agent harness already handles notifications.

1. Goal (from Jimmy)
A phone-first client for the tmux sessions on his dev server, reached only over his tailnet. It needs:

Tabs, one per tmux session, plus a session list for quickly reopening one.
Holding up on spotty travel connections: no polling from the phone, a cheap reconnect that sends a fresh screen snapshot, and tabs that stay open ("reconnecting") until their tmux window is gone.
A keyboard as good as Termius's, plus an app-provided suggestion strip (history, commands, flags, paths).
A built-in file manager: upload or paste photos and insert the file path into the terminal; rename, move and delete files; view images and video with range streaming; view code, markdown and diffs.
2. Prior art
Project	What it is	Transport / reconnect	Mobile UX	Files	License / maturity	Borrow / avoid
herdr https://herdr.dev	Background server that owns agent terminals. Marks each agent working, blocked, idle or done. Has a socket API and adds machines over SSH	Its own client↔server socket. Agents keep running while detached	Desktop TUI. No mobile client	No	OSS, popular (the site claims about 44k stars)	Inspiration only. Status features are out of scope. Server-owned terminals that outlive clients are the idea we're borrowing (tmux already gives us that)
ttyd https://github.com/tsl0922/ttyd	Serves one command's pty over WebSocket to xterm.js	WS. The client auto-reconnects, but each connection respawns the command (fine with tmux new -A)	A plain web terminal. No extra key bar or tabs	ZMODEM/trzsz upload only	MIT, mature (C/libwebsockets)	Borrow: the simplest baseline (ttyd -W tmux new -A -s main + tailscale serve). Good day-0 fallback
GoTTY https://github.com/sorenisanerd/gotty (fork of yudai/gotty)	Same idea in Go	WS, basic reconnect	Basic	No	MIT, moderately maintained	Go reference for pty→WS
WeTTY https://github.com/butlerx/wetty	Node + xterm.js web terminal that runs ssh/login	WS (socket.io)	Basic	No	MIT, mature	Avoid running ssh-in-browser; attach locally instead
sshx https://github.com/ekzhang/sshx	Collaborative web terminal over a relay, infinite canvas	WS via relay, E2E encrypted. Reconnects with sequence-numbered replay	Canvas is awkward on a phone	No	MIT, Rust	Borrow: sequence numbers plus resume-from-offset framing
tmate https://tmate.io / upterm https://github.com/owenthereal/upterm	Share a terminal through a relay	SSH-based	Uses a native SSH client	No	ISC / Apache-2.0	Not relevant (sharing, not phone UX)
mosh https://mosh.org	UDP State Synchronization Protocol. The server keeps a screen model and sends only diffs toward the latest state. Survives roaming, sleep and IP changes. Local echo	UDP/SSP. No byte replay, just "make the screen current"	Needs a native client	No	GPL-3, mature, slow-moving (no scrollback, no OSC52 in older builds)	Borrow the core idea: sync state, not bytes. Snapshot on reconnect. Predictive local echo
Eternal Terminal https://eternalterminal.dev	Reconnecting TCP. Buffers and replays missed bytes; supports native scrollback	TCP + replay buffer	No good iOS client	No	Apache-2.0	Replay buffer is the alternative to snapshotting. Unbounded catch-up is bad on cellular
Blink Shell https://blink.sh (https://github.com/blinksh/blink)	iOS SSH/mosh terminal	Best-in-class mosh on iOS	Strong keyboard handling, smart keys	Files.app integration, scp	GPL-3 source, paid app	Benchmark for keyboard and key-bar ergonomics. Still a terminal only: no status, no file viewing
Termius https://termius.com (keyboard docs https://docs.termius.com/terminal/mobile-terminal , autocomplete https://docs.termius.com/terminal/autocomplete-and-shell-integration)	Cross-platform SSH client (current tool)	SSH. iOS suspends it, so it drops	Keyboard benchmark: an always-visible add-on above the keyboard shows the first 3 groups of 4 keys. Groups can be reordered and customized. A side panel has the extended keyboard, snippets and history. Shift+Tab is included for Claude Code. Press-and-drag acts as arrow keys, double-tap sends Tab. Autocomplete covers history, paths and commands with arguments, using shell integration over extra SSH exec channels. Collapsed bottom bar: back, host pill with ×, +, keyboard toggle	SFTP	Proprietary, freemium	Match its keyboard and collapsed bar. Its disconnect pain comes from iOS backgrounding a TCP session
Moshi https://getmoshi.app	iOS terminal built for coding agents (SSH + mosh)	mosh survives sleep and app kills	Agent-focused. Push, Dynamic Island and Watch approvals	Limited	Proprietary	Borrow: approve-from-notification UX. Closest commercial competitor
tmux control mode (tmux -CC) https://github.com/tmux/tmux/wiki/Control-Mode, used by iTerm2 https://iterm2.com/documentation-tmux-integration.html	tmux emits structured %output %pane-id …, %window-add, %session-changed and similar events	Text protocol over stdio	iTerm2 maps tmux windows to native tabs	n/a	Part of tmux (ISC)	Key building block for per-pane streams and native tabs. Pitfalls: output escaping, flow control (pause-after, tmux ≥3.2), resize semantics
zellij web client https://zellij.dev (web client added in 0.43)	Zellij serves sessions to the browser	WS, built-in auth tokens	Browser, not phone-optimized	No	MIT	Shows a multiplexer-native web UI works. Jimmy uses tmux, though
VibeTunnel https://vibetunnel.sh (https://github.com/amantus-ai/vibetunnel)	Wraps commands with vt, browser terminal for Mac (now Linux too). Built for watching agents	WS / SSE, Tailscale recommended	Mobile web works. Native iOS is WIP	Basic file browser, git follow mode	MIT, beta	Borrow: asciinema recording, mobile web layout. Avoid: wrapping commands. We attach to existing tmux instead
Happy (Coder) https://happy.engineering (https://github.com/slopus/happy)	Native iOS/Android/web app for Claude Code and Codex. Encrypted relay you can self-host	E2E relay, push notifications	Chat UI, voice, permission prompts	File mentions	MIT, very active (~22k stars)	Borrow: push on "needs input", permission cards. Avoid: wrapping the agent CLI. Omnara's archived wrapper shows the upkeep cost
Omnara https://omnara.com	Was a mobile dashboard and voice control for agents. Pivoted in 2026 to a managed agent platform, and the old wrapper repo is archived	Hosted relay	iOS/Android (was)	–	Apache-2.0 / closed app	Cautionary tale about wrapping agents
Claude Code Remote Control https://docs.anthropic.com/en/docs/claude-code	Official: continue a local Claude session from the Claude app	Anthropic relay	Native	–	Proprietary	Claude-only. Doesn't cover tmux or other CLIs
Paseo, AgentsRoom, Onepilot, CodeAgentsMobile (listed at https://cosyra.com/guides/relay-apps-vs-cloud-containers.html)	Other agent relay apps	Mostly relays	Native	Varies	Mixed	Shows how crowded the agent-chat space is. Terminal + tmux + files is less covered
code-server https://github.com/coder/code-server / VS Code tunnels https://code.visualstudio.com/docs/remote/tunnels	Full IDE in the browser	WS, reconnect overlay, MS relay for tunnels	Unusable on a phone	Excellent	MIT / proprietary	Borrow: reconnect-overlay UX and the file-explorer model. Too heavy for this
filebrowser https://github.com/filebrowser/filebrowser	Self-hosted web file manager	HTTP, range streaming	Okay on mobile	Upload, rename, move, delete, preview	Apache-2.0, mature	Reference for file-manager features. Could even run as a sidecar for the MVP
xterm.js https://xtermjs.org (+ @xterm/addon-serialize, addon-webgl)	Terminal renderer used by VS Code	–	Mobile input is the weak spot (IME, selection)	–	MIT	Renderer of choice. Expect to do custom work on touch input, selection and the key bar
Notes
Why Termius drops. iOS suspends a backgrounded app after a few seconds, and TCP/SSH dies with it. mosh avoids this by being stateless over UDP. Any web or native client will be suspended too. The fix is to make resume instant and cheap, not to try to stay connected.
Two families exist and nobody bridges them. (a) Terminal transports: ttyd, mosh, ET, Blink. These are robust but blind to what's running. (b) Agent dashboards: herdr, Happy, Moshi, Omnara. These either wrap the agent CLIs or are desktop-only. Jimmy's harness already does notifications, so we only need (a), done well on a phone.
3. Gap
Nothing offers all of the following together:

An existing tmux server as the source of truth, with no wrapping of commands or agents.
A phone-first UI: session tabs, a quick switcher, a key bar.
mosh-like state-sync reconnect over the web, with tabs that survive any outage.
A Termius-grade keyboard plus server-side completion that is aware of the pane's cwd.
A built-in file manager tied to the pane's cwd, with photo paste → path insert and video streaming.
Tailnet-only access with no third-party relay.
4. Recommended architecture
Decision: tether talks to tmux directly through control mode. Jimmy owns the app, so no SSH client, keys or wrapping are involved. The server runs as Jimmy on the dev box and is reached only through tailscale serve.

iPhone (installable web app; thin WKWebView shell only as a fallback)
   │  HTTPS + one multiplexed WebSocket (tailnet only, via `tailscale serve`)
   ▼
tether daemon (one static Rust binary: tokio + axum, web assets embedded; runs as Jimmy)
   ├─ tmux bridge: one `tmux -CC` control client per session being viewed
   ├─ screen model per viewed pane (vt100 / alacritty_terminal), built lazily, dropped a few seconds after the last viewer leaves
   ├─ scrollback API (capture-pane -S/-E ranges, on demand)
   ├─ completion service (history / PATH / completion specs / paths, lazy)
   ├─ file API (rooted, range-capable, uploads)
   └─ scratch shells (optional pty, no tmux, non-persistent)

4.1 Transport
Option	Pros	Cons	Verdict
WebSocket over HTTPS	Works in every browser and with tailscale serve. One socket carries all panes	Head-of-line blocking, and it dies while iOS has the app suspended	Use it, with state-sync on top
WebTransport / QUIC	Survives network switches, datagrams	Safari support is uneven, needs a QUIC server, and does nothing while the app is suspended	v2+, behind feature detection
mosh-style UDP SSP	Best on bad links	Browsers can't send raw UDP, and libmosh is GPL	Borrow the semantics only
Reconnect protocol:

Every update carries a per-pane seq. On reconnect the client sends {pane, lastSeq}.
If the missing range is still in the bounded ring buffer, the server replays it. Otherwise it sends one serialized snapshot of the visible screen. Scrollback is fetched lazily.
Output is coalesced to at most about 30 fps, with only the latest frame sent when backlogged.
Heartbeat every ~10 s. The client reconnects immediately on visibilitychange or pageshow.
Tabs never auto-close on network loss. A dropped tab shows "reconnecting…" on its pill indefinitely. Retries use backoff with jitter: 0.5 s, 1, 2, 4… capped at 30 s. The backoff resets and a retry fires immediately on visibilitychange→visible, pageshow, online, or a tap on the pill.
A tab closes only when the server reports that its tmux window or session is gone (%window-close, %unlinked-window-close, %sessions-changed), or when you close it.
Server resources are separate from tab lifetime. The server drops a pane's screen model and control client promptly, a few seconds after the last viewer leaves. On reconnect it rebuilds the model with one capture-pane snapshot. The ring buffer is per connection, so a reconnect after a long gap always gets a snapshot.
4.2 tmux integration: control mode (primary)
Version: tmux 3.4 is enough. Control mode, refresh-client -C, per-client -f pause-after/no-output, extended-keys and allow-passthrough all exist by 3.3/3.4. Upgrading (the Mac has 3.7b) is optional. It would bring newer extended-keys formats and fixes, but nothing in the MVP needs it.
Model: 1 tab = 1 tmux window, showing that window's active pane full screen. Jimmy doesn't split panes. If a window does get split, the tab shows the active pane, and a small "⧉ 2 panes" badge lets you switch between them.
Resize policy (the laptop is sometimes attached at the same time):
Each phone control client sets its own size with refresh-client -C WxH.
The server-wide option stays window-size latest (the default since 3.1), so whichever client was used most recently sets the window size. When Jimmy types on the phone the window fits the phone; when he goes back to the laptop it snaps back.
Confirmed by Jimmy. tether does not change global tmux options. An optional per-window override, window-size manual, could pin the laptop size and let the phone pan, but that's not the default.
Event-driven session list comes from list-sessions/list-windows on connect, then from %session*/%window-* events.
Pitfalls: octal-escape decoding, %begin/%end command replies, and output flow control (pause-after).
Fallback: a raw pty running tmux attach, for a "raw view" mode.
The "+" sheet:
Attach: a list of sessions → windows (name, last activity, "attached on laptop" flag). Tapping a window opens a tab.
New tmux window or session: name and start dir (a picker over the configured project roots, plus path completion).
Scratch shell (no tmux): included because it's cheap (portable-pty plus the same renderer). It has a striped "⚠ scratch, not persistent" pill. Because tabs never time out, a scratch shell also stays alive across reconnects as long as tether itself is running; it dies only if tether restarts or you close it. A cap of 2 applies.
4.3 Installable web app vs native iOS app
Prefer the installable web app (PWA).

The photo picker, camera (<input type=file accept="image/*,video/*">) and clipboard image paste all work.
The only thing missing is a "Share to tether" entry in the iOS share sheet.
Neither option can keep a socket alive in the background, so the plan is fast resume.
A thin native WKWebView shell is the fallback if the keyboard spike (§6.1) or the touch spikes (§7) can't be made reliable in Safari. It gives native control over the input accessory view and first responder, plus the share sheet. The web UI is still the whole app inside it.

4.4 Stack: Rust (chosen) vs Go
Rust:
tokio (a current-thread runtime is enough), axum, tower-http (range requests, compression), and rust-embed for assets.
Built as one static musl binary.
Screen model: start with vt100 (small, easy snapshots). Switch to alacritty_terminal (more complete on real TUIs, heavier) if Claude Code or Codex render wrong.
A hand-written control-mode parser, and portable-pty for the fallback and scratch shells.
Frontend: xterm.js (WebGL renderer), a DOM text overlay for selection (§7.3), a small Preact or Svelte app, and a service worker for the app shell.
Why Rust won:
Idle memory is about 2–5 MB with no garbage collector, versus roughly 10–20 MB for Go, and memory use stays predictable under bursts. That matters on an already overloaded box.
Bounded channels make backpressure explicit.
Good terminal-emulator crates exist, and the static binary has no dependencies.
Go as the alternative: faster to write, with excellent creack/pty and coder/websocket. Embedding tsnet would allow in-process identity checks. Go loses on idle memory and GC behaviour under load, so pick it only if shipping speed matters more than resources.
4.5 Resource budget (the dev server is already overloaded and crashes)
Targets: idle RSS under ~5 MB, about 0% CPU when nobody is connected, and no way to make the existing crashes worse.

Purely event-driven. Control-mode events only: no polling timers, no periodic capture-pane, no tmux ls loop. When no phone is connected, tether holds no control clients. It attaches on demand, and the session list is fetched once per connect and then kept current by events.
Lazy screen models (dropped promptly).
A model is built only when a client views a pane: one capture-pane -e -p seeds it, and %output feeds it afterwards.
It is dropped a few seconds after the last viewer disconnects. The tab stays open on the phone and shows "reconnecting", but the server holds nothing for it.
Panes that are not being viewed are switched to no-output/pause-after.
Bounded everything:
a ring buffer of about 256 KB per viewed pane (past it, the client gets a snapshot);
bounded per-client send queues (dropping frames and falling back to a snapshot);
caps on connections, panes and scratch shells;
uploads streamed straight to disk;
paged listings and truncated previews;
scrollback served in fixed-size chunks.
Completion is lazy and cached (§6.3). The PATH index is built on first use and refreshed when PATH directories change (cheap mtime check on request, no file watcher). Completion specs are evaluated per request with a timeout and a concurrency of 1.
No heavy server work at all in MVP or v2.
HEIC conversion happens on the phone (§8).
There are no video thumbnails and no transcoding. Videos stream as-is via HTTP Range.
Image previews are the images themselves, loaded lazily.
No file watcher. Directory listings are read on demand when opened or pulled to refresh.
systemd user unit (sketch): Restart=on-failure, RestartSec=2, MemoryHigh=48M, MemoryMax=64M, CPUWeight=20, Nice=10, IOWeight=10, IOSchedulingClass=idle, TasksMax=32, plus OOMScoreAdjust=500 so the kernel kills tether before tmux or the agents.
Crash safety: tmux is the source of truth. If tether restarts, clients reconnect and get a snapshot.
Measure it: a debug endpoint reports RSS, tasks and buffer use. The MVP gate is meeting this budget.
5. Layout & collapsed state (Termius is the reference)
Modelled on Jimmy's two Termius screenshots, but with tabs at the bottom: the host pill becomes a horizontally scrollable row of tab pills. Optimized for iPhone 17 Pro, fully responsive. The layout is CSS grid/flex sized from visualViewport, and the terminal columns and rows are recomputed on rotation and resize. Landscape and a future iPad get the same UI with wider tab pills. The iPhone 17 Pro has a Dynamic Island, so in portrait the top inset (~59–62 pt) holds no UI, and in landscape the left or right insets do. All bars respect env(safe-area-inset-*): the bottom bar sits above the home indicator, and nothing goes under the notch or Dynamic Island. Use viewport-fit=cover and 100dvh.

Collapsed (keyboard hidden; the default when reading):

┌──────────────────────────────────────┐ ← safe-area top (status bar)
│ jimyao@pop-os:~/proj$ claude         │
│ …full-screen terminal…               │
│                                      │
│                                 [⤓]  │ ← jump-to-bottom (only when scrolled up)
├──────────────────────────────────────┤
│ [<] (●main:1 ×)(◌api:2 ×)(●lo…▸ [+] [⌨] │ ← floating bottom bar, scrolls sideways
└──────────────────────────────────────┘ ← safe-area bottom (home indicator)

[<] goes back to the host/session home (and to the file manager entry point).
Tab pill (1 tab = 1 tmux window): session:window name, a state dot, and ×.
The dot shows ● connected, ◌ pulsing while reconnecting (indefinitely, with the next-retry time; tap to retry now), ✕ grey briefly when the window is gone (then the pill is removed), or a striped pill for scratch.
Tapping a pill switches tab and keeps the keyboard state. Long-pressing gives rename, detach, or kill session (with confirmation).
[+] opens the session sheet (§4.2).
[⌨] is the only control that opens or closes the keyboard.
Keyboard shown (the default layout, matching the second Termius screenshot):

┌──────────────────────────────────────┐
│ terminal (resized to visualViewport) │
├──────────────────────────────────────┤
│ [<] (●main:1 ×)(◌api:2 ×)…   [+] [⊞] │ ← same tab bar; ⊞ = extended keys / files / snippets panel
│ ┌ Use voice typing here… ─[Paste][AI]┐│ ← compose field (dictation-friendly, sent on ⏎)
│ git checkout ‹feat/›‹main›‹--track› ││ ← suggestion strip (§6.3), only while suggestions exist
│ esc  tab  ctrl  ⇧tab ▸swipe     [⌨̲]  │ ← key row (group 1, §6.4); last key hides the keyboard
├──────────────────────────────────────┤
│           iOS keyboard               │
└──────────────────────────────────────┘

The bottom bar sits directly above the accessory rows, which sit on top of the keyboard. Everything is positioned from visualViewport.height/offsetTop, not window.innerHeight.
The compose field is optional per tab. It's for dictation or longer prompts: text is edited locally and sent as a bracketed paste plus Enter. iOS autocorrect is allowed only in this field.
[Paste] sends the clipboard as a bracketed paste.
[AI] is a placeholder; later it could be a snippet picker.
The key row follows the Termius model: groups of 4 keys, user-reorderable, with the first group always visible and the rest a swipe away. The default groups come from agent keybinding research (§6.4).
Ctrl and Alt are sticky for one key, or locked by double-tap.
[⊞] opens a sheet with the extended keyboard, file manager, snippets and history.
6. Keyboard
6.1 Sticky keyboard: core requirement and #1 risk (prototype first)
The keyboard may only close through the explicit toggle. Scrolling output, tapping the terminal, selecting text, switching tabs, reconnects, toolbar taps, and opening or closing the file sheet must not dismiss it.

iOS Safari / PWA constraints and the approach:

element.focus() only opens the keyboard synchronously inside a user gesture handler (touchend or click). A focus call after an await or a timer won't show it. So every action that might move focus must re-focus in the same gesture.
Use one persistent hidden <textarea> (off-screen but not display:none, opacity ~0, font-size ≥16px to avoid zoom) as the single input sink for every tab. Tab switches only re-route where input goes; the focused element never changes.
Toolbar, key row, tab pills, suggestion strip and sheet buttons call preventDefault() on pointerdown/touchstart/mousedown, so tapping them never takes focus away from the textarea. Their action runs on pointerup.
Terminal taps and scrolls: the terminal surface doesn't take focus. xterm.js's own helper textarea is disabled or redirected to the shared sink.
blur handler: if keyboardWanted is true and the blur didn't come from the toggle, refocus within the same event turn when possible. Otherwise re-focus on the next touch anywhere, so the keyboard reappears on the next tap at worst.
Sheets (file manager, session list) are overlays inside the same document and never use native <select> or <input> elements that steal focus. Exception: file-manager text inputs such as rename borrow focus and hand it back to the sink when they close.
Reconnects never re-render the input element.
Use visualViewport resize and scroll events to lay out the bars and resize the terminal (sending a debounced refresh-client -C to tmux). Handle iOS's keyboard "bounce" without triggering layout loops.
Input attributes on the sink: autocapitalize=off autocorrect=off autocomplete=off spellcheck=false, plus inputmode="text", and enterkeyhint="send" if wanted. This avoids smart quotes and dashes.
Hardware keyboard: if detected, hide the key row (as Termius does) and forward the real key events.
Fallback: if the spike can't hold the keyboard reliably across all the listed interactions on current iOS, ship the same web UI inside a thin native WKWebView shell. There, a native UITextView first responder with a custom inputAccessoryView owns the keyboard, and the web layer only receives key events.
6.2 Autocorrect policy
The terminal input never gets autocorrect, auto-capitalization or smart quotes. Only the compose field allows them, as an opt-in for dictation.

6.3 Suggestion strip (tool autocomplete)
A row of chips above the key row; tapping a chip sends the remaining characters (a diff against what's already typed). Sources, ranked:

Shell history: $HISTFILE (zsh/bash/fish formats), deduplicated and ranked by recency and frequency, filtered by the current prefix.
Commands on PATH: an index built once and cached, refreshed when a PATH directory's mtime changes.
Subcommands and flags:
Evaluate lazily on the server, per request, with a timeout of about 300 ms and one at a time.
Options: carapace (carapace <cmd> export … <words> gives JSON for 1000+ tools), fish's complete -C "<line>", or zsh's capture via zpty.
Decision: carapace (https://carapace.sh, https://github.com/carapace-sh/carapace-bin). It's one Go binary covering 1000+ commands, independent of the shell. tether invokes it only on demand, when a chip is needed after a command word: carapace <cmd> export "" <args…> → JSON with values and descriptions. It runs with a 300 ms timeout, concurrency 1, and nice, and results are cached per (cmd, args prefix) with an LRU cap.
No resident completion daemon, and no zsh or fish needed. If carapace isn't installed, flags are simply not offered.
Paths relative to the pane's cwd (#{pane_current_path}): a directory listing, cached briefly.
Knowing the current command line is the hard part. Options:

Approach	How	Pros	Cons
A. Shell integration (OSC 133 / FinalTerm marks)	Snippet in .zshrc/.bashrc/fish that emits OSC 133;A/B/C/D around the prompt and command, optionally with OSC 7 for cwd. Server reads the marks from the %output stream	Exact prompt start, input start and command state. Works under tmux with passthrough / allow-passthrough, or by parsing the stream before tmux renders it	Needs a one-time dotfile change. Inside TUIs (Claude Code, vim) there's no prompt, so the strip hides
B. Read the cursor line from the screen model	Text from prompt end to cursor on the current row	No setup	Prompt detection is heuristic. Breaks on multi-line, right prompts and wrapped lines
C. Track typed input locally	Client mirrors what it sent	Simple	Goes wrong with history recall, Tab completion and readline edits
Decision: A + B, shell-agnostic. Ship one small snippet that works in both zsh (precmd/preexec hooks) and bash (PROMPT_COMMAND plus a PS0/DEBUG-trap preexec, or the bash-preexec approach). It emits OSC 133 A/B/C/D and OSC 7 (cwd); Jimmy has agreed to add it. OSC 133 marks say where input begins and whether we're at a prompt. The command text itself is read from the screen model between the input-start mark and the cursor, so the strip stays accurate even after Tab, ↑ or readline edits. Without the shell snippet, fall back to B with a prompt regex, and show nothing when unsure. C is used only for chips typed in the same burst.

Open caveat: tmux doesn't pass OSC 133 through to clients by default. Control mode does deliver raw pane output in %output, so the server can see the marks itself before any rendering. This needs verifying in the spike.

6.4 Agent keybindings → key-row groups
Research sources:

Claude Code: interactive mode https://code.claude.com/docs/en/interactive-mode and terminal config https://code.claude.com/docs/en/terminal-config
Codex CLI: tooltips https://github.com/openai/codex/blob/main/codex-rs/tui/tooltips.txt, backtrack source https://github.com/openai/codex/blob/main/codex-rs/tui/src/app_backtrack.rs, and a cheat sheet https://linuru.com/codex-cli/
opencode: keybinds https://opencode.ai/docs/keybinds/ and https://opencode.ai/v2/docs/cli/keybinds/, agents https://opencode.ai/docs/agents/, and the Shift+Tab agent-cycle change https://github.com/anomalyco/opencode/issues/49133
Key	Claude Code	Codex CLI	opencode
Esc	interrupt, close dialog	interrupt. With an empty composer, starts backtrack	interrupt session
Esc Esc	clear draft, or rewind menu if empty	backtrack: edit a previous message	–
Shift+Tab	cycle permission mode (normal / auto-accept / plan)	–	cycle agents (v2 default; Tab in older versions)
Tab	accept autocomplete	queue a message while working	(old) switch agent
Ctrl+C	interrupt or clear. Twice exits	exit	exit
Ctrl+D	exit (twice)	–	exit
Newline	Ctrl+J or \+Enter. Shift+Enter needs terminal support	Ctrl+J or Alt+Enter	Shift+Enter / Ctrl+J
Ctrl+R	reverse history search	–	rename session
Ctrl+T	task checklist	transcript overlay	–
Ctrl+O	transcript viewer	copy last response	recent sessions
Ctrl+V	paste image	paste image	paste
Ctrl+B	background task (press twice under tmux)	–	background tools
Ctrl+G	open in $EDITOR	open in $EDITOR	–
Ctrl+L / Ctrl+S / Ctrl+Z	redraw / stash prompt / suspend	clear UI / – / –	–
Ctrl+X	prefix (Ctrl+X Ctrl+E, Ctrl+X Ctrl+K)	–	leader (Ctrl+X then n, l, c…)
Ctrl+P	history up	–	command palette
Arrows	history, menus, dialog tabs	history, transcript nav	subagent navigation
@ / ! ?	file mention / slash cmd / bash mode / help	/ cmds, ! shell, ? shortcuts	@ agent or file, / cmds
Recommended key-row groups (Termius-style groups of 4; group 1 always visible next to the hide-keyboard key, swipe for more):

Core: esc · tab · ctrl · ⇧tab. Esc and Shift+Tab are the top agent keys.
Arrows: ← ↑ ↓ →. Also available via the trackpad gesture.
Agent controls: ^C · esc esc (one tap sends two Escs about 50 ms apart) · ⏎ newline (sends Ctrl+J, which works everywhere) · ^V img.
Symbols: / · @ · ! · |.
Ctrl combos: ^R · ^T · ^O · ^B.
More: alt · ^X (leader) · ^G · ^D · ~ · - · ` · \ · tmux prefix. These can be reordered.
Image paste note: Ctrl+V in Claude Code and Codex reads the server's clipboard, which doesn't exist on a headless box. So ^V img opens the photo picker, uploads the image, and inserts the file path instead. Both agents accept image paths in the prompt.

Special encodings and tmux 3.4 settings:

Shift+Tab = CSI Z (\e[Z). It passes through tmux natively (send-keys BTab).
Shift+Enter has no legacy encoding. It needs CSI-u \e[13;2u or xterm modifyOtherKeys \e[27;2;13~. In tmux 3.4, set set -s extended-keys on and set -as terminal-features '*:extkeys', then send send-keys S-Enter, so tmux encodes it in whatever form the app asked for. Prefer Ctrl+J for newlines, since it's universal.
Alt+Enter (Codex newline) = ESC CR. Alt+key = ESC prefix (send-keys M-Enter).
Esc / Esc Esc: set set -s escape-time 10 so a lone Esc is delivered quickly and two Escs aren't merged into an Alt sequence.
Ctrl+B under tmux: the prefix is C-b, so Claude Code's background shortcut needs C-b C-b. The ^B key sends both automatically.
Input path: tether sends named keys via send-keys (tmux 3.4 understands BTab, S-Enter, M-Enter, C-j) and literal text via send-keys -l. No hand-encoding.
tmux.conf additions (Jimmy has agreed to add them; tether never edits them itself): set -s extended-keys on, set -as terminal-features '*:extkeys', set -s escape-time 10, set -g allow-passthrough on (OSC 133/52), set -g set-clipboard on.
7. Touch interactions (core MVP; spikes alongside §6.1)
7.1 Scroll
Normal screen: a native-feeling momentum scroll through scrollback.
History is fetched lazily in chunks of about 200 lines with capture-pane -p -e -S -N -E -M (ANSI preserved) and cached client-side per pane with a cap.
Nothing is fetched unless you scroll.
New output while scrolled up doesn't yank you to the bottom; a ⤓ jump-to-bottom button appears instead.
Alternative: drive tmux copy-mode, which is simpler but less native. Keep it as a fallback.
Alternate screen or mouse mode (Claude Code, vim, less, htop), detected from the screen model's modes: vertical swipes are translated into mouse-wheel events (SGR 1006) or ↑/↓ keys, scaled by velocity.
Horizontal swipes on the terminal do nothing by default, to avoid fights with the system back gesture. Swiping on the tab bar scrolls the tab pills.
7.2 Cursor movement
Trackpad mode: long-press on the space bar, or two-finger press on the terminal, then drag. Drag distance is converted to ←/→/↑/↓ with acceleration, like Termius's press-and-drag arrows.
Tap to position on the current prompt line: compute the column delta between the cursor and the tap, then send that many ←/→. This is enabled only when OSC 133 marks (or the B heuristic) show we're at a shell prompt and the tap is inside the input region. Multi-line input uses row deltas with ↑/↓ only if the shell supports it, so v1 is single-line only.
7.3 Select, copy & paste
Long-press enters selection mode. The canvas/WebGL renderer can't be selected natively, so the visible rows (plus loaded scrollback) are rendered as real DOM text in an overlay, with the same monospace metrics.
iOS native selection handles, the loupe and the Copy menu then just work.
Double-tap selects a word, triple-tap a line, and there's a "Select output" shortcut for the last command when OSC 133 is present.
Copy: navigator.clipboard.writeText must be called inside the gesture (the Copy menu tap).
Clipboard sync:
When an app writes the clipboard via OSC 52 (from tmux set-clipboard on, or nvim), the server forwards it. The client can only write it to the iOS clipboard on the next user gesture, so it shows a "Copy from server" chip.
Phone copies can optionally be pushed into a tmux buffer (set-buffer).
Paste: via [Paste] in the compose bar or the long-press menu, sent as a bracketed paste (ESC[200~…ESC[201~) when the pane has enabled it.
iOS clipboard quirks:
navigator.clipboard.readText() shows the system "Paste" confirmation bubble and only works within a gesture.
Images need clipboard.read(), which may be refused. Fall back to the native paste event on the hidden textarea, which also catches image paste and routes it to upload (§8).
7.4 Spike list (prototype in this order before any feature work)
Sticky keyboard across every interaction in §6.1 (PWA on current iOS). Go/no-go gate for native-shell fallback.
Selection overlay: native handles over xterm.js, alignment at different font sizes.
Momentum scroll with lazy scrollback, plus wheel translation inside Claude Code.
Tap-to-position and trackpad mode with OSC 133 marks seen via control-mode %output.
Clipboard: gesture-bound copy, paste bubble, image paste, OSC 52 round trip.
8. File manager
Opened from [⊞] or [<], as a sheet over the terminal. The keyboard stays put.

Roots: chosen in the app. A Settings sheet lets you browse from $HOME (listed on demand, one directory at a time) and add or remove project roots. They're saved in the server config ~/.config/tether/config.toml (roots = [...]). Writes are atomic: write to a temp file, then rename. Only allowlisted users can change them. The uploads folder uploads_dir defaults to ~/tether-uploads and can be changed in the same sheet. Each tab opens at its pane's cwd if that's inside a root, otherwise at the root picker. No file watcher: listings are read on demand (on open, pull-to-refresh, or after our own file operations). Paths are resolved through canonicalize and checked against the roots. Runs as Jimmy only.
API:
GET /fs/list (paged)
GET /fs/raw (with Range, ETag and a correct MIME type; this is how video streams in Safari)
POST /fs/upload (chunked and resumable, streamed to disk)
POST /fs/rename|move|mkdir
DELETE /fs (moves to ~/.local/share/tether/trash, with undo)
Photo → terminal:
Pick, take or paste a photo.
HEIC is converted on the phone. With <input type=file accept="image/*">, iOS usually hands over a JPEG already (automatic "Most Compatible" conversion). If it's still image/heic, the client decodes it with createImageBitmap (or <img> + canvas) and re-encodes with canvas.toBlob('image/jpeg', 0.9) before upload. There's an optional downscale (longest side 2048 px) with a "send original" toggle.
It uploads to the single configured uploads folder (uploads_dir, default ~/tether-uploads/) with a timestamped name. That folder is also browsable in the file manager.
The quoted absolute path is inserted into the pane with send-keys -l, without Enter.
Viewers:
code with lazy client-side syntax highlighting;
sanitized markdown;
image zoom and pan;
<video> via range requests (no server thumbnails);
diffs from git diff / git status in the cwd (unified on phone, side-by-side on iPad);
PDFs (v2);
a metadata view for binaries. Large files are paged.
Bandwidth: only small listings load until you tap something. Image previews load lazily as they scroll into view. Upload has a "resize / send original" toggle.
9. Features by phase
Spikes first (§7.4). These gate the native-shell fallback, which is acceptable via TestFlight or Xcode.

MVP

Rust daemon (control mode, resource budget met) behind tailscale serve, with the Tailscale-login allowlist and a Face ID passkey (WebAuthn).
Tab bar (1 tab = 1 window), collapsed and keyboard states, responsive layout and safe areas, the "+" sheet (attach, new window or session, scratch shell).
Reconnect: indefinite "reconnecting" with backoff and instant retry, snapshot on resume, prompt release of server state.
Sticky keyboard, agent-oriented key groups (§6.4), compose field with Paste, special keys sent via tmux key names.
Touch: momentum scroll with lazy scrollback, wheel translation, jump-to-bottom, trackpad and tap-to-position, DOM selection with copy and bracketed paste.
Suggestion strip: history, PATH and paths, with the shell-agnostic OSC 133 snippet. carapace flags if it's installed.
Files: browse the configured roots, view code, markdown and images, stream video via Range, photo pick or paste (client-side HEIC→JPEG) → uploads folder → path insert.
v2

File operations (rename, move, delete to trash, mkdir), resumable multi-upload, diff viewer, PDFs.
OSC 52 ↔ iOS clipboard and tmux-buffer sync. Snippets. Multi-host.
Later

Native WKWebView shell, if the spikes didn't already force it.
WebTransport/QUIC and predictive local echo.
Possible later: an optional status/notification hook, e.g. tether notify, called by Jimmy's harness to badge a tab.
10. Security & auth
No SSH keys. tether runs as Jimmy on the dev box (a systemd user unit) and starts or attaches tmux directly as him.
Tailnet only. Bind to 127.0.0.1:PORT and publish with tailscale serve --https=443 http://127.0.0.1:PORT, which gives a *.ts.net certificate. Never tailscale funnel. At startup, refuse to run if Funnel is enabled for the port (check tailscale serve status).
Identity:
tailscale serve adds Tailscale-User-Login (plus Name and Profile-Pic) to proxied requests. tether accepts a request only if the connection comes from loopback and the login matches the allowlist, which is auto-detected at startup: tether queries the local tailscaled LocalAPI (/localapi/v0/status, the equivalent of tailscale status --json; it reads Self.UserID → User[...].LoginName, or whois on its own IP). The node owner's login becomes the allowlist. Override flags: --allow-login (repeatable) and --rp-id.
Optionally cross-check with the tailscaled LocalAPI whois, called with the X-Forwarded-For peer address, to get the node and user. This covers the case where headers are missing or the request was proxied unexpectedly.
Requests without a header are denied.
Tailscale ACLs / grants are optional hardening, not required. On a personal tailnet, only his own devices exist, and the login allowlist plus the passkey already gate access. If he ever shares the tailnet or a node, add a grant that limits tcp:443 on the dev box to his user or devices.
Face ID passkey (WebAuthn) is in the MVP. Registration is done once from the allowlisted login. Unlocking sets an HttpOnly, SameSite=Strict session cookie (e.g. 12 h, sliding), required again after it expires or on a new device. The relying-party ID is auto-detected from the same LocalAPI status (Self.DNSName, the MagicDNS / tailscale serve HTTPS hostname, minus the trailing dot). It's overridable with --rp-id. A warning is logged if the hostname changes, because existing passkeys would stop working. Recovery: run tether passkey reset on the server.
Web hardening:
check Origin equals the ts.net host;
require a per-session token on the WebSocket upgrade;
use a strict CSP;
no cross-origin requests.
File safety:
roots allowlist and symlink checks;
delete moves to trash;
upload size caps;
files are never executed from upload dirs;
destructive actions are logged.
Scratch shells are clearly labelled and capped at 2.
11. Open questions
None remaining. Every planning question has been answered. The only unknowns left are the outcomes of the spikes (§7.4), with sticky-keyboard reliability in iOS Safari the most important; the native WKWebView shell is the agreed fallback.
