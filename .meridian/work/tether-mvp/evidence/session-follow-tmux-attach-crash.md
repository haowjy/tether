# Report

# tmux 3.4 crash during the e2e run: root cause

**Root cause:** this is a tmux bug, not a tether bug, and the hypothesis holds. tmux 3.4 sends a notification to a control client that has connected but not finished identifying. That client has `CLIENT_CONTROL` set and `control_state == NULL`, so `control_write` dereferences NULL. tmux fixed it in 3.7 (commits e5a2a25f and 31c93c48, April 2026), so 3.5 through 3.6b are also affected and 3.7b is not. Your `switch-client` "take" isn't involved: the take runs only after the new client has finished identifying.

I reproduced the exact e2e stack on `~/.cache/tether-tmux/3.4/bin/tmux` (same binary uuid e741492a): `control_write+36 <- control_notify_client_detached+88 <- notify_callback+312 <- cmdq_next+444 <- server_loop+60`, SIGSEGV at 0x20. 3.7b survives every case. I changed nothing in the repo.

## Causal chain (tmux 3.4 source, fetched to `/tmp/p-detach-crash/src/t34`)

1. **Accept.** The server adds the new client to the global `clients` list as soon as the connection is accepted.
2. **Flags arrive first.** On `MSG_IDENTIFY_FLAGS`, `server-client.c:2953` sets `c->flags |= flags`, which includes `CLIENT_CONTROL` (0x2000).
3. **State arrives last.** `control_state` is only allocated at `MSG_IDENTIFY_DONE` (`server-client.c:3042`: `if (c->flags & CLIENT_CONTROL) control_start(c);`). The identify messages arrive in several separate socket reads (the two file-descriptor messages, STDIN and STDOUT, force splits, plus one message per environment variable). `server_loop` runs `cmdq_next` between those reads, which is when queued notifications fire.
4. **The detach is queued meanwhile.** When another attached client goes away, `server_client_lost` removes it from the list and calls `notify_client("client-detached", c)` (`server-client.c:418-420`), which queues the notification.
5. **The notification reaches the half-built client.** The guard only checks the flag: `#define CONTROL_SHOULD_NOTIFY_CLIENT(c) ((c) != NULL && ((c)->flags & CLIENT_CONTROL))` (`control-notify.c:26`). `control_notify_client_detached` loops over all clients and calls `control_write`.
6. **NULL dereference.** `control_write` (`control.c:408-414`) does `cs = c->control_state` (NULL), then `TAILQ_EMPTY(&cs->all_blocks)`. `all_blocks` sits at offset 0x20 in `struct control_state`, hence the fault address 0x20.

**Upstream fixes:**
- **e5a2a25f, issue #4980:** adds `&& (c)->control_state != NULL` to the guard. The issue describes the same SIGSEGV at 0x20, hit from `session-window-changed`.
- **31c93c48, issue #5004:** makes `control_stop` return early when `cs == NULL`. That covers a second crash: a control client that disconnects before identifying crashes 3.4 in `control_stop` at 0x38. I reproduced that one too.
- Both commits are in tags 3.7, 3.7a, 3.7b, 3.7c and 3.8 only.

## Reproductions (scripts and results in `/tmp/p-detach-crash/`)

**Deterministic:** `half_identify.py` connects to the server socket and sends only `MSG_IDENTIFY_FLAGS(CLIENT_CONTROL)`, then holds the connection open. `det.sh` keeps a real attached control client A, adds the half-identified client, then ends A.

| End A by | 3.4 | 3.7b |
|---|---|---|
| `detach-client` | dies | survives |
| closing stdin (how tether ends a client) | dies, exact e2e stack | survives |

**Other notifications:** `notif.sh` runs one command while a half-identified client is present. On 3.4, `new-session -d`, `select-window`, `set-buffer`, `copy-mode` and `new-window` all kill the server. `display -p`, which sends no notification, does not. 3.7b survives all of them.

The 3.4 notifications that reach the half-identified client are client-detached, session-window-changed, window-pane-changed, pane-mode-changed, session-renamed, sessions-changed, and paste-buffer-changed/deleted. The ones that also check `c->session == NULL` (window add/close, layout-change, client-session-changed) skip it and are safe.

**Natural race with real clients:** `fuzz.py` launches B (`tmux -C attach`), then closes A's stdin after an offset d.

| tmux | d (ms) | B's environment | Crashes |
|---|---|---|---|
| 3.4 | −20 to 20 | default (88 vars) | 2/300 (at d = 6.2 and 12.9) |
| 3.4 | −20 to 20 | +3000 vars | 12/300 (d from 3.2 to 6.3) |
| 3.4 | 2.5 to 7 | +3000 vars | **59/300** |
| 3.4 | 2.5 to 14 | default | 0/300 |
| 3.4 | 0 to 1 | default / +3000 / CPU-loaded | 0/300, 0/300, 0/150 |
| 3.7b | 2.5 to 7 | +3000 vars, either way of ending A | 0/300 each |

So the window is about 3–7 ms after B launches, and B's environment size widens it: each variable is one more identify message.

macOS throttled the crash reports (10 written for about 75 crashes). All 9 from the race runs show the e2e stack; the tenth is the `control_stop` crash from an earlier deterministic run.

## How tether reaches it

**The e2e case.** That tier allows one tmux session. In "reconnects after a socket kill", opening s10 calls `spawn_client`, which calls `make_room()` (`src/hub/owners.rs:284-299`). That closes the oldest lingering client (the previous test's, kept for `LINGER` = 15 s, `src/hub/mod.rs:35`) and starts the new client in the same hub step, so `CloseClient` and `SpawnClient` go out together.

- **What's not confirmed:** at exactly simultaneous timing I got 0 crashes on an idle box. A crash needs A's teardown to finish about 0.5–7 ms after B's exec, which the loaded e2e box plausibly produced once. No daemon log survived to show the e2e timing.
- **Why ending A is slow:** A closes in several hops. The server sees EOF on A's stdin, sends `MSG_EXIT`, A's process replies `MSG_EXITING`, the server sends `MSG_EXITED`, A exits, and only when the server reads EOF on A's socket does `server_client_lost` queue the notification.
- **Environment:** spawned clients inherit the daemon's whole environment (`src/tmux/mod.rs:113-131` removes only `TMUX`), which sets the window width.

**Other daemon actions that can hit it in normal use (3.4–3.6b):**
- Opening a tab for another session while at `max_clients`, with a lingering client present (the `make_room` eviction above).
- A linger expiring (`Due::Linger` → `close_client`, `src/hub/time.rs`) while any attach is in progress: opening a tab, a respawn, or a reconnect that needs a new client.
- With several sessions open, any of these on client X while client B is attaching: `SelectWindow` (`select-window`), paste (`load-buffer`, `paste-buffer -d`, `delete-buffer`), `copy-mode -q`, or the one-shots `new-session` and `new-window` without `-d` (`src/tmux/command.rs:125-192` and `:255-270`).
- Anything Jimmy does in his own tmux during a phone attach: a laptop terminal detaching, switching windows, creating a session, copying into a buffer. tether cannot order these.
- **The second crash:** if tether's control client process dies before it finishes identifying (`kill_on_drop`, or the daemon dying or restarting mid-spawn), 3.4 crashes in `control_stop`. tmux's life then depends on tether's, against the project's principles.

## Would ordering in the daemon avoid it?

It would make it less likely, but cannot remove it.

- **Safe point for B:** once the daemon reads any stdout byte from B (the attach reply's `%begin`), B has finished identifying, because control output only flows through `control_state`. Holding back daemon-caused notifications until then helps: no `CloseClient` of other clients, no select-window, paste, copy-mode, new-session or new-window.
- **Safe point after closing A:** `make_room` would close A, wait for A's `Exited`, then spawn. This leaves a small race: A's process exits slightly before the server reads its socket EOF and queues the notification. B's roughly 3 ms startup usually covers that gap.
- **Narrowing the window:** spawning the control client with a minimal environment shrinks it a lot (0–2/300 at 88 vars versus 59/300 at 3000).
- **Not reachable by ordering:** notifications from Jimmy's own tmux use, and the `control_stop` crash when tether's client dies early.

Only tmux 3.7 or later removes the bug. Whether to require 3.7 for control mode, add the ordering rules, or document the hazard is your call. There's precedent: `command.rs:58` already avoids `pause-after off` because it crashes tmux 3.2a–3.6b.

**Cleanup:** I only used `-L p259-*` sockets with `-f /dev/null`, killed every server, and removed the leftover `p259-*` sockets in `/tmp/tmux-501`. A brief CPU-load run used busy loops, all killed. The tmux source clone and scripts are in `/tmp/p-detach-crash/`, with a summary in `FINDINGS.md`.
