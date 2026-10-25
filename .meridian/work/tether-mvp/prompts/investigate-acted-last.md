# Investigate and fix: tether never reclaims the window size on input

## Symptom (real use, 2026-10-25)
Jimmy uses tether in a desktop browser (~2000px wide viewport, tab "a1 / python") on
pop-os (tmux 3.4, `window-size latest`). The tmux window a1 is also attached from his
other terminals. In the browser the pane renders only ~1020px wide (91 columns),
left-anchored, with the rest of the area empty. Typing/focusing in tether does not
resize the window to the browser ("it doesn't resteal the focus if we focus on it").
No "Sized for another terminal" status band / Fit button is visible.

tmux state at the time (`tmux list-clients` on homebox):
- /dev/pts/1     134x57 a1 attached,focused (older activity)
- /dev/pts/43     91x44 a1 attached,focused (most recent activity)
- client-4009644 (tether control client) width 91, control-mode,pause-after=3
- window a1: 91x43, window_manual_size empty

## Expected (the design)
Window size follows the client that acted last: `docs/design/daemon-core.md` §3.6, §3.7;
`docs/design/client/` + `.meridian/work/tether-mvp/design/client-architecture.md` §5.4;
`docs/design/decisions.md` "Window size follows the client that acted last". Commits
7073a33 (daemon), 2456488 (web). Input in tether claims the window, so tmux sizes it to
tether's viewport; while tmux's size differs from tether's, the band shows with Fit.

## Hypotheses to check (not established)
- The web sizer measures the terminal element after it is drawn at tmux's size (the
  left-anchored, clipped pane), not the available area, so tether always requests what
  tmux already has; that would explain both the 91 columns and the missing band.
- The claim on input/paste never reaches tmux on 3.4 (refresh-client -C per-window form,
  claim bookkeeping in src/hub), or an automatic re-watch with `claim: false` leaves it
  unclaimed and input doesn't claim.
- Something else entirely: follow the evidence.

## How
Reproduce on an isolated stack, never Jimmy's tmux: `web/README.md` "End to end against
a real daemon" (`e2e/shared/stack.ts`, `*.real.ts`, tmux 3.4 at
`~/.cache/tether-tmux/3.4/bin/tmux`, a pty "laptop" client smaller than the browser),
Playwright Chromium and WebKit with a wide viewport (e.g. 2000x970). Watch what the web
sends (watch/resize/input claims) and what tmux does. You may read homebox state over
`ssh homebox` read-only (tmux list-clients/display, tether's log in tmux session f2 via
`tmux capture-pane -p -t f2`), but do not send keys or change anything there.

Fix the root cause in the right layer. Keep the spec accurate in the same change if the
fix changes a rule. Do not commit; the lead commits. Verify with: the reproduction now
passing (browser claims on input, window resizes to the browser, band appears when
another client acted last and disappears on Fit/input), cargo test + clippy,
`pnpm --dir web run check`, the relevant `*.real.ts` and harness e2e on tmux 3.4 and
3.7b. If an existing e2e should have caught this, say why it didn't.

## Report
Causal chain with evidence, the fix, verification by type, and anything left.
