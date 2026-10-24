# Follow-up 2: client flags in the entry, focus events, and two arrivals (same harness)

Same setup as your last run (tmux 3.4 and 3.7b binaries at /tmp/tether-meridian-501/tmux-bin/,
session `a` with @0/@1, laptop pty on @1, control client on `a` with `refresh-client -C 200x49`).

The final subscription adds each client's flags to its entry:

    refresh-client -B 'w1:@1:#{L:#{?client_control_mode,,#{?#{m:*#,#{client_name}#,*,#,#{window_active_clients_list}#,},#{client_name}.#{client_activity}.#{client_width}x#{client_height}.#{client_flags};,}}}|#{pane_current_path}'

Record exact `%subscription-changed` lines on both versions for:
1. First value: what `client_flags` looks like (does it contain commas? `focused`?).
2. `set -g focus-events on`; then write a focus-out report `\e[O` into the laptop pty's input
   (as a terminal would), then a focus-in `\e[I`. Lines for each, and the window's size after
   each with a vote `@1:60x20` set beforehand and then cleared after focus-out (does
   focus-out make the laptop `latest`? It shouldn't). Also with focus-events off: does `\e[O`
   change anything?
3. With focus-events on and the laptop focused-out, a key typed: entry flags/activity.
4. A second pty attaching to session `a` while `a`'s current window is @1 (no keys typed):
   the line; then it types.
5. A second session `c` created with `new-session -d -s c`, `link-window -s a:1 -t c:5`,
   `select-window -t c:5`, and a pty attached to `c`: is its entry in @1's value (the
   subscription is on the control client attached to `a`)? It types: line?
6. A pty attached with `attach -f ignore-size` (or `-f read-only`) onto @1: its entry and flags.

Write only under /tmp/tether-meridian-501/p118/ (or your spawn id dir). Report a table per version
plus exact lines, and stop the servers.
