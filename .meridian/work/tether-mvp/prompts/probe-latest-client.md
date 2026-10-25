# Probe: can tether's control client become tmux's "latest" client?

Context: `.meridian/work/tether-mvp/window-size-investigation.md` (p216). tether sizes a
window with `refresh-client -C '@<window>:<cols>x<rows>'` from its control-mode client.
Under `window-size latest`, tmux sizes a window to the client with the latest activity;
tether's commands don't count as activity, so a smaller laptop PTY that typed last caps
tether's larger request (window stays 80x23 while tether asks 274x53). Jimmy wants typing
in tether to take the window to tether's size, and typing on the laptop to take it back.
`resize-window` works but flips the window's `window-size` option to `manual`
(crash leaves it stuck) — not wanted.

## Question
Is there a supported way for tether's control client to become the window's latest
client (so its per-window `refresh-client -C` size applies), on tmux 3.4, 3.7b and 3.8?
Candidates to test, plus any you find in tmux source (server-client.c
`server_client_update_latest`, `window->latest`, resize.c `recalculate_size`, cmd-send-keys.c,
cmd-refresh-client.c; tags 3.4, 3.7b):
1. `send-keys -K -c <control-client> ...` (does 3.4 have -K? does it set latest? it goes
   through key tables: what happens with the prefix key, and with plain text, UTF-8,
   pasted text, special keys? does it reach the pane as typed input?)
2. Any command from the control client that updates `window->latest` / client activity
   (refresh-client variants, select-window/switch-client with -c, display-message -c ...).
3. Whether `window-size latest` considers control clients at all, and how it combines
   with their per-window size.
For each: does the window go to tether's size after tether acts, and back to the PTY's
after the PTY types? Any side effects (pane input altered, key bindings fired, client
flags, the laptop's view)?

## How
Isolated servers only (`tmux -L probe-<spawn id> ...`, binaries at
`~/.cache/tether-tmux/3.4/bin/tmux`, `~/.cache/tether-tmux/3.7b/bin/tmux`, system tmux 3.8);
never the default socket, never homebox. Drive a control client (`tmux -C attach`) from a
script and a PTY client (`script`/python pty) sized 80x24; tether-like client asks 200x50.
Record `#{window_width}x#{window_height}`, `#{client_activity}`, `#{window_active_clients}`
etc. after each step. Read the tmux source for the version differences.

Deliver: a table per version (method -> works? side effects), the source lines that
explain it, the recommended mechanism (or "none exists"), and the exact command shape.
Write the result to `.meridian/work/tether-mvp/latest-client-probe.md`. Clean up every
server and file you create.
