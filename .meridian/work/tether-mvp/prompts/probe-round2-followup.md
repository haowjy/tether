# Follow-up probe (tmux 3.4 and 3.7b): reverse swap, and selection when the laptop is the selected window's latest

Same rules and setup as your p231 run (binaries `~/.cache/tether-tmux/{3.4,3.7b}/bin/tmux`,
isolated `-L` sockets, a real pty laptop at 80x24, a control client attached to `$0`,
scratch in `/tmp/p-round2b-<spawnid>`, kill every server and delete scratch at the end).
Append the results as section 15 (and 16) to `docs/design/research/probe-session-follow.md`,
and, in section 8, replace the sentence about the reverse swap's "observed gap" with the
real answer. Edit nothing else; no source changes.

1. **Reverse swap, observed long enough.** tmux checks subscriptions once a second, so
   0.5 s was too short. With `refresh-client -B 'c::#{window_id}'` subscribed, run
   `swap-window -s S:1 -t S:0`, wait 3 s, then `swap-window -s S:0 -t S:1` (current window
   as source), wait 3 s; repeat each direction 3 times. For each swap record whether a
   `c` line arrived and its delay from the one-shot's return (timestamps from your
   reader). Also try `swap-window -d` and a swap of two non-current windows (expect no
   `c` line when the current id doesn't change).

2. **Selecting a window whose `latest` is the laptop, with the laptop smaller.** Make the
   laptop act on W2 (prefix-n to W2, type a key), then prefix-p back to W1 and type a
   key, so the laptop is `latest` on both windows; both 80x23. The control client's
   client size is 80x23. Then from the control client run each group on a fresh server
   and record W2's final size, every `%layout-change` for W2 in order, and the replies:
   a. `refresh-client -C '@1:200x50' ; select-window -t '$0:@1' ; switch-client -c C -t '$0' ; refresh-client -C '@1:200x50'`
   b. `refresh-client -C '@1:200x50' ; select-window -t '$0:@1' ; switch-client -c C -t '$0'`
   c. `select-window -t '$0:@1' ; switch-client -c C -t '$0' ; refresh-client -C '@1:200x50'`
   We want to know which reaches 200x50 on 3.4 (where `latest` is set after the recalc in
   `server_client_set_session`) and with how many W2 layout changes.

3. **The take with no vote change while tether is already latest.** After group (a),
   send `switch-client -c C -t '$0' ; refresh-client -C '@1:200x50'` again: any
   `%layout-change`? (Expect none or an unchanged one; record which.)

Put a one-paragraph answer to each at the top of your report.
