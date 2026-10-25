# Probe: can the control client become tmux's latest client?

## Result

**Yes.** On tmux **3.4, 3.7b, and 3.8**, the tether control-mode client participates in `window-size latest` after it has a per-window size, and its size is used when tmux considers it `window->latest`. Real key events routed through `send-keys -K -c CLIENT` update its latest status; real input typed into the 80x24 PTY then takes latest status back and returns the window to 80x23. `refresh-client -C` alone does not mark a stale control client latest; `display-message -c` does not either.

There is not a completely transparent, side-effect-free way to do this while preserving the current raw pane-input semantics. `send-keys -K` dispatches keys through the target client's key table (prefixes/bindings can be consumed or run). A same-session `switch-client` call also sets latest, without injecting a key, but runs session-switch bookkeeping and resets that control client's key table. In this probe, tmux 3.4's `send-keys -K` updated latest but did **not** put ASCII `x` or `Enter` into the pane; UTF-8 `é` was visible. The 3.7b and 3.8 probes did put ASCII, UTF-8, and Enter into the pane. So for a cross-version implementation that must preserve current pane input, the practical supported fallback is to call same-session `switch-client` immediately before the existing pane-input command, subject to the key-table/session side effects below. If those side effects are unacceptable, the answer is **no clean mechanism**.

## Real-system run

Ran isolated servers only, with `tmux -L p225-*`; binaries were `~/.cache/tether-tmux/3.4/bin/tmux`, `~/.cache/tether-tmux/3.7b/bin/tmux`, and system `tmux` 3.8. Each server used a `cat` pane, `window-size latest`, an actual 80x24 PTY attachment, and a `tmux -C attach` control client. `refresh-client -C @0:200x50` supplied the tether vote. `display-message` recorded `#{window_width}x#{window_height}`; `list-clients` recorded client name, `client_activity`, dimensions, flags, and key table; `capture-pane` checked pane input. The laptop-typing step wrote `p\n` / `l\n` to the PTY master (not `tmux send-keys`), so it exercised actual client input.

| tmux | Method / sequence | Window result | Pane / client result and side effects |
|---|---|---|---|
| 3.4 | Baseline PTY, then `refresh-client -C @0:200x50 -t CLIENT` | 80x23 → 200x50 while control was latest at attach | Command succeeds. Per-window size makes control client eligible for sizing. |
| 3.4 | After actual PTY `p`+Enter, `send-keys -K -c CLIENT -t %0 x` | PTY typing returns it to 80x23; `-K` returns it to 200x50 | `client_activity` advances and client becomes latest. **ASCII `x` did not appear in `capture-pane`; Enter did not submit.** `é` did appear. Prefix `C-b` set control client's `client_key_table=prefix`; following `a` was handled as a binding (not pane text) and restored `root`. |
| 3.4 | `display-message -p -c CLIENT hello`; `refresh-client -c -t CLIENT` after PTY latest | Stays 80x23 | Neither made control latest. `select-window -t @0 -c CLIENT` errors `command select-window: unknown flag -c`. |
| 3.4 | `switch-client -c CLIENT -t p225` after PTY latest | 80x23 → 200x50 | Succeeds and sets control client latest; no pane text. Same session remains attached (`session_attached=2`). It does run session-switch bookkeeping and resets the control client's key table. |
| 3.7b | Baseline `refresh-client -C`; actual PTY `p`+Enter; `send-keys -K` with `x`, `é`, Enter | 80x23 → 200x50 → 80x23 → 200x50 | All three keys reached the `cat` pane (`x`, `xé`, then `xé\n`). Control `client_activity` advanced on `-K`; actual PTY activity returned latest to laptop. `C-b` set control key table to `prefix`; following `a` was consumed by a binding, not sent to pane. |
| 3.7b | `display-message -c`, `refresh-client -c`, `select-window -c`, same-session `switch-client -c` | Display/refresh stay at PTY's 80x23; select errors as above; switch returns to 200x50 | Same as 3.4. |
| 3.8 | Same sequences as 3.7b | 80x23 → 200x50 → 80x23 → 200x50 | Same observable behavior as 3.7b, including ASCII/UTF-8/Enter reaching pane and prefix binding handling. |

The `#{window_active_clients}` count was 2 with both clients attached. The tmux format did not expose a useful `window_latest` value in this build, so latest-client transitions were established through the actual `latest`-policy size change, client-activity timestamps, and reversals on PTY input. Activity values are integer-second format output; they advanced, but are not precise sub-second timings.

### Exact command shapes exercised

```sh
# Per-window control-client size vote; target the actual control client name.
tmux -L SOCKET refresh-client -C '@0:200x50' -t CLIENT

# Route a key as a control-client key event, not raw pane input.
tmux -L SOCKET send-keys -K -c CLIENT -t %0 x
# Other tested key arguments: 'é', Enter, C-b, a

# Explicitly set the control client as latest by re-setting its current session.
tmux -L SOCKET switch-client -c CLIENT -t SESSION

# Laptop return-to-latest must be actual PTY input, e.g. write bytes `l\n` to
# the attached 80x24 PTY; `tmux send-keys -t %0 l` is not a substitute.
```

For existing raw `send-keys` pane-input behavior, the possible serialized sequence is:

```sh
tmux -L SOCKET switch-client -c CLIENT -t SESSION \; send-keys -t %0 KEY...
```

This is not behaviorally neutral: `switch-client` always calls `server_client_set_session`, including when the session is unchanged. That marks `window->latest`, but also updates session activity/last-attached state, focus/status/notification state, and `switch-client` resets the control client's key table. Confirm this tradeoff before adopting it. It does not change `window-size` to `manual`; no `resize-window` was used.

## Source explanation

The relevant upstream tagged source was read directly for each version:

- `send-keys` has `-K` in all three tags, and it creates a `KEYC_SENT` event and invokes `server_client_handle_key`: [3.4 `cmd-send-keys.c`](https://github.com/tmux/tmux/blob/3.4/cmd-send-keys.c#L32-L81), [3.7b `cmd-send-keys.c`](https://github.com/tmux/tmux/blob/3.7b/cmd-send-keys.c#L32-L85), [3.8 `cmd-send-keys.c`](https://github.com/tmux/tmux/blob/3.8/cmd-send-keys.c#L32-L88). The `-K` route is a client key event, not unconditional `window_pane_key` input; key-table processing and prefix/binding behavior are expected.
- The end of the key callback calls `server_client_update_latest(c)` after handling a key (except focus-out). That function sets `w->latest = c` and recalculates if the option is latest: [3.4 `server-client.c`](https://github.com/tmux/tmux/blob/3.4/server-client.c#L1826-L1844), [3.7b `server-client.c`](https://github.com/tmux/tmux/blob/3.7b/server-client.c#L1127-L1145), [3.8 `server-client.c`](https://github.com/tmux/tmux/blob/3.8/server-client.c#L1371-L1389). The `-K` call reaches this client key path.
- `refresh-client -C @WINDOW:COLSxROWS` stores the per-window size and recalculates; it does not itself call `server_client_update_latest`: [3.4 `cmd-refresh-client.c`](https://github.com/tmux/tmux/blob/3.4/cmd-refresh-client.c#L80-L102), [3.7b `cmd-refresh-client.c`](https://github.com/tmux/tmux/blob/3.7b/cmd-refresh-client.c#L81-L103), [3.8 `cmd-refresh-client.c`](https://github.com/tmux/tmux/blob/3.8/cmd-refresh-client.c#L62-L81). Version 3.8 refactors control-client per-window storage to `control_set_window_size`; the policy is unchanged.
- Control clients are ignored for sizing until a `CLIENT_SIZECHANGED` or `CLIENT_WINDOWSIZECHANGED` flag is set. A `-C @...` size sets the latter. `window-size latest` counts eligible clients with the window and, when there are multiple, considers only `w->latest`; the selected client's per-window size replaces its tty size. The later clamp pass also applies any eligible per-window size as an upper bound. See [3.4 `resize.c`](https://github.com/tmux/tmux/blob/3.4/resize.c#L78-L112), [3.7b `resize.c`](https://github.com/tmux/tmux/blob/3.7b/resize.c#L78-L112), [3.8 `resize.c`](https://github.com/tmux/tmux/blob/3.8/resize.c#L96-L130) and the corresponding calculation [3.4](https://github.com/tmux/tmux/blob/3.4/resize.c#L130-L243), [3.7b](https://github.com/tmux/tmux/blob/3.7b/resize.c#L130-L243), [3.8](https://github.com/tmux/tmux/blob/3.8/resize.c#L146-L260).
- `switch-client` ends by calling `server_client_set_session`. That function assigns `s->curw->window->latest = c` directly in all three versions. In 3.4/3.7b, the assignment follows `recalculate_sizes`; in 3.8 it moved before it, so the newly selected client is used during that recalculation: [3.4 `server-client.c`](https://github.com/tmux/tmux/blob/3.4/server-client.c#L361-L390), [3.7b `server-client.c`](https://github.com/tmux/tmux/blob/3.7b/server-client.c#L401-L430), [3.8 `server-client.c`](https://github.com/tmux/tmux/blob/3.8/server-client.c#L451-L481). This ordering change is consistent with the observed same-session switch resulting in the 200x50 size in all three releases.

## Caveats / decision

- `send-keys -K` is the most direct activity signal and works end-to-end for ordinary text and special keys in 3.7b/3.8. It routes those keys through tmux's binding table, so `C-b` starts the prefix table, prefix+binding keys can run tmux commands, and bound/special keys may not be forwarded to the pane. It is not equivalent to tether's current raw-pane-input command.
- 3.4 supports the `-K` flag in source and accepts it at runtime, and it updates latest; nevertheless, the tested ASCII `x` and Enter did not appear in the pane, while UTF-8 `é` did. This discrepancy makes `-K` alone a poor cross-version input replacement without a focused follow-up on the 3.4 input quirk.
- `switch-client` is the supported cross-version way found to set latest without injecting a key. Use only with tether's current session and serialize it with existing raw input; assess its session side effects and control-client key-table reset.
- `display-message -c` only chooses where/formats a message; `refresh-client` flags tested here do not activate the client. `select-window` has no `-c` option in these releases.
- Once the control client becomes latest, actual laptop PTY input moves latest back and the window becomes 80x23 again. The existing manual `resize-window` concern is avoided: `show-window-options -t @0 window-size` remained `window-size latest` throughout.

No source changes were made. Isolated servers were killed; scratch source and harnesses were removed after writing this note.
