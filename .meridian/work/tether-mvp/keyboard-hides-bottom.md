# Keyboard-up hides the bottom of terminal TUIs

Status: implemented and runtime-verified 2026-10-26.

## Finding

The original read-only trace found two independent causes; runtime verification also exposed a third geometry issue and a tmux-sizing race:

1. **The pan anchor was `cursorY`, not the terminal's bottom.** A TUI that parks its cursor above its input/status/footer rows left those later rows below the visible edge.
2. **The app's pan area could be stale across native keyboard resizing.** Native changes `visibleHeight` while keeping `keyboardInset: 0`; `Dock` watched the strip's size but did not rerun its measurement for the changed viewport height.
3. **Re-measuring used the terminal's transformed top.** Once already panned, `getBoundingClientRect()` included the pan transform; using it as the geometry origin added the existing pan to the new visible height.
4. **The shrinking surface could be mistaken for stable chrome.** A touch-focus request precedes the native viewport update, so a `ResizeObserver` could measure the intermediate smaller surface while the old viewport still said keyboard-down and schedule a tmux resize.

## Resolution

- `terminalBottomPan` anchors the terminal's last row at the visible area's bottom unless
  that would put the cursor row above the area, in which case the cursor row meets the
  bottom instead. It never pans past the last row, does nothing when all rows fit, and
  remains disabled while scrolled into history.
- `Dock` recalculates on `Viewport.visibleHeight` changes, including native messages with
  `keyboardInset: 0`, and measures the terminal's untransformed layout origin.
- Terminal chrome is only remeasured when touch input does not hold the keyboard and the
  visible viewport has returned to its stable height. This prevents an animated web-view
  shrink from changing tmux's keyboard-down size.
- Resizing tmux to keyboard-visible rows remains rejected: each toggle would redraw every
  TUI over a spotty link and resize the laptop's view. Cursor-only anchoring remains
  rejected because it hides harness status lines.

## Causal chain and excerpts

- The spec calls for keeping tmux at its resting size and panning the cursor row into view: `docs/design/plan.md:347-349`; `docs/design/ios-shell.md` “The pan” and sizing bullet (web view shrinks; terminal slides). The terminal sizing code likewise sizes from `stableHeight` (`web/term/size.ts:42-49`).
- On keyboard frame change, native adjusts the web view bottom constraint, lays out, then publishes a viewport after animation (`ios/Tether/Web/WebShellController.swift:488-500`). `viewport()` reports `visibleHeight` from the resized web view, leaves `keyboardInset` at zero, and sets `keyboard` from the difference (`ios/Tether/Web/WebShellController.swift:465-485`). Thus native's viewport message *does* report the resize; it does not encode the keyboard height as `keyboardInset`.
- `Dock` calculates pan area from the dock row, key-row strip and terminal geometry (`web/screens/terminal/dock/Dock.tsx`); the effect now also depends on `viewport.visibleHeight` and measures from the terminal's layout position, not its translated rectangle.
- xterm reads `panArea` when calculating the cursor pan and falls back to `container.clientHeight` if no pan area was set (`web/term/xterm.ts:97-105`). Its `ResizeObserver` watches the terminal container and calls `pan`, but does not recalculate the Dock's area (`xterm.ts:121-122`). This distinguishes “pan was invoked” from “pan used the post-resize visible area.”
- `terminalBottomPan` now puts the last row at the visible area's bottom, unless that would push the cursor above the area's top, then keeps the cursor row at the bottom (`web/term/size.ts`).
- `.meridian/work/tether-mvp/keyboard-gap.md` describes the earlier blank-space bug as a competing ownership of keyboard geometry. Here, native correctly reports a resized web view, but the prior Dock pan-area refresh was not keyed to that changed geometry.

## Reproduction / confidence

Runtime verification used the real daemon and tmux 3.7b on the e2e stack's private
`-L` socket, with a Playwright web client using the native bridge path. It replayed the
native keyboard viewport sequence while shrinking the web view from 852 px to 593 px in
16 frames: `visibleHeight` changed, `keyboardInset` stayed 0, and `keyboard` crossed the
120 px threshold. Every sampled tmux size remained 52×43. Hiding used the reverse sequence
and the 16 sampled sizes also remained 52×43. This is not a direct iOS Simulator or device
run; native frame behavior was represented by page viewport resizes plus
`window.__tether.receive({type: "viewport", ...})`.

The measured keyboard-up state had a 52×43 tmux window, a 43-row TUI box, cursor row 38
(zero-based; N-4 by one-based row number), and status rows 41–42. The visible area was
410 px high; the 688 px terminal panned 278 px, and its last-row bottom matched the area
bottom exactly (0 px delta). After `seq 1 60`, the shell prompt cursor was row 42, the last
tmux row; its bottom also matched the area's bottom (0 px delta). In Vim with cursor row
0, the pan returned to 0 px and the cursor remained visible (row bottom 83 px, area
bottom 477 px). The tmux window stayed 52×43 while the keyboard opened, remained up, and
closed. Screenshots were reviewed and removed with the temporary harness.
Scrolling back into history removed the terminal pan, and Jump to latest restored the
278 px bottom pan.

An earlier runtime attempt before the stable-chrome guard changed tmux from 52×43 to
52×27 on the simulated keyboard resize. The guard prevented that resize in the passing
run. No default tmux socket or personal session was used, and no scratch test or image
was left behind.

## Other clients checked

Quick external-documentation check was inconclusive: Blink's official quick-start discusses pinch-to-size and Smart Keys, not keyboard-triggered PTY resize vs pan ([Blink docs](https://docs.blink.sh/)); available Termius material described extended keyboard controls, not PTY sizing, and was a third-party repository ([Termius extended-keyboard page](https://github.com/ToTheHighestTopMoon/Termius-Documentation/blob/master/ios/features/extended_keyboard.md)). No claim about either app's strategy is supported by this check.
