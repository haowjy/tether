# Review the history-range and wrap-preservation implementation

Code: `src/tmux/history.rs`, `src/tmux/wrap.rs`, `src/tmux/snapshot.rs`,
`src/tmux/command.rs`, `src/tmux/session.rs`, the history path in `src/hub/requests.rs`,
`HistoryChunk` in `src/proto/messages.rs`, `web/tabs/driver.ts` (fetch loop and copy
join), the regenerated 3.4 fixtures, `tests/`. Design: `.meridian/work/tether-mvp/design/
snapshot-wrap.md` amended by `snapshot-wrap-review-1.md` (map stays in the daemon; the
-N -T/-J pair on every version; autowrap only around a continuation's first char; no
map for the saved screen; history clamp redone in a pure function with a tear check).
Implementer's report: `meridian spawn show p46`.

Hunt for a wrong join (worse than a missing one), torn history, off-by-one line numbers,
infinite or wasted fetch loops on a slow link, reply-size cap breaches from the extra
captures, and regressions in snapshot repaint. tmux binaries for checks:
`/tmp/tether-wrap-build/prefix/3.4/bin/tmux`, `.../3.7b/bin/tmux`, `/opt/homebrew/bin/tmux`
(isolated `-L` sockets only, never other sessions). Severity per finding, file:line.
No edits.
