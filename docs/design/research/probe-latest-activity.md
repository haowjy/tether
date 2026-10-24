# Probe: seeing another client act on a window (tmux 3.4 and 3.7b)

**Result: a window subscription that lists, for each non-control client whose current
window is `@W`, its name, last activity, size and flags reports every act that makes
that client tmux's `latest` for `@W`, within about a second, on both versions. Apart
from its cwd part, the one other change is a focus-out, which the `focused` flag tells
apart. A per-window vote is a cap per dimension, and a control client's `send-keys`
never makes it `latest`.**

Spawns p117, p118 and p120, 2026-10-24, on macOS arm64 with tmux 3.4 and 3.7b built from
their tags; Homebrew tmux 3.8 was the host's. Each run used a private `-L` socket. The
"laptop" was a real pty client driven through its master (`openpty`, `TIOCSWINSZ`), so
its keys were client input, not `send-keys`. The control client attached to the same
session over pipes and set `refresh-client -C 200x49` first, as tether does (§3.1 of
[daemon-core.md](../daemon-core.md)).

## The subscription

```text
refresh-client -B 'w1:@1:#{L:#{?client_control_mode,,#{?#{m:*#,#{client_name}#,*,#,#{window_active_clients_list}#,},#{client_name}.#{client_activity}.#{client_width}x#{client_height}.#{client_flags};,}}}|#{pane_current_path}'
```

- `L:` is the client loop. `C:` is pane-content search: `#{C:…}` printed `1` once and
  never changed.
- Inside `L:` the format tree keeps the **outer** session and window
  (`format_loop_clients` passes `ft->s`, `ft->wl`), so `#{window_id}` there is not
  the looped client's window. Membership comes from `#{window_active_clients_list}`:
  the comma-separated names of clients whose session's current window is `@W`.
- `#,` is a literal comma inside `m:`. Both sides are comma-wrapped for exact
  membership: `#{m:*#,/dev/pts/1#,*,#,/dev/pts/12#,}` is `0`;
  `#{m:*#,/dev/pts/12#,*,#,/dev/pts/1#,/dev/pts/12#,}` is `1`.
- `client_activity` is set where tmux handles a client's key, mouse or focus event,
  the same function that makes it `latest` (`server_client_handle_key`); an attaching
  client starts with its creation time. A terminal resize makes a client `latest`
  without touching its activity, which is why the entry carries the size.

## What it reported

The same sequence on 3.4 and 3.7b (3.4's lines; 3.7b's differ only in timestamps),
run before `.#{client_flags}` was appended to each entry:

| Act | Line |
|---|---|
| subscribe (first value, after 1.0 s) | `%subscription-changed w1 $0 @1 1 - : /dev/ttys033.1792856215.200x50;\|/Users/jimmyyao/repos/tether` |
| laptop types in `@1` | `… : /dev/ttys033.1792856217.200x50;\|…` |
| laptop switches to `@0` (prefix n) | `… : \|/Users/jimmyyao/repos/tether` |
| laptop switches back | `… : /dev/ttys033.1792856222.200x50;\|…` |
| laptop's terminal resized to 200x45 | `… : /dev/ttys033.1792856222.200x45;\|…` |
| `cd /tmp` in `@1` | `… : /dev/ttys033.1792856228.200x45;\|/private/tmp` |

- Lines came 0.55–0.97 s after each act: tmux checks subscriptions once a second.
- Two keys in one burst gave one line; `client_activity` has one-second resolution.
- No line for: 5 s idle; a client on another session typing; the control client's own
  `send-keys`; any key after `refresh-client -B 'w1'` unsubscribed.
- A second pty attaching to the session (p117, session-level variant) added its entry.
- Rejected variant: no filter in tmux, the daemon checking membership. It works, but
  every non-control client's activity is in every window's value, so typing in another
  session sends a line for each watched window.

## Flags, focus and arrivals (p120)

With the flags in the entry, the same on 3.4 and 3.7b (3.4's values after
`%subscription-changed w1 $0 @1 1 - : `):

| Act | Value, or what happened |
|---|---|
| first value | `/dev/ttys032.1792857478.200x50.attached,focused,UTF-8;\|…` |
| `focus-events on`, focus-out (`ESC [ O` into the pty) | `/dev/ttys032.1792857480.200x50.attached,UTF-8;\|…`: `focused` gone, activity advanced |
| the vote set before it, cleared after it | 80×24, the control client's size: focus-out didn't make the laptop `latest` (the control client still was, from attaching after it) |
| focus-in (`ESC [ I`) | `focused` back, activity advanced; the window went to the laptop's 200×49 |
| `focus-events off`, `ESC [ O` | the entry still lost `focused` and advanced; size unchanged |
| a key while unfocused | activity advanced, still unfocused |
| a second pty attaching onto the window | its entry added, `…90x35.attached,focused,UTF-8;`, with no key typed |
| a pty in session `c`, the window linked into `c` and current there | its entry added; its keys advanced it: membership follows the window, not the session |
| a pty attached with `-f ignore-size` | `…70x25.attached,focused,ignore-size,UTF-8;` |

`client_flags` is comma-separated and holds no `.` or `;`. A focus-out is the one
entry change that isn't a `latest` act: tmux's key handler updates activity for every
key but skips `server_client_update_latest` for `KEYC_FOCUS_OUT`.

## Sizing facts

| Case | Window size |
|---|---|
| vote `@1:60x20` while the laptop is `latest` | 60x20; cleared: back to the laptop's 200x44 |
| laptop 200x30, vote `@1:60x45` | **60x29**: the vote caps each dimension, it never grows a window past `latest`'s size |
| vote set, laptop types, vote cleared | 200x29, the laptop's |
| vote on `@0` (not the laptop's current window), cleared | 200x29: `@0` returns to its `latest`, the laptop |
| no vote, control client `send-keys` into `@1` | unchanged 200x44: `send-keys` does not make the control client `latest` |

`latest` is set only for a client's session's current window, by that client's own
input, attach or terminal resize (`server-client.c`); nothing a control client can
send makes it `latest` for another window without changing the session's current
window, which the laptop shares.
