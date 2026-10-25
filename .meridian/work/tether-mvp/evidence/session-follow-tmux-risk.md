# Probe: upstream tmux session-window notification crash risk

**Verdict:** Reproduced the upstream server crash on both supported binaries. A control client must be attached; when a session's current window is changed and that session is destroyed in the *same tmux command list*, tmux 3.4 and 3.7b dereference a NULL current window while dispatching the deferred `%session-window-changed` notification. This is not caused by session-follow alone: a window selection by itself succeeds, and a later, separately dispatched `kill-session` succeeds. But session-follow does add another ordinary source of window-change notifications to a pre-existing control-mode vulnerability. Do not combine follow-selection with destruction in one command list. The supported old binaries remain vulnerable to ordinary user/other-client command lists; tether cannot prevent those. The upstream fix is the justified mitigation where available, not suppressing follow or pretending non-reproduction means safe.

## Setup and method

Used the requested binaries directly:

- `~/.cache/tether-tmux/3.4/bin/tmux`
- `~/.cache/tether-tmux/3.7b/bin/tmux`

Each run started a foreground server with `tmux -D -f /dev/null -L p244-…`, then created a `keep` session (`sleep 300`) and a two-window `victim` session. A real `tmux -C attach-session -t victim` control client stayed attached with stdin open. A separate client sent commands; in one confirmatory run, the same command list was written through the control client's stdin. The independent `keep` session made server survival distinguishable from the expected exit of the control client attached to the destroyed victim. All sockets were unique `p244-*` private `-L` servers; no personal/shared tmux socket or tether process was used.

## Findings

Exact deterministic reproducer (the shell form of the separate-client tests):

```sh
tmux -f /dev/null -L SOCKET select-window -t victim:1 \; kill-session -t victim
```

Both commands were in one tmux command list. `victim` began on window 0; selecting `victim:1` changed its current window. Results:

| Version | Same-list reproductions | tmux CLI result | Foreground server result | Control-mode result |
|---|---:|---|---|---|
| 3.4 | 5/5 | exit 1, `server exited unexpectedly` | signal 11 (`-11`) every time | exit 1, `%exit server exited unexpectedly` |
| 3.7b | 5/5 | exit 1, `server exited unexpectedly` | process died all 5 times: 4 signal 11 (`-11`), one exit status 1 | exit 1, `%exit server exited unexpectedly` |

The 3.7b anomalous status-1 death is reported as observed, not assumed to be SIGSEGV; the independent control-client-issued reproduction below returned `-11` on 3.7b too.

Additional cases, one run per version each:

| Case | 3.4 | 3.7b |
|---|---|---|
| `kill-session -t victim` only, control attached to victim | CLI 0; server remained alive; control ended normally (`%session-changed`, `%sessions-changed`, `%exit`) | Same |
| `select-window -t victim:1` only | CLI 0; server/control stayed alive; control received `%session-window-changed $1 @2` | Same |
| Select, wait 150 ms for dispatch, then separate `kill-session` | Both CLI commands 0; server remained alive; control ended normally after destruction | Same |
| Same-list selection/destruction, control attached to `keep` rather than `victim` | Server still crashed (`-11`); keeper control saw `%exit server exited unexpectedly` | Same |
| Same-list selection/destruction with **no control client** attached | CLI 0; server remained alive | Same |
| Same command list sent as a line over the attached control client's stdin | Server `-11`; control exited 1 with `%exit server exited unexpectedly` | Same |

Representative captured evidence (identifiers omitted):

```text
# control log after same-list select + kill
%session-changed $1 victim
%exit server exited unexpectedly

# separate kill-only control log
%session-changed $1 victim
%sessions-changed
%exit

# select-only control log
%session-window-changed $1 @2
```

The foreground server used an independent still-running `keep` session in every destructive case; therefore the expected consequence of killing `victim` was that its attached control client exits, **not** that the tmux server exits. On crash runs, the surviving `keep` session and its control client were lost as collateral. The separately monitored server process returned `-11` (except the one 3.7b status-1 run noted above), which distinguishes a crash from normal session/control-client termination.

## Source / interpretation

Upstream source confirms the timing and dereference: tagged [3.4 `control-notify.c`](https://github.com/tmux/tmux/blob/3.4/control-notify.c#L211-L222) and [3.7b `control-notify.c`](https://github.com/tmux/tmux/blob/3.7b/control-notify.c#L209-L221) format the notification via `s->curw->window->id` without a NULL guard. The upstream [PR #5244 / issue #5244](https://github.com/tmux/tmux/pull/5244) explicitly explains that `notify_add()` defers the notification on the command queue and holds a session reference; `session_destroy()` can clear `curw` before dispatch. It documents the same select-then-kill-in-one-list trigger and says this crashes the whole server. Upstream [commit 035447b0](https://github.com/tmux/tmux/commit/035447b0) adds the NULL-current-window check; the 3.8 source callback checks `s == NULL || s->curw == NULL` before reading the window ([3.8 source](https://github.com/tmux/tmux/blob/3.8/control-notify.c#L275-L295)).

**Session-follow vs. pre-existing exposure:** the reproducer requires only an ordinary `select-window` and a destructive command queued before the deferred notification runs. The attached control client need not itself be attached to the destroyed session; notifications are delivered to control clients server-wide. Thus tether already had this upstream risk whenever it attached in control mode, independent of session-follow. Follow's selection is one more way to enqueue the vulnerable notification, but selection alone (the follow operation) did not crash, and separately dispatched destruction did not reproduce. The narrow dangerous operation is the combined/same-queue ordering, not “following” by itself.

**Practical mitigation:** never place session destruction (`kill-session`, or another operation that destroys the selected session) in the same tmux command list as a current-window-changing command. Let the selection command complete and its deferred notification dispatch first. This avoids tether creating the known trigger; it cannot protect against arbitrary commands run by other users/clients. Where the upstream fix is present, upgrading tmux is the real fix. This probe did not test a patched binary, 3.8 runtime, other OSes, or every way a session can be destroyed; non-reproduction in the separated cases is not proof of general safety.

## Scope and cleanup

No source/spec edits, test suites, tether build, or personal tmux were used. Scratch output was kept in `/tmp/p244-tmux-risk` during the run and removed afterward; all `p244-*` servers were killed or had already crashed. No processes intentionally left running. This report is the retained excerpt, not a raw log.
