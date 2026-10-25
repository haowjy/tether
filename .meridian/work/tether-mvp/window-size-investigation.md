# Window-size reclaim investigation

## Finding

The isolated browser path works: Chromium at 2000x970 sends a `watch` size of
274x53 and later sends the browser-typed command as `input` on the same watch
(p218 observations, tmux 3.4 and 3.7b). The tmux window is 80x23 after an
80x24 PTY attaches/acts, and remains 80x23 after browser input.

This outcome follows the implemented and documented policy, rather than a
clipped-element sizer or a claim message missing from the web. The sizer uses
the stable viewport and measured chrome (`web/term/size.ts:40-48`,
`web/screens/terminal/terminals.ts:356-368`). The web sends `input`
(`web/tabs/driver.ts:137-142`); the hub claims that watch
(`src/hub/requests.rs:246-264`) and reconciles its size to a tmux per-window
vote (`src/hub/reconcile.rs:61-76,236-253`,
`src/tmux/command.rs:92-96`). The vote is a cap under `window-size latest`,
not a command to make the control client latest or to force the window to the
browser's larger size. The current daemon spec explicitly says this
(`docs/design/daemon-core.md:480-489,522-524`).

The missing band is also current behavior: `TabDriver.checkLarger()` only
sets `sizedForOther` when the tmux pane exceeds the browser's sent size
(`web/tabs/driver.ts:329-335`); `TerminalScreen` then shows Fit
(`web/screens/terminal/TerminalScreen.tsx:88-90`). In the repro the pane is
smaller than the browser's 274x53, so no band is expected by that rule.

## Why existing tests missed this exact scenario

- `tests/tmux_real.rs:1078-1148` documents and verifies a 60x20 tether vote
  capped by a 200x50 PTY and its yield. It does not assert a larger tether
  size can override a smaller latest PTY; the documented behavior says it
  cannot.
- `web/e2e/terminal/terminal.real.ts:258-285` uses a smaller browser fixture
  and a larger 250x70 laptop; Fit takes the window back within that cap.
- `terminal.real.ts:309-335` similarly reconnects from a 250x70 laptop and
  checks that typing returns to the browser's smaller `phone` size. It never
  tests a browser larger than the latest PTY.

## Decision / unresolved mismatch

The requested expectation (“input makes tmux exactly the browser size; show
Fit whenever sizes differ”) conflicts with the current design's explicit
per-dimension cap and larger-pane-only band. A direct `resize-window` could
force a 274x53 window, but tmux 3.4 reports that this changes the window's
`window-size` option to `manual`; it must be actively restored to `latest` on
yield. A tether crash could leave manual sizing behind, violating the project
invariant that tmux remains the source of truth. No source fix was made; the
policy and its lifecycle need an explicit design decision before replacing
the ephemeral vote mechanism.

## Verification

- Custom real-daemon Chromium probe: reproduced on tmux 3.4 and 3.7b at
  2000x970 with an 80x24 PTY. Evidence: `p218/3.4-observations.json`,
  `p218/3.7b-observations.json`.
- `cargo test`, `cargo clippy --all-targets -- -D warnings`,
  `pnpm --dir web run check`: passed.
- Real E2E suites exercised both tmux versions and Chromium/WebKit. Relevant
  terminal behaviors passed, but the full `e2e:real` run had 4 unrelated
  failures: two 60-second history-wheel timeouts and two WebKit drag-resize
  assertion failures. The isolated `terminal.real.ts` run had 45 pass, with
  unrelated WebKit drag-resize and session-limit retry timeouts (5 not run).
  The first full run also hit the documented macOS socket-path limit because
  the default temp path was too long; rerunning with
  `TMPDIR=/tmp/tether-meridian-501` avoided those failures. Harness terminal
  routes: 64 passed in Chromium/WebKit. The full harness run had module-load
  errors (`ReferenceError: Can't find variable: useApp`) under concurrent
  load; the targeted terminal route run was clean.
