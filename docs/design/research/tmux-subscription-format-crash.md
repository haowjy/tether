# tmux 3.4 crashes expanding the window subscription

**Finding (2026-10-24):** the `L:` window subscription can crash tmux 3.4 while it
expands `#{client_name}` for an accepted client whose identification is incomplete.
The client is already in tmux's global client list, but its `name` is still NULL.
The format callback calls `xstrdup(c->name)` without checking it. This is a tmux bug,
not a tether process failure; tmux must not be allowed to die on a state tether can
trigger.

## Evidence

- The three supplied crash reports have the same triggered-thread stack:
  `_platform_strlen ← strdup ← xstrdup ← format_find ← format_replace ←
  format_expand1 ← format_choose ← … ← format_loop_clients ← …
  control_check_subs_timer`. The `format_loop_clients` frame identifies subscription
  expansion, not tether's `display-message -p` or `list-* -F` formats.
- The only tether format using `L:` is the window subscription in
  `src/tmux/command.rs`; the `refresh-client -B` command sends it once per watched
  window. In the old format, an unidentified client has
  `client_control_mode == 0`, so expansion enters the nested membership test and
  looks up `client_name`.
- In upstream tmux 3.4, `server_client_create()` zero-allocates and inserts the client
  in the global list (`server-client.c:252–289`). `c->name` is assigned only after
  `MSG_IDENTIFY_DONE` (`server-client.c:3030–3035`). The `L:` loop walks the client
  list (`format.c:4184–4203`), and `format_cb_client_name()` calls
  `xstrdup(ft->c->name)` whenever `ft->c != NULL` (`format.c:1397–1404`). Thus the
  NULL input is specifically `client_name` on a connected, not-yet-identified client.
- A minimal isolated repro uses a unique `-L` server: create a session, attach a
  persistent `tmux -C` client, send the old subscription format below, then open a
  raw AF_UNIX connection to the server socket and hold it without sending the tmux
  IDENTIFY messages. The next subscription timer crashes tmux 3.4 (SIGSEGV, same
  stack); a one-shot `display-message -p alive` then reports no server. The same
  repro stayed alive on the installed tmux 3.7b and Homebrew 3.8.

```text
refresh-client -B 'w0:@0:#{L:#{?client_control_mode,,#{?#{m:*#,#{client_name}#,*,#,#{window_active_clients_list}#,},#{client_name}.#{client_activity}.#{client_width}x#{client_height}.#{client_flags};,}}}|#{pane_current_path}'
```

The 3.7b `format_loop_clients()` uses `sort_get_clients()`, which excludes unattached
clients (`sort.c:438–461`); tmux 3.8 also checks `c->name != NULL` in
`format_cb_client_name()` (`format.c:1645–1650`). This investigation did not bisect
the upstream change between 3.4 and 3.7b, and found no upstream issue report matching
the crash. The evidence therefore establishes 3.4 as affected and 3.7b/3.8 as not
reproducing this state, not an exact first-fixed release.

Upstream sources: [tmux 3.4 `server-client.c`](https://github.com/tmux/tmux/blob/3.4/server-client.c),
[3.4 `format.c`](https://github.com/tmux/tmux/blob/3.4/format.c),
[3.7b `sort.c`](https://github.com/tmux/tmux/blob/3.7b/sort.c),
[3.8 `format.c`](https://github.com/tmux/tmux/blob/3.8/format.c).

## Resolution

The subscription now checks `client_height` before expanding `client_name`. tmux 3.4
returns no height until the client tty has started, which is after its name is
assigned; clients without a started tty cannot be terminal clients acting on the
window. Missing format values expand empty, so this guard preserves the existing
`name.activity.WxH.flags;` entries for attached non-control clients while excluding
the transient client. `tests/tmux_real.rs` holds an unidentified Unix-socket client
across the subscription timer and checks that the private server remains responsive.

Run the gated test with `TMPDIR=/tmp/tether-meridian-501 TETHER_TMUX_TESTS=1
TETHER_TMUX=<tmux-path> cargo test --test tmux_real
window_subscription_survives_an_unidentified_socket_client -- --exact` on each
version. Test infrastructure uses private `-L` socket names; it never targets a
personal tmux server.
