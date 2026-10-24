# Follow-up: per-window activity subscription with `L:` (same harness, same binaries)

Thanks: `L:` is the client loop. One problem with the session-level form: inside `L:` the
format tree inherits the *outer* session/window (format_loop_clients passes ft->s/ft->wl), so
`#{window_id}` there is the control client's session's current window, not each client's.
It only looked right because the laptop and the control client share session `a`.

tether will fold this into its existing per-window cwd subscription, so test a
**window** subscription and decide membership with `#{window_active_clients_list}`
(comma-separated names of clients whose session's current window is this window).

Run on 3.4 and 3.7b (binaries at /tmp/tether-meridian-501/tmux-bin/), same setup as before plus
a second session `b` with its own window, and a second pty client ("other") attached to `b`.

Candidate A (tmux filters, exact membership by comma-delimiting both sides):

    refresh-client -B 'w1:@1:#{L:#{?client_control_mode,,#{?#{m:*#,#{client_name}#,*,#,#{window_active_clients_list}#,},#{client_name}.#{client_activity}.#{client_width}x#{client_height};,}}}|#{pane_current_path}'

Candidate B (no filter in tmux; the daemon filters):

    refresh-client -B 'w1:@1:#{window_active_clients_list}|#{L:#{?client_control_mode,,#{client_name}.#{client_activity}.#{client_width}x#{client_height};}}|#{pane_current_path}'

First check the escaping in isolation with `display -p`:
`#{m:*#,/dev/pts/1#,*,#,/dev/pts/12#,}` must be 0, `#{m:*#,/dev/pts/12#,*,#,/dev/pts/1#,/dev/pts/12#,}` must be 1.
If `#,` doesn't work inside `m:`, find the working escape (or another exact-membership trick,
e.g. `#{s/...}` or comparing against each list element) and use it in A.

Cases, for each candidate that parses, recording the exact `%subscription-changed` lines:
1. first value; its full line shape (`w1 $S @1 <index> - : <value>`?)
2. laptop (on @1) types → change
3. laptop switches to @0 → change (A: its entry disappears); back to @1 → entry returns with new activity
4. laptop pty resize → change
5. "other" on session `b` types → A: no line; B: a line
6. `cd /tmp` in @1's shell → the path part changes
7. idle 5 s → nothing
8. the control client's own `send-keys` → no change
Also: `refresh-client -B 'w1'` unsubscribes cleanly; the format is accepted at its length.

Write only under /tmp/tether-meridian-501/p117/. Report the working candidate, exact lines per
version, and any surprise.
