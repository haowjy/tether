# Probe: can tether's control client see another tmux client acting on a window?

tether (a phone client for tmux) is changing its sizing rule to tmux's `window-size latest`
semantics: "whoever acted last gets the window's size". tether's control client can only
size a window with a per-window vote, `refresh-client -C '@W:CxR'`, which tmux applies as a
**cap** whoever is `latest` (resize.c, `clients_calculate_size` clamp loop). So tether must
drop its vote when a normal (pty) client acts on the window, and it must learn that without
polling. The candidate signal is one session-level control-mode subscription whose format
loops over clients:

    refresh-client -B 'act::#{C:#{?client_control_mode,,#{window_id}.#{client_activity}.#{client_width}x#{client_height} }}'

tmux evaluates subscriptions once a second and sends `%subscription-changed` only on change.
`client_activity` is set in `server_client_handle_key` (keys, mouse, focus events), the same
place `server_client_update_latest` runs; attaching sets it from creation time; a terminal
resize (MSG_RESIZE) updates `latest` but not activity, hence the size in the entry.

Answer with evidence on **tmux 3.4 and tmux 3.7b** (both; build from source — a clone with
history is at /tmp/tether-meridian-501/tmuxsrc/src, fetch the tags `3.4` and `3.7b`, build out of
tree under /tmp/tether-meridian-501/<your-spawn-id>/; local Homebrew tmux is 3.8, record it too if cheap).
Use a private `-L` socket per run and kill the server after. Use `TMPDIR=/tmp/tether-meridian-501`.

Setup: session `a` with windows `@0` and `@1`, default options (window-size latest,
aggressive-resize off). A "laptop": a real pty client (drive it through a pty master you
control, e.g. python `pty`/`os.openpty` + `TIOCSWINSZ`, so its keystrokes are real client
input, not `send-keys`), 200x50, current window `@1`. A control client
`tmux -C attach -t a` over pipes that sets `refresh-client -C 200x49` first, as tether does.

Cases (record the exact `%subscription-changed` lines and `display -p -t @N '#{window_width}x#{window_height}'`):
1. The subscription is accepted (the format contains colons) and its first value arrives; its shape.
2. Laptop types a character in `@1` → a change arrives, how long after. Two keys in the same second → one change or two?
3. Laptop switches to `@0` with prefix+n through the pty → change; then back.
4. Laptop terminal resized (TIOCSWINSZ + SIGWINCH) → change?
5. Laptop idle 5 s → no lines.
6. Control client runs `send-keys -t <pane of @1> x` → does the value change? Then with no vote set,
   does `@1` stay laptop-sized (i.e. send-keys did not make the control client `latest`)?
7. Vote `refresh-client -C '@1:60x20'` while the laptop is latest → 60x20; clear `refresh-client -C '@1:'` → back to laptop size.
8. Laptop 200x30, vote `@1:60x45` → expect 60x29 (cap per dimension: the window can't exceed the laptop's rows). Confirm.
9. Vote set on `@1`, laptop types in `@1`, hub then clears the vote → `@1` returns to laptop size (simulating tether's release).
10. A second pty client attaching to `a` → value change (new entry)?
11. Vote on `@0` (not the laptop's current window), clear it → what size does `@0` take?

Write only under /tmp/tether-meridian-501/<your-spawn-id>/. Delete build trees at the end except the
two tmux binaries (keep them at /tmp/tether-meridian-501/tmux-bin/3.4/tmux and .../3.7b/tmux for later
use). Report a table per version: case, observed lines/sizes, matches expectation y/n, plus any surprise.
