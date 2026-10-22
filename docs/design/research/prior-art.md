# Prior art and the gap tether fills

Survey of projects that overlap tether, done while writing the first plan
(2026-10-21). It explains why tether is worth building and which projects to read
before building each subsystem; the current design is in [plan.md](../plan.md).

| Project | What it is | Transport / reconnect | Mobile UX | Files | License / maturity | Borrow / avoid |
|---|---|---|---|---|---|---|
| [herdr](https://herdr.dev) | Background server that owns agent terminals. Marks each agent working, blocked, idle or done. Has a socket API and adds machines over SSH | Its own client↔server socket. Agents keep running while detached | Desktop TUI. No mobile client | No | OSS, popular (the site claims about 44k stars) | Inspiration only. Status features are out of scope. Server-owned terminals that outlive clients are the idea we borrow (tmux already gives us that) |
| [ttyd](https://github.com/tsl0922/ttyd) | Serves one command's pty over WebSocket to xterm.js | WS. The client auto-reconnects, but each connection respawns the command | A plain web terminal. No extra key bar or tabs | ZMODEM/trzsz upload only | MIT, mature (C/libwebsockets) | The simplest day-0 fallback: `ttyd -W tmux attach -t main` behind `tailscale serve`. Use `attach`, not `new -A`: `new -A` starts a tmux server when none is running, inside ttyd's own service ([plan.md](../plan.md#architecture)) |
| [GoTTY](https://github.com/sorenisanerd/gotty) (fork of yudai/gotty) | Same idea in Go | WS, basic reconnect | Basic | No | MIT, moderately maintained | Go reference for pty→WS |
| [WeTTY](https://github.com/butlerx/wetty) | Node + xterm.js web terminal that runs ssh/login | WS (socket.io) | Basic | No | MIT, mature | Avoid running ssh-in-browser; attach locally instead |
| [sshx](https://github.com/ekzhang/sshx) | Collaborative web terminal over a relay, infinite canvas | WS via relay, E2E encrypted. Reconnects with sequence-numbered replay | Canvas is awkward on a phone | No | MIT, Rust | Borrow: sequence numbers plus resume-from-offset framing |
| [tmate](https://tmate.io) / [upterm](https://github.com/owenthereal/upterm) | Share a terminal through a relay | SSH-based | Uses a native SSH client | No | ISC / Apache-2.0 | Not relevant (sharing, not phone UX) |
| [mosh](https://mosh.org) | UDP State Synchronization Protocol. The server keeps a screen model and sends only diffs toward the latest state. Survives roaming, sleep and IP changes. Local echo | UDP/SSP. No byte replay, just "make the screen current" | Needs a native client | No | GPL-3, mature, slow-moving (no scrollback, no OSC 52 in older builds) | Borrow the core idea: sync state, not bytes. Snapshot on reconnect. Predictive local echo |
| [Eternal Terminal](https://eternalterminal.dev) | Reconnecting TCP. Buffers and replays missed bytes; supports native scrollback | TCP + replay buffer | No good iOS client | No | Apache-2.0 | Replay buffer is the alternative to snapshotting. Unbounded catch-up is bad on cellular |
| [Blink Shell](https://blink.sh) ([source](https://github.com/blinksh/blink)) | iOS SSH/mosh terminal | Best-in-class mosh on iOS | Strong keyboard handling, smart keys | Files.app integration, scp | GPL-3 source, paid app | Benchmark for keyboard and key-bar ergonomics. Native, so its keyboard is not a web precedent |
| [Termius](https://termius.com) ([keyboard](https://docs.termius.com/terminal/mobile-terminal), [autocomplete](https://docs.termius.com/terminal/autocomplete-and-shell-integration)) | Cross-platform SSH client (Jimmy's current tool) | SSH. iOS suspends it, so it drops | Keyboard benchmark: an always-visible add-on above the keyboard shows the first 3 groups of 4 keys, reorderable and customizable. A side panel has the extended keyboard, snippets and history. Shift+Tab included for Claude Code. Press-and-drag acts as arrow keys, double-tap sends Tab. Autocomplete covers history, paths and commands with arguments, using shell integration over extra SSH exec channels. Collapsed bottom bar: back, host pill with ×, +, keyboard toggle | SFTP | Proprietary, freemium | Match its keyboard and collapsed bar. Its disconnect pain comes from iOS backgrounding a TCP session |
| [Moshi](https://getmoshi.app) | iOS terminal built for coding agents (SSH + mosh) | mosh survives sleep and app kills | Agent-focused. Push, Dynamic Island and Watch approvals | Limited | Proprietary | Closest commercial competitor. Its notification UX is out of scope here |
| tmux [control mode](https://github.com/tmux/tmux/wiki/Control-Mode), used by [iTerm2](https://iterm2.com/documentation-tmux-integration.html) | tmux emits structured `%output`, `%window-add`, `%session-changed` and similar events | Text protocol over stdio | iTerm2 maps tmux windows to native tabs | n/a | Part of tmux (ISC) | The building block for per-pane streams and native tabs. tether uses plain `tmux -C`; `-CC` is the iTerm2 variant. Pitfalls: output escaping, snapshot boundaries, flow control, resize ([daemon-core.md](../daemon-core.md)) |
| [zellij web client](https://zellij.dev) (added in 0.43) | Zellij serves sessions to the browser | WS, built-in auth tokens | Browser, not phone-optimized | No | MIT | Shows a multiplexer-native web UI works. Jimmy uses tmux, though |
| [VibeTunnel](https://vibetunnel.sh) ([source](https://github.com/amantus-ai/vibetunnel)) | Wraps commands with `vt`, browser terminal for Mac (now Linux too). Built for watching agents | WS / SSE, Tailscale recommended | Mobile web works, but has open iOS keyboard reports. Native iOS is WIP | Basic file browser, git follow mode | MIT, beta | Borrow: mobile web layout. Its iOS keyboard issues show a hidden textarea alone doesn't solve the keyboard. Avoid: wrapping commands |
| [Happy (Coder)](https://happy.engineering) ([source](https://github.com/slopus/happy)) | Native iOS/Android/web app for Claude Code and Codex. Encrypted relay you can self-host | E2E relay, push notifications | Chat UI, voice, permission prompts | File mentions | MIT, very active (~22k stars) | Avoid wrapping the agent CLI. Omnara's archived wrapper shows the upkeep cost |
| [Omnara](https://omnara.com) | Was a mobile dashboard and voice control for agents. Pivoted in 2026 to a managed agent platform; the old wrapper repo is archived | Hosted relay | iOS/Android (was) | – | Apache-2.0 / closed app | Cautionary tale about wrapping agents |
| [Claude Code Remote Control](https://docs.anthropic.com/en/docs/claude-code) | Official: continue a local Claude session from the Claude app | Anthropic relay | Native | – | Proprietary | Claude-only. Doesn't cover tmux or other CLIs |
| Paseo, AgentsRoom, Onepilot, CodeAgentsMobile ([list](https://cosyra.com/guides/relay-apps-vs-cloud-containers.html)) | Other agent relay apps | Mostly relays | Native | Varies | Mixed | Shows how crowded the agent-chat space is. Terminal + tmux + files is less covered |
| [code-server](https://github.com/coder/code-server) / [VS Code tunnels](https://code.visualstudio.com/docs/remote/tunnels) | Full IDE in the browser | WS, reconnect overlay, MS relay for tunnels | Unusable on a phone | Excellent | MIT / proprietary | Borrow: reconnect-overlay UX and the file-explorer model. Too heavy for this |
| [filebrowser](https://github.com/filebrowser/filebrowser) | Self-hosted web file manager | HTTP, range streaming | Okay on mobile | Upload, rename, move, delete, preview | Apache-2.0, mature | Reference for file-manager features |
| [xterm.js](https://xtermjs.org) | Terminal renderer used by VS Code | – | Mobile input is the weak spot (IME, selection, touch) | – | MIT | Renderer of choice (xterm.js 6). Expect custom work on touch input, selection and the key bar |

## Young projects that overlap (2026)

Five small projects now cover parts of tether. None has a license, so they are for
study only: read the code, copy nothing.

| Project | Overlap | What to study first |
|---|---|---|
| [terminal-web](https://github.com/AaronFei/terminal-web) | Tailscale + tmux + tabs + image paste for AI CLIs | Its iOS input code ([session.ts](https://github.com/AaronFei/terminal-web/blob/main/web/session.ts)): keeps keyboard state when tapping the key bar, slides content with VisualViewport instead of resizing the terminal, tunes xterm's hidden input for iOS and CJK |
| [tmuxy](https://github.com/flplima/tmuxy) | Control mode + server-side vt100 + web client (92 stars) | Its restore code: modes restored around capture, stale output suppressed during setup, pause-after, manual window sizing; it documents Unicode width drift |
| [tmux-mobile](https://github.com/vokako/tmux-mobile) | Mobile tmux client on xterm.js 6 | Its [gesture and selection design](https://github.com/vokako/tmux-mobile/blob/main/docs/design-docs/pages/terminal-gestures.md) (xterm 6 has no touch support of its own) |
| [mobile-tty](https://github.com/elidickinson/mobile-tty) | Server-owned sessions for iPhone Safari | Its [iOS input plan](https://github.com/elidickinson/mobile-tty/blob/main/docs/plan-ios-input.md) and VisualViewport grid sizing |
| [ting.sh](https://github.com/andrewting19/ting.sh) | Mobile web terminal | Its changelog of per-iOS-version fixes (touch scrolling, keyboard avoidance, 16 px input, immediate focus) |

Evidence: [ios-web.md §6](ios-web.md), [tmux-control-mode.md §9](tmux-control-mode.md).
The Rust library [libtmux-rs](https://github.com/libtmux/libtmux-rs) is the reference
for the snapshot boundary ([daemon-core.md §3.5](../daemon-core.md#35-snapshot)).

## Notes

- **Why Termius drops.** iOS suspends a backgrounded app after a few seconds, and
  TCP/SSH dies with it. mosh avoids this by being stateless over UDP. Any web or native
  client is suspended too. The fix is to make resume instant and cheap, not to try to
  stay connected.
- **Two families, nobody bridges them.** (a) Terminal transports: ttyd, mosh, ET,
  Blink. Robust but blind to what's running. (b) Agent dashboards: herdr, Happy, Moshi,
  Omnara. These either wrap the agent CLIs or are desktop-only. Jimmy's harness already
  does notifications, so tether needs only (a), done well on a phone.

## The gap

No mature, licensed project offers all of the following together, so tether is still
worth building:

- An existing tmux server as the source of truth, with no wrapping of commands or agents.
- A phone-first UI: window tabs, a quick switcher, a key bar.
- mosh-like state-sync reconnect over the web, with tabs that survive any outage.
- A Termius-grade keyboard plus server-side completion that knows the pane's cwd.
- A built-in file manager tied to the pane's cwd, with photo paste → path insert and
  video streaming.
- Tailnet-only access with no third-party relay.

terminal-web and tmuxy come closest (above). Read terminal-web's iOS input code and
tmuxy's restore code before building the matching tether subsystems.
