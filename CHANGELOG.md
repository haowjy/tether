# Changelog

All notable changes to tether are recorded here. CI promotes `[Unreleased]` to a
version section on release.

## [Unreleased]

- Added `tmux::Session`, the pure tmux control client: startup and client size,
  reply matching with the in-flight cap, pausing panes nobody watches, snapshots that
  are retried when a tmux hook tears or changes the pane mid-list, gaps, layouts, cwd
  subscriptions, and typed commands for locate, votes, history, input and paste (a
  failed paste leaves nothing in tmux's buffers). Tested against recorded tmux 3.4
  streams.
- Added the snapshot restore-byte composer (`tmux::snapshot::compose`): bytes that
  rebuild a pane's screen (primary and alternate), cursor, modes, scroll region and
  tab stops in a freshly reset terminal, so clients carry no restore logic.
  `Event::Snapshot` now carries the pane size and these bytes. Checked against
  `vt100` and tmux's own capture on recorded styled, scroll-region and
  alternate-screen panes.
- Added the tmux bridge's I/O: the control-client pump (`tmux::pump`), which moves
  bytes between a `tmux -C` process and the hub and closes it on request, and one-shot
  commands (`tmux::oneshot`) for the session listing, Locate, and new windows and
  sessions, with a 2 s timeout and a "no server" answer. Every invocation passes `-N`
  (never starts a server) and `-u` (names and paths stay UTF-8 whatever the locale).
  Tested against a real tmux with `TETHER_TMUX_TESTS=1`.

## [0.0.1] - 2026-10-22

- Minimum supported Rust version is 1.85 (edition 2024).
- Project scaffold: `tether --version`, CI, and label-driven releases that publish
  static Linux (x86_64, aarch64) and macOS arm64 binaries to GitHub Releases.
