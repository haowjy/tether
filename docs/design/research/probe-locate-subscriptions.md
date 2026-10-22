# Probe: Locate, cwd subscriptions and `-N` on tmux 3.4

Runtime evidence for [daemon-core.md](../daemon-core.md) §3.4 (Locate), §3.8 (cwd
subscription) and §3.1 (`-N`). Run on the dev box on 2026-10-21 against tmux 3.4,
on a private server (`tmux -L rev-p21 -f /dev/null`, `nice -n 10`), which was killed
and its socket removed afterwards. tmux source references are to the 3.4 tree.

## Answers

| Question | Answer on 3.4 |
|---|---|
| What does `display-message -p -t @W` return for a window that no longer exists? | Success (rc 0) with every window, session and pane field empty, in control mode and as a one-shot. Never an error. |
| ...for a window that was killed? | The same: empty fields, rc 0. |
| ...for a window moved to another session? | The new session's id. |
| ...for a window linked into two sessions? | One of them. From a control client attached to a session that has the window, that session. |
| Do server formats expand when the target is missing? | Yes: `#{pid}` and `#{start_time}` expand even when the window or session target is empty. One Locate therefore also identifies the server instance. |
| `display-message -p -t '$S'` for a killed session? | rc 0, `#{session_id}` empty. |
| `send-keys -t @99` (missing window)? | rc 1, `can't find window: @99`. |
| `tmux -N -C attach-session`, `tmux -N new-session -d`, `tmux -N display-message` with no server running? | All fail with `no server running`, rc 1, and leave no server. With a server running, `-N new-session -d -P -F` and `-N new-window -d -P -F` work and print the new ids. |
| Peak RSS of a one-shot `tmux -N display-message` | 4,880 KiB (`/usr/bin/time`). |

## Close notifications fire for moves

Killing a window in the control client's own session produced
`%unlinked-window-close @1`. Moving a window from session `b` into the attached
session `a` produced `%window-add @3`, `%session-window-changed $0 @3` and then
`%window-close @3`, although the window lived on in `a`. A close notification
therefore says only "this window left some session"; whether it still exists is a
Locate.

## cwd subscriptions (`refresh-client -B`)

`refresh-client -B 'name:what:format'` subscribes a control client to a format.
`what` is empty (the session), `%P` or `%*` (panes), `@W` or `@*` (windows).
`refresh-client -B name` with no format unsubscribes.

Notification shape, verbatim (`cat -A`, so `$` is the line end):

```text
%subscription-changed w0 $0 @0 0 - : /tmp/rev-p21$
%subscription-changed w0 $0 @0 0 - : /etc$
%subscription-changed cwd $0 @0 0 %0 : /tmp$
```

That is `%subscription-changed <name> $<session> @<window> <window index> <%pane or -> : <value>`.
A window subscription (`@W`) reports `-` for the pane; a pane subscription reports
the pane.

Behaviour observed:

- **The first value arrives within a second of subscribing**, without any change.
  Re-subscribing an existing name replaces it and reports the current value again.
- **Only changes are reported.** `cd /usr; cd /etc; cd /var` typed as one line
  produced one notification, `/var`: intermediate values inside one check are lost.
- **A window subscription follows the window's active pane.** After `select-pane`
  moved the active pane to a pane in `/etc`, `w0` reported `/etc` with no `cd`.
- **A window subscription only reports while the window is in the client's own
  session.** A subscription to a window of another session stayed silent until that
  window was moved into the client's session, then reported at once.
- After unsubscribing, a `cd` produced nothing.

**How often tmux checks.** `control.c` arms a 1-second timer
(`control_check_subs_timer`, `tv_sec = 1`) when the first subscription is added and
deletes it when the last one is removed (`control_remove_sub`). Each tick evaluates
every subscription's format; `#{pane_current_path}` reads the foreground process's
cwd from `/proc`. So the cost is one format evaluation per subscribed window per
second, inside tmux, only while a subscription exists.

## Scripts

The probe scripts were throwaway shell scripts driving `tmux -C attach-session`
through a FIFO; the transcript above is their output. They are not kept.
