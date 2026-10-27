# Map the iOS shell and daemon against the client redesign

tether is a Rust daemon (`src/`) bridging tmux control mode to a native iOS app (`ios/`)
that hosts a web UI (`web/`). A client redesign is specified, not built. I'm planning it
and need to know what the native shell and the daemon must change.

Read first:
- `docs/design/client/browser-behaviors.md` (Phone dock, Home/Settings, Visual treatment)
- `docs/design/client/terminal-interaction-design.md` (two targets on one native responder;
  key-row routing table: while the line owns focus, ← → move its caret, esc returns to
  the terminal target, the rest go to tmux)
- `docs/design/ios-shell.md`, `docs/design/auth.md` (search "relock" / "Face ID"),
  `docs/design/plan.md` section "Bell attention", `docs/design/daemon-core.md` (search
  "bell"), `.meridian/work/tether-mvp/probe-bell.md`, `ios/AGENTS.md`
- `docs/design/decisions.md` entries dated 2026-10-27

Report, with file paths and line refs:

1. **iOS.** How input target routing works today (the hidden UITextField, terminal vs
   line target, how key-row taps from the web reach native, bridge messages and version).
   What has to change for: esc/←/→ routing while the line owns focus, terminal tap
   returning to the terminal target, appearance (System/Light/Dark, native chrome and
   web agreeing, who owns the preference), Face ID relock setting (5 min / 1 h default /
   At launch) vs today's lock behaviour, clean launch opening Home, Files tabs in the
   active-tab bridge identity. Note bridge fixtures in `ios/TetherKit/Tests/Fixtures/bridge/`.
2. **Daemon.** What exists for bells today (any BEL detection in %output, any hook
   install, alert flags, protocol messages). What the spec says to build: the runtime
   global `alert-bell` hook, marker polling only while a device is connected, how markers
   reach clients, protocol changes. Note anything unspecified (the polling interval is
   known open). Also: does the daemon already provide what the window switch in the
   sessions sheet needs (listing with windows, select-window)?
3. **Contract changes** each would force (protocol version, bridge version, fixture
   updates) and their ordering constraints relative to web changes.

Write nothing in the repo. Facts with paths/lines; mark inference as inference.
