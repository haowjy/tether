# Probe: control-client behaviour for the daemon core (tmux 3.4)

Runtime checks on this dev box, 2026-10-21 (meridian spawn p7), on a private
`tmux -L design-p7 -f /dev/null` server under `nice -n 10`, driven by a Python harness
over plain pipes. Source references are to the tmux checkout at
`~/.meridian/ref/tmux` (current master; the 3.4 behaviour matched at runtime). These
facts back decisions in [daemon-core.md](../daemon-core.md).

## Process and framing

- **`tmux -C attach-session -t <s>` works over plain pipes on 3.4.** No pty is needed.
- **Spawn to first reply: 2.1–2.6 ms** (10 runs) from process start to the attach
  block. A new control client is cheap in latency; its cost is the ~5.3 MB RSS
  ([probe-tmux.md §8](probe-tmux.md)).
- **Startup output:** `%begin T N 0` / `%end T N 0` (the attach command itself, flags
  0), then `%session-changed $id name`, then `%output` for every pane in the session.
  A failed attach prints `%begin … 0`, `can't find session: a`, `%error … 0`, `%exit`,
  then EOF.
- **Flags field.** `cmd-queue.c:594`: the guard flag is 1 exactly when the command
  came from this control client's input (`control.c:718` creates that state). A hook
  fired by our command (`set-hook -g after-split-window 'display-message -p HOOKED'`)
  produced a separate `%begin T N 0` block after ours. Parse errors and unknown
  commands reply with flags 1 (`parse error: …` inside `%begin`/`%error`).
- **An empty input line detaches the client** (`control.c:711`). The writer must never
  send one.
- **Largest `%output` line: 8,201 bytes** during `yes | head -c 3000000`
  (`CONTROL_BUFFER_HIGH` is 8192 in `control.c`).
- **`%exit` carries no reason** on 3.4 in the three cases tried: session killed,
  `detach-client -s a` from outside, `kill-server`. The kill-server case printed
  `%sessions-changed` then `%exit`. Classification has to come from a follow-up check.

## Command lists

- `a ; b ; c` on one line returns one `%begin`/`%end` block per command, numbered
  consecutively.
- **An error stops the list.** `display -p one ; capture-pane -p -t %99 ; display -p
  three` returned `one`, then `%error` for the capture, and **no block for `three`**.
  An error in the first command returned a single `%error` block. The next line ran
  normally.
- `capture-pane -p -e -N -a -q -t %0` with no alternate screen returns an empty,
  successful block (`-q`), so it can sit inside a list without aborting it.
- `capture-pane -p -P -C` with nothing pending returns one empty line.

## Format variables on 3.4

`scroll_region_upper`, `scroll_region_lower`, `wrap_flag`, `origin_flag` and
`pane_tabs` expand on 3.4 (output `sr=0,29 wrap=1 origin=0 tabs=8,16,…`).
`bracket_paste_flag` and `pane_key_mode` expand empty. Together with
[probe-tmux.md §3](probe-tmux.md) this is the full 3.4 restore field set.

## Input

- `send-keys -t %0 -H c3 a9 e4 b8 ad 0a` delivered the UTF-8 bytes intact (the pane's
  echo showed `é中`). `-H` carries any byte sequence with no quoting.
- `refresh-client -A '%0:pause'` works **without** `pause-after` being set; it
  replied `%pause %0` inside the command's block.

## Sizing (the part that shapes the resize policy)

Setup: a normal client 200×50 attached to session `a` (windows `@0`, `@1`), `@1` its
current window; then a control client attached to `a`.

| Step | Window sizes after |
|---|---|
| Before the control client sets any size | `@0` 200x50, `@1` 200x49 |
| Control client: `refresh-client -C 60x20 ; refresh-client -C '@1:60x20'` | `@1` **60x20**, `@0` unchanged |
| Normal client types in `@1` | `@1` stays **60x20** |
| Control client: `refresh-client -C '@1:'` (clear) | `@1` back to 200x49 |

In an earlier run where the control client set only `@1:60x20`, the session's
*current* window `@0` dropped to **80x24**, the control client's default size, and
the normal client typing in `@0` took it back to 200x49. `switch-client -t b` on the
control client resized `b`'s current window to the control client's size.

Why, from `resize.c` and `server-client.c`:

- A control client is ignored for sizing until it sets a client size or a window size
  (`ignore_client_size`, `resize.c:109`). After that it counts for **every** window in
  its session.
- Attaching or switching makes the client `latest` for the session's current window
  (`server_client_set_session`, `server-client.c:349`). Keystrokes from a normal
  client make it `latest` for its current window (`server_client_update_latest`).
- Under `window-size latest` with more than one client on a window, only `latest`
  counts. A counted client's size for a window is its per-window size if set, else
  its client size (80×24 by default for a control client).
- After that, every per-window size acts as a **cap** on the window, whoever is
  `latest` (the clamp loop at the end of `clients_calculate_size`). That is why the
  laptop typing could not take `@1` back while the vote was set.

## Session switching and other sessions' events

After `switch-client -t b`: `%session-changed $1 b`, and no more `%output` from `a`'s
panes. Windows outside the attached session still produce events:
`%unlinked-window-close @1`, `%unlinked-window-add @3`,
`%unlinked-window-renamed @3 zz`; creating and killing sessions produced
`%sessions-changed`. Killing the attached session ended with `%exit` and EOF.
Splitting a window produced `%window-pane-changed @1 %2` and a `%layout-change` whose
layout lists both panes; `select-pane` produced `%window-pane-changed @1 %1`.

## Cleanup

The private server was killed after each script (`no server running on
/tmp/tmux-1000/design-p7`). The harness scripts in `/tmp/design-p7` are scratch.
