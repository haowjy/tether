# Tether plan Rust crate research

Research date: 2026-10-21 ET. No project files changed.

## Summary decision

- `vt100`: best first screen-model dependency for a small daemon. Pure parser + in-memory screen, small package, simple feed/snapshot API. Pin exact 0.18.1 and keep a fixture suite; 0.x API and recent rapid releases mean upgrades need review.
- `alacritty_terminal`: technically stronger terminal model and active upstream, but a much larger/heavier dependency and API surface. Keep as a fallback only if real TUIs expose vt100 fidelity gaps.
- `portable-pty`: reasonable only for the optional scratch-shell/fallback PTY path; do not use it for the control-mode bridge. Stable-ish, well-used upstream, but release cadence follows WezTerm and the crate is embedded in that monorepo.
- Reusable tmux parser: `tmuxctl` is the closest fit and is lightweight, but pre-1.0/young/0-star. `libtmux` is more featureful and actively developed but explicitly alpha and “not recommended for production”; `tmux-cmc` is small but incomplete; `par-term-emu-core-rust` contains a parser but is far too broad for a small daemon. A small in-tree parser remains the lowest dependency/risk path, or use `tmuxctl` only after reviewing/forking/pinning and adding 3.4 fixtures.

## Primary crate facts

### vt100

- Registry/docs latest: **0.18.1**, released **2026-10-19**. Docs.rs lists 0.18.0 and 0.18.1 on the same date, after 0.17.0 on 2026-10-18. [docs.rs crate page](https://docs.rs/crate/vt100/latest) [crates.io](https://crates.io/crates/vt100)
- Repository/ownership: [doy/vt100-rust](https://github.com/doy/vt100-rust), Cargo author **Jesse Luehrs <doy@tozt.net>**, MIT. GitHub showed 123 stars, 64 forks, 460 commits, 4 open issues, and 2 PRs at research time. [Cargo.toml](https://raw.githubusercontent.com/doy/vt100-rust/main/Cargo.toml) [GitHub](https://github.com/doy/vt100-rust)
- Activity: healthy recent release burst (0.16.0/1/2 in July 2025, 0.17.0 on Oct 18 2026, 0.18.0/1 on Oct 19 2026), although there was a long quiet period before 2025. The recent activity is real, but small single-owner project/bus factor remains a caveat.
- API shape: `Parser::new(rows, cols, scrollback_capacity)`, `Parser::process(&[u8])`, `Parser::screen()`, `Parser::screen_mut()`, `Parser::set_size`; optional callbacks via `new_with_callbacks`. `Screen` exposes cells, plain/formatted rows, cursor/modes, alternate-screen state, scrollback and `contents_diff`/`state_diff`. [Parser docs](https://docs.rs/vt100/latest/vt100/struct.Parser.html) [Screen docs](https://docs.rs/vt100/latest/vt100/struct.Screen.html)
- Fit: **yes** for the plan's lazy per-pane screen model. The public API exactly matches “feed decoded tmux bytes, snapshot screen, diff state”; current package is ~198 KB and has only itoa/unicode-width/vte runtime dependencies. It is synchronous/pure and does not create threads/runtime. Watch-outs: 0.x upgrades; terminal-fidelity/Unicode edge cases (for example an open upstream-related emoji-width issue was reported in psmux, citing an upstream vt100 fix as open/unreviewed). [current Cargo.toml](https://raw.githubusercontent.com/doy/vt100-rust/main/Cargo.toml) [issue reference](https://github.com/psmux/psmux/issues/533)

### alacritty_terminal

- Registry/docs latest: **0.26.0**, released **2026-04-06**. The upstream repository is already at **0.26.1-dev**. [docs.rs crate page](https://docs.rs/crate/alacritty_terminal/latest) [crates.io](https://crates.io/crates/alacritty_terminal) [upstream Cargo.toml](https://raw.githubusercontent.com/alacritty/alacritty/master/alacritty_terminal/Cargo.toml)
- Repository/ownership: [alacritty/alacritty](https://github.com/alacritty/alacritty), Cargo authors **Christian Duerr** and **Joe Wilm**, Apache-2.0. The repo is a large active project (about 66k stars, 3.7k forks, 2,495 commits, 329 issues, 14 PRs at research time). [Cargo.toml](https://raw.githubusercontent.com/alacritty/alacritty/master/alacritty_terminal/Cargo.toml) [GitHub](https://github.com/alacritty/alacritty)
- Activity: strong and ongoing. The crate changelog has a 0.26.1-dev section with fixes; 0.26.0 changed `ChildEvent::Exited`/`Event::ChildExit` to carry `ExitStatus`, so it is not a frozen compatibility surface. [crate changelog](https://raw.githubusercontent.com/alacritty/alacritty/master/alacritty_terminal/CHANGELOG.md)
- API shape: `Term<T>::new(Config, &Dimensions, event_proxy)`, `Term` implements the `vte::ansi::Handler`; feed bytes through `vte::ansi::Processor`; inspect/resize the `Grid` via `grid`, `grid_mut`, `renderable_content`, `resize`, selection/search APIs. `EventListener` receives events such as `PtyWrite`, title/clipboard requests, wakeup and child exit. [Term docs](https://docs.rs/alacritty_terminal/latest/alacritty_terminal/term/struct.Term.html) [Grid docs](https://docs.rs/alacritty_terminal/latest/alacritty_terminal/grid/struct.Grid.html) [upstream event API](https://github.com/alacritty/alacritty/blob/master/alacritty_terminal/src/event.rs)
- Fit: **conditionally**. It can be used headless (no GUI required; `Term<VoidListener>` + `vte::ansi::Processor` is the useful pattern), and it offers richer grid/scrollback/search/fidelity. However docs.rs reports a 47.6 MB source package and 6.3 MB generated docs, with a materially larger dependency set; the API is coupled to Alacritty’s `Config`/`EventListener`/`Grid` abstractions and changes with the terminal application. That is a poor default for a memory-constrained small daemon, but a good escalation if Claude/Codex/TUI output is visibly wrong under vt100. [headless usage example](https://docs.rs/fno-agents/latest/fno_agents/screen/index.html)

### portable-pty

- Registry/docs latest: **0.9.0**, released **2025-02-11**. Prior releases: 0.8.1 (2023-03-13), 0.8.0 (2023-02-17). [docs.rs crate page](https://docs.rs/crate/portable-pty/latest) [crates.io](https://crates.io/crates/portable-pty)
- Repository/ownership: source lives at `pty/` in [wezterm/wezterm](https://github.com/wezterm/wezterm), author **Wez Furlong**, MIT; docs explicitly say it is part of the WezTerm monorepo. The parent project is highly active/large (about 29.3k stars, 1.8k forks, 8,718 commits). [crate Cargo.toml](https://raw.githubusercontent.com/wezterm/wezterm/main/pty/Cargo.toml) [docs.rs metadata](https://docs.rs/crate/portable-pty/latest)
- Activity: the published crate has had no release since Feb 2025, but its parent WezTerm repository is active and the PTY source remains in the main workspace. Treat release cadence as upstream-monorepo-driven, not as an independently governed crate. A separate patched fork exists in the ecosystem because upstream is not a standalone repository; avoid depending on that unless Windows ConPTY behavior is a requirement.
- API shape: `native_pty_system().openpty(PtySize)` returns `PtyPair { master, slave }`; `slave.spawn_command(CommandBuilder)` starts a child; `MasterPty::try_clone_reader`, `take_writer`, `resize`, `get_size` provide I/O and resize; child traits provide wait/kill. [PtySystem](https://docs.rs/portable-pty/latest/portable_pty/trait.PtySystem.html) [MasterPty](https://docs.rs/portable-pty/latest/portable_pty/trait.MasterPty.html) [PtyPair](https://docs.rs/portable-pty/latest/portable_pty/struct.PtyPair.html)
- Fit: **yes, narrowly** for optional scratch shells/raw-PTY fallback. It is cross-platform and its trait-object split is straightforward, but I/O is blocking `Read`/`Write` handles rather than Tokio-native async; put reads/writes behind dedicated blocking tasks/threads. It is unnecessary for the primary tmux control-mode path and adds platform/PTY lifecycle complexity to the small daemon.

## Reusable Rust tmux control-mode parser candidates

### tmuxctl — strongest direct candidate, still pre-1.0

- Registry/docs latest: **0.1.0**, released **2026-06-19**. [docs.rs crate page](https://docs.rs/crate/tmuxctl/latest) [crates.io](https://crates.io/crates/tmuxctl). Note a stale contradiction: the docs.rs rendered description still says “Not yet published to crates.io”, while the repository README says “Published to crates.io (`v0.1.0`)” and the docs.rs version table exposes 0.1.0; verify the registry page before pinning.
- Repository/ownership/activity: [ace-rs/tmuxctl](https://github.com/ace-rs/tmuxctl); repo manifest says MIT OR Apache-2.0, Rust 1.96, 63 commits, 0 stars/forks. No named maintainer/team was visible in the public metadata beyond the `ace-rs` repository/org. [Cargo.toml](https://raw.githubusercontent.com/ace-rs/tmuxctl/main/Cargo.toml) [GitHub](https://github.com/ace-rs/tmuxctl)
- API: a sans-IO `Engine::feed(&[u8]) -> Incoming`, `Parser`/`Reply`, typed `Notification`, `Client`; correlates `%begin/%end/%error` replies, octal-decodes `%output`/`%extended-output`, parses layout strings, and exposes feature-gated blocking, Tokio and smol drivers. `decode_output` explicitly preserves raw bytes and says decoding precedes VT emulation. [README](https://raw.githubusercontent.com/ace-rs/tmuxctl/main/README.md) [decode_output](https://docs.rs/tmuxctl/latest/tmuxctl/fn.decode_output.html)
- Fit: **good dependency shape, weak maturity signal**. It is the only direct candidate found that is intentionally protocol-only, feature-gated, and already has the exact parser/correlation/unescape responsibilities. But it is a young 0.1/0-star project, locks versioning to one pinned tmux without per-version gating, and has no visible downstream ecosystem. For production: pin exact, audit against tmux 3.4 transcripts, fuzz malformed/partial lines, and be prepared to vendor/fork. It is reasonable for a small daemon only after that review.

### libtmux-rs — featureful but explicitly alpha

- Version conflict to record: docs.rs API is **0.1.0-alpha.15**; GitHub release listing shows `libtmux` alpha.15 released **2026-09-28**. The current repository README/install text says **0.1.0-alpha.16**, and the current docs site has alpha.16-related packages/revisions, but the registry/docs evidence I could verify still resolves to alpha.15. Treat alpha.16 as repository/source-head information until the registry page is checked at implementation time. [docs.rs control API](https://docs.rs/libtmux/latest/libtmux/control/index.html) [GitHub releases](https://github.com/libtmux/libtmux-rs/releases) [repo README](https://github.com/libtmux/libtmux-rs) [control guide](https://libtmux.org/en/rs/latest/guides/control-mode/)
- Repository/ownership/activity: [libtmux/libtmux-rs](https://github.com/libtmux/libtmux-rs), Apache-2.0/MIT, about 902 commits, 1 star, 9 open PRs, 1 issue at research time. The README explicitly says alpha, API may change/remove identifiers without deprecation, and “not recommended for production.” [GitHub repo](https://github.com/libtmux/libtmux-rs)
- API: optional `control-mode` feature; `ControlMode::attach(server, id).await?.split()` gives a `ControlSender` and event stream; `ControlSender::send`, `subscribe`, `pause_after`, `resume_pane`, `watch_only`; events include `Output`, `Exit` and other notifications. It also has typed server/session/window/pane APIs, compatibility testing against tmux 3.2a, 3.4, 3.5a, 3.6b, 3.7b, and configurable control/output limits. [module docs](https://docs.rs/libtmux/latest/libtmux/control/index.html) [latest guide](https://libtmux.org/en/rs/latest/guides/control-mode/) [API overview](https://docs.rs/libtmux/latest/libtmux/)
- Fit: **not for MVP production dependency** despite excellent feature alignment. It is broader than a parser and explicitly unstable. It is worth studying for control-mode semantics, limits and tests; revisit once stable or use a pinned fork if the typed API saves enough implementation time.

### tmux-cmc — small synchronous client, incomplete for tether

- Version/release: GitHub README advertises dependency version **0.1**; I found no independently indexed crates.io/docs.rs release page with a release date, so registry status/date is **unverified**. [GitHub repo](https://github.com/ArcavenAE/tmux-cmc)
- Ownership/activity: [ArcavenAE/tmux-cmc](https://github.com/ArcavenAE/tmux-cmc), MIT, 56 commits, 1 star, 2 forks, 1 issue and 2 PRs shown by GitHub. The README says it was built for forestage/marvel, tested on macOS tmux 3.6a and Linux aarch64 tmux 3.5a.
- API: synchronous `Client::connect`, cloned `Client` over `Arc`, writer thread + reader thread, serial-correlated command replies, typed session/window/pane management and notification stream. Explicitly not implemented: `list-sessions`, `list-panes`, reconnection on tmux exit, async feature. [README](https://github.com/ArcavenAE/tmux-cmc)
- Fit: **no for the planned Tokio daemon without substantial adaptation**. It is a useful reference or a possible fork for a tiny synchronous tool, but missing list APIs and reconnect are central to tether; thread/channel lifecycle and “drop kills tmux child” semantics also need review.

### par-term-emu-core-rust — parser exists, dependency too broad

- Registry/docs latest: **0.62.0**, released **2026-10-19**. [docs.rs crate page](https://docs.rs/crate/par-term-emu-core-rust/latest) [crates.io](https://crates.io/crates/par-term-emu-core-rust)
- Repository/ownership/activity: [paulrobello/par-term-emu-core-rust](https://github.com/paulrobello/par-term-emu-core-rust), author/owner **Paul Robello**, MIT; 1,872 commits, 16 stars, 3 forks, 2 PRs. [GitHub](https://github.com/paulrobello/par-term-emu-core-rust) [Cargo.toml](https://raw.githubusercontent.com/paulrobello/par-term-emu-core-rust/main/Cargo.toml)
- API: `tmux_control` module documents `TmuxControlParser` and `TmuxNotification`; parses `%begin/%end/%error`, async `%` notifications, and `%output %pane-id data`. The crate also contains a comprehensive VT100–VT520 emulator, PTY, Sixel/iTerm2/Kitty graphics, Python bindings, streaming server and mux workspace. [tmux control module](https://docs.rs/par-term-emu-core-rust/latest/par_term_emu_core_rust/tmux_control/index.html)
- Fit: **no as a direct small-daemon dependency**. It is active and the parser is reusable in principle, but the 0.62 package is ~3.7 MB and the workspace/default feature model is broad; current source manifest shows Python as default plus many optional streaming/graphics/security/PTY trees. Consider only extracting/auditing the parser or using it if the daemon also needs its full terminal stack.

## Other search results not recommended as parser dependencies

- `tmux_interface` 0.4.0 (2026-03-10) is a CLI wrapper that starts tmux processes per command, not a persistent control-mode parser. [docs.rs](https://docs.rs/crate/tmux_interface/latest)
- `muster` 0.5.6 (2026-05-05) includes `StreamParser`/control-mode events but is a higher-level session/profile manager; its docs say “Not accepting public PRs.” [docs.rs](https://docs.rs/crate/muster/latest)
- `tmux-client` 0.1.0-alpha.1 (2026-09-01) is a typed async client/port of Python libtmux; it is alpha and not the focused parser layer. [docs.rs](https://docs.rs/crate/tmux-client/latest)

## Recommended tether plan adjustment

1. Keep `vt100` first; pin `=0.18.1` for the spike and build a screen fixture suite from real tmux 3.4 `%output` captures.
2. Make the tmux bridge a seam independent of the emulator. Evaluate `tmuxctl` as the first external parser candidate, but do not let its pre-1.0 types define the daemon protocol; own a small adapter and retain a fallback in-tree parser plan.
3. Use `portable-pty` only behind the scratch/raw-PTY feature, with blocking I/O isolated from Tokio.
4. Do not pull `alacritty_terminal` or par-term by default. Benchmark/compare only if vt100 fails real Claude/Codex/TUI fixtures; expect API and resource cost.
5. Before depending on any parser crate, run a real tmux 3.4 compatibility probe covering partial reads, octal escaping, interleaved replies/notifications, `%extended-output`, `%begin/%end/%error`, pane/window/session events, and flow-control commands.
