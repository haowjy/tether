# Probe: can a tether tab follow a tmux session's current window? (tmux 3.4 and 3.7b)

tether (a phone client for tmux) is changing from "one tab = one tmux window" to "one tab =
one tmux session, showing the session's current window, like `tmux attach`". The daemon
attaches one control client per tmux session (`tmux -u -N -C attach-session -t '$S' -f
pause-after=3`, over pipes; startup line `display-message -p ...` then `refresh-client -C WxH`).
Read `docs/design/daemon-core.md` §3.1, §3.3, §3.6, §3.7 for the current mechanics and
`docs/design/research/probe-latest-activity.md` for how earlier probes ran (tmux 3.4 and 3.7b
built from their tags on this Mac, private `-L` sockets, a "laptop" pty client driven via
openpty so its keys are real client input). Find or rebuild those binaries (tmux source tags
are in /tmp/tmux-upstream; Homebrew 3.8 is also installed — 3.8 results are a bonus, 3.4 and
3.7b are required).

Answer with evidence (raw control-mode lines) on BOTH 3.4 and 3.7b:

1. Which control clients receive `%session-window-changed $S @W`, and when: (a) the laptop
   attached to session S presses prefix-n; (b) the control client attached to S runs
   `select-window -t '$S:@W'`; (c) a one-shot `tmux new-window -t '$S'` (no -d); (d) the
   current window's shell exits; (e) `move-window` moves S's current window to another
   session; (f) a window linked into sessions S and T is selected in T. Is it sent to control
   clients attached to *other* sessions too (so tether must filter by its own session id)?
   Ordering vs `%window-add`, `%layout-change`, `%window-pane-changed`.
2. Does `select-window -t '$S:@W'` work with an id target, and for a window linked into
   several sessions does it select it in S (not some other session)?
3. Sizing under `window-size latest` with a size vote (`refresh-client -C '@W:CxR'`): after
   the control client runs `refresh-client -C '@W2:60x30' ; select-window -t '$S:@W2'` in one
   line, what size does W2 get, with and without the laptop attached to S? Does a
   control-client `select-window` make the control client or the laptop `latest` for W2?
   Does a window subscription `w<W2>` created AFTER the switch (the `<acts>` format in
   daemon-core §3.7) have the laptop's entry in its first value and then stay quiet (i.e. the
   switch itself does not read as a laptop act once the baseline is taken after it)?
4. Laptop prefix-n case: W1 had the vote; tether clears W1's vote and votes nothing on W2.
   Confirm W2 ends at the laptop's size and W1 returns to latest's size.
5. Can one `display-message -p -t '$S' '<session_id window_id window_index pane_id pane_width
   pane_height window_name>'` (tab-separated, name last) on the control client return the
   session's current window and its active pane? Does the startup line accept
   `#{session_id}\t#{window_id}` added? Missing session: what does it print (empty fields as
   with window targets)?
6. `%window-pane-changed @W %P`: delivered to control clients of other sessions too?
7. Session ends while tether's control client is attached: last window closed, with
   `detach-on-destroy on` (default) and `off`. Does the control client get `%exit`, or
   `%session-changed` to another session (and keep running)? Also `kill-session -t S`.
8. Cost: measure nothing new unless something surprises you; note any notification storm
   (e.g. rapid prefix-n held down: how many `%session-window-changed` per second).

Write the result as `docs/design/research/probe-session-follow.md` in the style of
probe-latest-activity.md: lead with a bold one-paragraph result, then setup, then each
question with the raw lines that answer it. You may create files only there and under your
own spawn-id-named scratch dir in /tmp; edit no other repo file. Kill every tmux server you
start. Report the answers in your final message too.
