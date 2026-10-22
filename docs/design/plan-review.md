# Tether plan review

Review of [plan.md](plan.md) (revised 2026-10-21), written 2026-10-21.
Evidence is in [research/](research/): `probe-tmux.md` (runtime tests on the dev
box, tmux 3.4 / systemd 255), `tmux-control-mode.md` (tmux, iTerm2, WezTerm and
libtmux-rs source), `ios-web.md` (WebKit bugs and docs), `libraries.md` and
`rust-crates.md` (library health). Items marked *guess* are not verified.

## Verdict

The plan holds up: control mode, tmux as the source of truth, a Rust daemon, the
reconnect-by-snapshot approach and the spike-first order are all sound. Six changes
come before any code:

1. **Never let tether start the tmux server.** Tested: a tmux server first started
   from inside a systemd user unit lives in that unit's cgroup and dies on
   `systemctl --user stop`. With tether's unit, `MemoryMax=64M` would also cover tmux
   and every agent. Start tmux outside the unit (its own user unit, or
   `systemd-run --user --scope`), and have tether only attach.
2. **Drop the server-side terminal emulator from the MVP.** tmux already holds the
   screen. A snapshot is `capture-pane` for both screens, plus pane state from
   `list-panes -F`, plus a marker that separates captured output from live output.
   xterm.js on the phone is then the only emulator. Add `vt100` later only if a
   feature needs the screen contents on the server.
3. **Treat the snapshot hand-off as a protocol, not "capture then stream".**
   `capture-pane` has no position in the output stream. Use pause, capture, marker,
   continue, as libtmux-rs does and tests (`PaneOutput::snapshot`).
4. **Keep tmux's window size fixed while the keyboard opens and closes.** The probe
   shows each `refresh-client -C` resizes the window and sends SIGWINCH to the app,
   and the laptop sees it too. Resize on tab open and rotation only; let the keyboard
   cover or pan the bottom rows.
5. **Change the keyboard goal from "never closes" to "rarely closes, one tap to
   recover".** WebKit still requires a user gesture to show the keyboard, the system
   Done/checkmark bar can't be hidden and closes the keyboard, and several iOS 26
   viewport bugs are open. A WKWebView wrapper fixes this only with a native input
   view, not on its own.
6. **Gate passkey enrolment on a code from the server, not on headers.**

## 1. Corrections to the plan

| Plan says | Evidence | Change to |
|---|---|---|
| `send-keys S-Enter` with extended-keys on (§6.4) | Probe: tmux 3.4 types the literal text `S-Enter` | `send-keys -H` with CSI-u bytes, or Ctrl+J (already preferred) |
| `allow-passthrough on` is needed to see OSC 133/7/52 (§6.3, §6.4) | Probe: OSC bytes appear in `%output` whether it's on or off | Drop it from the required tmux.conf lines; the §6.3 "open caveat" is resolved |
| Snapshot = one `capture-pane -e -p` (§4.1, §4.5) | Loses cursor, alternate screen, mouse/keypad modes, scroll region, bracketed paste and any half-received escape sequence | Capture primary and alternate screens, read state with `list-panes -F` (`alternate_on`, `cursor_x/y`, `keypad_*`, `mouse_*` exist in 3.4; bracketed paste does not), use `-P` for pending bytes |
| Unviewed panes switch to no-output/pause-after (§4.5) | `refresh-client -A '%pane:off'` crashes tmux 3.4 with queued output (libtmux-rs findings); pause-after discards output | Use the client-wide `no-output` flag or pause-after, never `:off`; every continue triggers a fresh snapshot |
| `refresh-client -A %0:pause` | Probe: parse error unless quoted | `refresh-client -A '%0:pause'` |
| Idle RSS under ~5 MB (§4.5) | Probe: each `tmux -C` client is its own ~5.3 MB process, and it runs in tether's cgroup | Budget the daemon plus 5.3 MB per attached session; consider one control client that switches sessions (*guess*: works because only one tab is visible at a time) |
| Keyboard detection from `innerHeight - visualViewport.height` (§5, §6.1) | iOS 26 standalone apps can report both as the visible height (WebKit 301994) | Combine several signals, tolerate stale values, and keep the ⌨ toggle as the recovery |
| WebSocket reconnect on visibilitychange/pageshow (§4.1) | iOS 26 can leave a new socket stuck in CONNECTING until reload (WebKit 308073); lifecycle events can be missing | Add a connect timeout; on a stuck socket, reload the page (state is on the server) |
| xterm.js WebGL with canvas fallback (§4.4) | xterm.js 6 removed the canvas renderer; WebGL loses context after backgrounding | WebGL with DOM fallback, and recreate on context loss |
| Input attributes avoid QuickType (§6.1) | They stop autocorrect, not the predictive bar | Assume the bar may show; measure it on the phone |
| RP ID auto-detected from LocalAPI | Fine, but changing the hostname makes every passkey unusable | Pin the RP ID in config after first detection |
| "Nothing offers all of this" (§3) | Five young projects now overlap: terminal-web (Tailscale + tmux + tabs + image paste for AI CLIs), tmuxy (control mode + vt100 + web, 92 stars), tmux-mobile, mobile-tty, ting.sh. None has a license | Still build it, but read terminal-web's iOS input code and tmuxy's restore code first. No licenses means study only, no copying |

## 2. Usability gaps

- **Narrow columns.** Portrait is about 45–50 columns, and Claude Code and Codex wrap
  badly at that width. Pinch to change font size per tab, plus a one-tap landscape
  layout. The `window-size manual` pan mode deserves to be a per-tab toggle, not a footnote.
- **Search the scrollback.** Missing. `@xterm/addon-search` over loaded history, or
  tmux's own search for history that isn't loaded yet.
- **Tappable paths and links.** Agents print file paths all the time; tapping one
  should open it in the file viewer, resolved against the pane's cwd. `localhost:3000`
  links can't open on the phone; later, offer "open via dev box" by publishing the
  port with `tailscale serve`.
- **Activity dots on tabs.** A dot on tabs with new output or a bell, from tmux format
  subscriptions (`refresh-client -B`). Event-driven, so it fits the budget. This is
  basic terminal UX, separate from the agent notifications that are out of scope.
- **Typing latency on cellular.** Predictive local echo is listed as "later". If the
  spike shows 200 ms+ echo on travel links, move it up; it's mosh's main benefit.
- **Fonts and wide characters.** Bundle a Nerd Font so prompt glyphs render. Emoji
  and East Asian width differ between tmux and xterm.js and push the cursor out of
  place; test with `unicode11` and Claude Code's spinner glyphs.
- **Text input methods.** Dictation and CJK input in xterm's hidden textarea have open
  iOS 26 bugs. The compose field is the safe path; send dictation there by default.
- **No haptics on the web.** `navigator.vibrate` isn't supported on iOS. Haptics on
  key-row taps are a reason to prefer the native wrapper if it's built.
- **Sign in inside the installed app.** A home-screen app has its own cookies, separate
  from Safari's. Do passkey registration inside it.
- **Fat-finger protection.** Kill session already confirms. Also confirm Ctrl+C or
  Ctrl+D sent while the ctrl key is locked, or show a clear locked state.

## 3. Security

- **Header trust is weak locally, but that isn't the real threat.** Any process on
  the box can reach 127.0.0.1 and fake `Tailscale-User-Login`, but those processes
  already run as you and can drive tmux directly. The real gaps are remote:
  - **Enrolment:** if passkey registration trusts headers, a local agent (or anyone
    who reaches the port before you enrol) can register its own passkey. Make
    `tether passkey enroll` print a one-time code or link that registration requires.
  - **Whois:** the X-Forwarded-For whois cross-check is also derived from headers.
    Drop it or treat it as advisory.
- **One check on every route.** The passkey session must protect the WebSocket, every
  `/fs` route and the scratch shell through a single middleware. One unprotected
  route is remote code execution.
- **Rendered content is untrusted.** Markdown and Mermaid in the file viewer come
  from repos and agent output. Use DOMPurify, Mermaid's `securityLevel: "strict"`,
  and a CSP with no inline script.
- **Don't log terminal contents.** Output often contains secrets.

## 4. Long-term decisions to make early

- **Multi-host (v2) collides with how the web app and passkeys work.** Each
  `*.ts.net` host is a separate origin: its own installed app, cookies and passkey.
  Either one hub daemon proxies other hosts (one app, one passkey), or each host gets
  its own app. Decide before the auth and URL design is fixed; the hub is the likely
  answer.
- **Version skew.** The service worker can serve an old UI against a new daemon. Put a
  protocol version in the handshake and force a reload on mismatch, from day one.
- **tmux versions.** The server runs 3.4 and the Mac 3.7b. Keep recorded `%output`
  fixtures from both and gate features on version (libtmux-rs tests 3.2a–3.7b).
- **Config compatibility.** Ignore unknown TOML keys so older daemons read newer configs.
- **Native wrapper.** If it's built, `typeshare` can generate Swift types as well as
  TypeScript; that's the reason to pick it over ts-rs.
- **repo-viewer parity.** Before archiving repo-viewer: Mermaid, the folder image
  gallery, the always-hidden/show-hidden rules, and gitignore handling. Decide whether
  file write operations stay in scope, given repo-viewer was read-only on purpose.
- **Meridian.** The only link is a CLI command (`tether notify`). Keep it that way.

## 5. Code structure

One crate to start; split only when a part starts changing on its own.

```
src/tmux/      control-mode parser (pure: bytes in, events out), command/reply
               matching, snapshot hand-off, one task per control client
src/hub/       viewers per pane, sequence numbers, ring buffers, when to snapshot
src/proto/     wire messages (source of the TS types), version handshake
src/http/      axum routes, WebSocket upgrade, embedded assets, auth middleware
src/auth/      LocalAPI identity, WebAuthn, session cookie, enrolment code
src/fs/        the only place paths are resolved and checked against roots;
               list, raw (Range), upload, trash
src/complete/  history, PATH index, carapace runner (bounded, cached)
src/scratch/   pty shells
web/           Vite app, built into the binary:
  input/       the one module that owns focus and the keyboard
  term/        xterm.js wrapper; touch to keys/mouse translation
  tabs/        per-tab connection state machine
  sheets/ fs/
```

Rules: `hub/` never sees HTTP, and `http/` never talks to tmux. Keep the terminal
renderer behind `term/` so ghostty-web can be swapped in later.

## 6. Coding style

- **Match mars-agents:** edition 2024, clap derive, serde + toml, thiserror,
  write-to-temp-then-rename, an AGENTS.md per module.
- **Tasks that own state.** Each control client and each WebSocket is a task with
  its own state and bounded queues between them, no shared `Arc<Mutex<…>>` maps.
  The rule for dropping frames and falling back to a snapshot lives in one place.
- **TasksMax=32 conflicts with tokio's blocking pool**, which can grow to 512 threads
  and is used by file I/O and process spawning. Set `max_blocking_threads`, or thread
  and process creation fails under load.
- **The `%output` decoder works on bytes, not strings.** Pane output can be invalid
  UTF-8, and only control bytes and backslashes are escaped.
- `#![forbid(unsafe_code)]`, no `unwrap` in daemon paths, and a task that panics
  surfaces as an error rather than a silently dead tab.
- **Protocol types defined once in Rust** and generated for TypeScript. Terminal
  output goes in binary WebSocket frames, control messages as JSON.
- **Frontend:** every tappable element uses one shared component that cancels the
  pointerdown default; a lint rule bans raw `<button>` and `<input>` elsewhere. Tab
  state is an explicit state machine, not flags. TypeScript strict.
- **Tests:** recorded `%output` fixtures for the parser and snapshot hand-off, plus a
  manual checklist on the phone. Playwright's WebKit doesn't reproduce the iOS
  keyboard.

## 7. Libraries

| Area | Pick | Note |
|---|---|---|
| HTTP | axum 0.8, tower-http 0.7 | Keep a custom `/fs/raw` for root checks |
| Assets | rust-embed 8 | |
| Passkeys | webauthn-rs 0.5.5 + @simplewebauthn/browser 14 | Missing from the plan. webauthn-rs is MPL-2.0 |
| Tailscale | Own ~100-line client over the tailscaled unix socket (hyper) | Wrapper crates are small, single-maintainer projects |
| systemd | sd-notify, tracing (+ optional tracing-journald) | |
| TS types | ts-rs (typeshare if a native Swift client happens) | |
| tmux parser | Hand-written, after reading libtmux-rs and tmuxctl | libtmux-rs is alpha, by Tony Narlock (libtmux's author) |
| Server emulator | None for MVP; vt100 0.18 if needed later | alacritty_terminal is too heavy |
| Renderer | xterm.js 6 + webgl, search, web-links, serialize, unicode11 | ghostty-web 0.4 is worth a spike for Unicode |
| App shell | Preact 11 | Svelte 5 only if it's faster for you |
| File viewer | markdown-it + DOMPurify, Shiki loaded on demand, Mermaid strict and on demand | |
| Completion | carapace-bin 1.8, pinned; parse its JSON loosely | Its output format has no stability promise |

## 8. Spike list additions

Add to §7.4: (a) the snapshot hand-off with output streaming at full speed; (b)
passkey registration and sign-in inside the installed app on the real `*.ts.net`
host; (c) WebSocket recovery after 10+ minutes locked; (d) WebGL context loss after
backgrounding; (e) keyboard open/close without resizing tmux.
