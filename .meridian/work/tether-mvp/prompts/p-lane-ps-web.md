# Lane PS-web: the phone side of "window size follows the client that acted last"

Build PS-web exactly as specified: `.meridian/work/tether-mvp/build-plan.md` (PS-web lane text, including the hand-off notes added after the daemon review), `.meridian/work/tether-mvp/design/client-architecture.md` §2, §5.4, §8.2 (and wherever "Sized for another terminal" / claim appear), `docs/design/client/browser-behaviors.md`, `docs/design/daemon-core.md` §3.6–3.7 (claims), decisions.md "Window size follows the client that acted last". Daemon side is committed (7073a33): `watch` accepts `claim` (default true).

Summary (docs win): the pane is drawn at tmux's size at the phone's own font (never scaled); larger than the tab: pinned left, clipped right, no horizontal pan, taller rows via the existing cursor pan, top-anchored while in history; the DOM renderer instead of WebGL while larger; after 1 s larger, the status band "Sized for another terminal" with **Fit** (Fit re-sends `resize`, which claims); smaller: drawn top-left, no band. Automatic re-watches (reconnect, retry) send `watch { claim: false }` unless the tab held the window when its watch ended; a re-watch must NOT be followed by an automatic `resize`. User acts claim (bringing the tab on screen, input, paste, Fit). Rename `TerminalSizer.claim()` (and its `.context` mention) so "claim" means one thing. User-visible CHANGELOG bullet for the whole feature (reword the daemon bullet into one user-facing line if cleaner).

P3a just landed (2a5c401): the dock, `--keyboard-inset`, the pan area in `Dock.tsx` (reads the lifted row's rect), `touch/`, `TerminalScreen.tsx`. Build on it; P3b (gestures, selection) comes after you.

## Verify
- Playwright (spec-named): the band appears after 1 s and Fit restores the phone size; both pane shapes (wider+taller, smaller) render and the cursor pan works; a reconnect doesn't claim. Use a real daemon on scratch tmux 3.4 and 3.7b (`/tmp/tether-meridian-501/tmux/{3.4,3.7b}/bin/tmux`, isolated `-L`) with a second tmux client (a pty "laptop" — see tests/support/tmux_server.rs / the real sizing test for how) that types to take the window: the phone shows the larger pane + band; Fit takes it back; a reconnect leaves the laptop's size.
- Add to `$MERIDIAN_ACTIVE_WORK_DIR/g3-iphone-checklist.md`: a 250×70 laptop window on the phone renders and scrolls, Web Content memory noted (Settings › … or Safari Web Inspector), plus Fit.
- `scripts/preflight.sh full`. Don't commit; report files, spec → implementation, verification, divergences.
Spawn env TMPDIR=/tmp/tether-meridian-501.
