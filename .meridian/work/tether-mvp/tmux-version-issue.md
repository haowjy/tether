## Context
Found during `tether-mvp` session-follow verification by the independent runtime prober (p244).

## Description
The supported tmux 3.4 and 3.7b binaries can crash the entire server while a control client is attached. A current-window change followed by destruction of that session in the same command list dispatches a deferred notification after the session's current window has been cleared. This predates session-follow and also reproduces with a control client attached to a different session.

## Evidence
On isolated private servers with a separate live keeper session, this command crashed the server in 5/5 attempts on each version:

```sh
tmux -L PRIVATE_SOCKET select-window -t victim:1 \; kill-session -t victim
```

A real control client was attached. Selection alone, destruction alone, and separately dispatched selection/destruction survived the observed trials. The same combined command with no control client survived. These narrow successful cases are not a general safety guarantee.

Upstream fix: https://github.com/tmux/tmux/commit/035447b0 (see https://github.com/tmux/tmux/pull/5244). Local evidence: `.meridian/work/tether-mvp/evidence/session-follow-tmux-risk.md`; current design risk: `docs/design/daemon-core.md` §9.

## Suggested action
Decide the daily-use tmux baseline: upgrade to a version containing the upstream fix, or use a verified backport. Re-run the exact crash reproduction on the chosen binary, then the real-tmux integration gates. Update supported-version/operator guidance consistently. Do not change installed host tmux without the owner's approval.

Avoiding combined selection/destruction in tether's own commands is necessary but cannot protect against other clients' command lists. Disabling session-follow does not remove the control-mode exposure.
