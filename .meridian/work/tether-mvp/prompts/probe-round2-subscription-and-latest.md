# Probe: current-window session subscription, swap-window, and `switch-client` as tether's way to become `latest` (tmux 3.4 and 3.7b)

Answer each numbered question below on **both** tmux 3.4 and 3.7b with raw control-mode
lines as evidence, and append the results as new numbered sections (8 onward) to
`docs/design/research/probe-session-follow.md` in the same style as the existing sections
(result first, then setup deltas, then raw excerpts per version). Also put a one-paragraph
summary of your answers at the top of your report.

Binaries: `~/.cache/tether-tmux/3.4/bin/tmux` and `~/.cache/tether-tmux/3.7b/bin/tmux`.
Use isolated `-L <name>` sockets only, never the default server; kill every server you
start. You may write only that research file plus scratch under `/tmp/p-round2-<spawnid>`
(delete it at the end). No source changes.

Setup to reuse (see sections 1-4 of the research file, and
`.meridian/work/tether-mvp/latest-client-probe.md` for the prior `switch-client` probe):
session S with windows W1, W2 (W1 current), `window-size latest`, status on; a real
laptop pty client (openpty + TIOCSWINSZ) at 80x24 attached to S; tether's control client
`tmux -u -N -L sock -C attach-session -t '$0' -f pause-after=3` over pipes, which first
sets its client size with `refresh-client -C 80x23`. A second control client attached
to another session T, to see what other control clients receive. Laptop "acts" mean
bytes written to the pty master, not `send-keys`.

## A. The current-window subscription (design: daemon-core §3.7)

From the control client: `refresh-client -B 'c::#{window_id}'`.

1. Exact first value line, and the line after the laptop's prefix-n (exact form, e.g.
   `%subscription-changed c $0 - - - : @1`).
2. `swap-window -s :W2 -t :W1` (and `swap-window` with the current window as source)
   from a one-shot: confirm no `%session-window-changed`, and whether/when the `c`
   value reports the new current window id; the lag.
3. Link W2 into S a second time (`link-window -s S:W2 -t S:5`), select index 5, then
   type steadily in the laptop for ~5 s and change cwd: does `c` send any line other
   than real id changes? (It should not.)
4. While idle and while the laptop types: any `c` lines at all?
5. `refresh-client -B 'c'` unsubscribes: no further lines.

## B. `switch-client -c <owner> -t '$S'` to make tether `latest`

Design intent: when a tether tab acts (types, pastes, Fit, opens) the window should
take tether's size even if the laptop is smaller; laptop typing takes it back. The
proposed group is `switch-client -c <owner-name> -t '$S' ; refresh-client -C '@W:CxR' ;
send-keys -t @W ...` (switch first, vote second).

6. How does the control client learn its own client name? Does `display-message -p
   '#{client_name}'` sent by the control client itself return its own name, on both
   versions? Record the form (`client-<pid>`?).
7. With the laptop 80x24 latest on W1 and a 200x50 vote on W1 (window stays 80x23):
   a. `switch-client -c C -t '$0'` alone: does W1 become 200x50, and immediately (in
      the same reply / layout-change right after) or only later? tmux 3.4/3.7b set
      `latest` *after* `recalculate_sizes` in `server_client_set_session`; find out
      whether a following `refresh-client -C '@0:200x50'` in the same group is needed
      for the resize, and whether re-sending an unchanged vote recalculates.
   b. The minimal group that reliably resizes in one step on both versions.
8. Side effects of a same-session `switch-client` by the control client, each yes/no
   with the raw line:
   a. Does the owner itself receive `%session-changed $0 S`? Does T's control client
      receive `%client-session-changed ...`? Any `%session-window-changed`?
   b. Does a `set-hook -g client-session-changed 'run-shell "echo hook >> FILE"'` fire?
   c. `#{session_activity}` and `#{session_last_attached}` before/after.
   d. With `set -g focus-events on` and the pane running a program that enables focus
      reporting (`printf '\e[?1004h'; cat -v`), does the pane receive `^[[I` or `^[[O`
      on the switch? Try with the laptop's terminal reporting focus-in and focus-out.
   e. Does the laptop's `<acts>` entry in a `w<W>` subscription (format in daemon-core
      §3.7, also in section 3 of the research file) change because of the switch?
      (It must not, or tether would yield its own claim.)
   f. Alert flags (bell/activity) on the current window: cleared? (`#{window_bell_flag}`
      after `printf '\a'` in a non-current... note only what you see.)
9. After tether became latest at 200x50, the laptop types a key: window back to 80x23,
   and the `w<W>` subscription reports the laptop's new activity within ~1 s.
10. After tether became latest, clear the vote (`refresh-client -C '@0:'`) without the
    laptop acting (the phone left the screen): what size does W1 take? (Expectation:
    the control client's client size, 80x23 here.) Repeat with the control client's
    client size set to something distinctive (e.g. `refresh-client -C 100x30` at
    startup) to tell the two apart. And when the control client then detaches?
11. Selection: laptop on W1 at 80x24; control sends `refresh-client -C '@1:200x50' ;
    select-window -t '$0:@1' ; switch-client -c C -t '$0'`. Does W2 end at 200x50 on
    both versions, in how many layout-changes, and in what order do the reply,
    `%session-window-changed`, `%session-changed` echo and `%layout-change` arrive?
    Compare with switch-client placed before select-window.
12. `send-keys` after the switch: does plain `send-keys -t @0 -H 78` (no `-K`) still
    land in the pane on both versions after the switch (the key table reset must not
    matter)?

Report anything else surprising you observe. Done = sections 8+ written with per-version
raw evidence, and every numbered question answered.
