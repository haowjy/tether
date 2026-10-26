# Keyboard-up hides the bottom of terminal TUIs

## Finding

There are two distinct causes in the current design/path, and either can leave the lower part of a TUI hidden:

1. **The pan anchor is `cursorY`, not the session's bottom.** This is the direct failure for TUIs that park their cursor above their input/status/footer rows. `cursorPan` moves the terminal until the cursor row's bottom reaches the pan area's bottom; rows after the cursor are necessarily pushed below that edge. This is expected by the current mechanism, even if `panArea` is correct.
2. **The pan area can be stale across the native keyboard resize.** Native changes `visibleHeight` while keeping `keyboardInset: 0`. `Dock` computes pan area from actual geometry, but its effect is keyed to `keyboardInset` rather than the native geometry that changes. The observed `<div>` is only the key-row strip; a change in its position when the web view shrinks does not itself resize that strip. So the first update (from showing the key row) can calculate the pre-resize geometry and not be recalculated after the web view moves its bottom edge. xterm's resize observer calls `pan` on the terminal-container resize, but that call consumes the previously stored pan area. This can leave the cursor aligned below the now-visible region / behind the dock.

These are independent: refreshing the pan area fixes stale geometry but cannot show lines beneath a parked cursor. Anchoring to the session bottom fixes that TUI case but does not fix a stale visible-area measurement.

## Causal chain and excerpts

- The spec calls for keeping tmux at its resting size and panning the cursor row into view: `docs/design/plan.md:347-349`; `docs/design/ios-shell.md` “The pan” and sizing bullet (web view shrinks; terminal slides). The terminal sizing code likewise sizes from `stableHeight` (`web/term/size.ts:42-49`).
- On keyboard frame change, native adjusts the web view bottom constraint, lays out, then publishes a viewport after animation (`ios/Tether/Web/WebShellController.swift:488-500`). `viewport()` reports `visibleHeight` from the resized web view, leaves `keyboardInset` at zero, and sets `keyboard` from the difference (`ios/Tether/Web/WebShellController.swift:465-485`). Thus native's viewport message *does* report the resize; it does not encode the keyboard height as `keyboardInset`.
- `Dock` calculates pan area from the dock row, key-row strip and terminal geometry (`web/screens/terminal/dock/Dock.tsx:68-85`), but its effect rerun conditions are `[active, viewport.keyboardInset, terminals]` (`Dock.tsx:93`). It observes the strip's size only (`Dock.tsx:87-88`), not its position or the web view. Native geometry changes with `keyboardInset` unchanged. Key-row appearance can trigger the observer once, but that is before/independent of the ensuing native height transition.
- xterm reads `panArea` when calculating the cursor pan and falls back to `container.clientHeight` if no pan area was set (`web/term/xterm.ts:97-105`). Its `ResizeObserver` watches the terminal container and calls `pan`, but does not recalculate the Dock's area (`xterm.ts:121-122`). This distinguishes “pan was invoked” from “pan used the post-resize visible area.”
- The anchor rule is explicit: `cursorPan` computes overflow and clamps the translation so `(cursorRow + 1) * cellHeight` reaches the bottom of `visible` (`web/term/size.ts:27-37`). For example, in a 50-row screen with 30 rows visible, cursor row 46 requires 17 rows of translation, and rows 47–49 remain below the visible edge. A TUI can draw its input/status rows there while parking the actual terminal cursor in an earlier input box.
- `.meridian/work/tether-mvp/keyboard-gap.md` describes the earlier blank-space bug as a competing ownership of keyboard geometry and records the app/device verification limitation after that fix. This investigation finds the inverse boundary issue: native correctly reports a resized web view, but the web pan-area refresh is not keyed to that changed geometry.

## Reproduction / confidence

The source path was traced. A runtime reproduction on the iOS app or browser against a private `tmux -L` socket was **not completed**, so the geometry failure above is a code-backed diagnosis, not an observed live-device confirmation. The prober inspected the app path and confirmed that keyboard resize publishes viewport geometry and xterm's observer invokes pan, but was unable to inject taps/keyboard input in Simulator or drive the paired device from this shell. No default tmux socket or personal session was used. No scratch source or test was left behind.

The TUI cursor-anchor case follows directly from the pure `cursorPan` formula and can be calculated deterministically; the 50/30/46 example above is illustrative, not an app runtime trace.

## Candidate resolutions and tradeoffs (not applied)

- **Refresh pan area when the native visible geometry changes** (e.g. make the Dock pan-area update respond to the relevant viewport geometry/state, and verify it samples geometry after layout). This preserves the specified “tmux does not resize” contract and repairs stale area; it does not reveal footer rows below a parked cursor. A layout callback tied only to keyboardInset is insufficient for the app, where that value intentionally remains zero.
- **Use a bottom-oriented pan anchor when the cursor is not the bottom-most visible content** (e.g. keep terminal bottom at visible edge while the keyboard is up). This reveals TUI footer/status lines but may push a real cursor near the top off-screen and may change the behavior expected by shell users; cursor follow vs bottom follow needs a deliberate rule. An app-specific/custom cursor hint is more precise but adds a protocol/state mechanism and TUIs may not expose a useful hint.
- **Resize the PTY/tmux to the keyboard-visible rows instead of panning.** This naturally lets TUIs reflow/redraw their input and status areas, but directly violates the current spec, changes remote session dimensions on keyboard open/close, and incurs the tmux resize/reflow behavior the spec explicitly avoids.

## Other clients checked

Quick external-documentation check was inconclusive: Blink's official quick-start discusses pinch-to-size and Smart Keys, not keyboard-triggered PTY resize vs pan ([Blink docs](https://docs.blink.sh/)); available Termius material described extended keyboard controls, not PTY sizing, and was a third-party repository ([Termius extended-keyboard page](https://github.com/ToTheHighestTopMoon/Termius-Documentation/blob/master/ios/features/extended_keyboard.md)). No claim about either app's strategy is supported by this check.
