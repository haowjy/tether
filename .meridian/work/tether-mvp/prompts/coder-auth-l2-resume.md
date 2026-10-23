# Resume L2: browser admission and static shell (p60 died mid-build)

Your predecessor p60 (brief: `.meridian/work/tether-mvp/prompts/coder-auth-l2.md`, read it in
full; it is still the task) lost its connection after ~24 minutes. Its edits are uncommitted
in the primary checkout: `src/auth/{identity,store,token}.rs`, new `src/auth/node.rs`, new
`src/runtime.rs`, `src/config.rs`, `src/http/server.rs`, `src/lib.rs`. No commit was made.
`cargo build` currently fails with 5 errors (E0277/E0308/E0425/E0432) plus an unreachable
pattern warning at `src/runtime.rs:48` (AGAIN and WOULDBLOCK are the same errno on this
platform). Its transcript is available via `--from`; use it to see where it was in the
six-step scope and what it had decided.

Start by reading the partial work against design rev 6
(`.meridian/work/tether-mvp/design/browser-auth.md`) and judge it: keep what is right, rework
what isn't. Then finish the brief's scope.

Files that are not yours: `tests/tmux_real.rs` has an uncommitted edit belonging to another
lane (a TUI snapshot-test investigation). Don't edit or stage it. Same for `web/`,
`scripts/preflight.sh`, `.githooks/`, and `.meridian/`. Stage commits by explicit pathspec,
never `git add -A`/`-a`. Each commit passes `scripts/preflight.sh full` on a clean export of
that commit, as the brief says. Don't push.

If spawning or tests hit Unix-socket path-length limits, use `TMPDIR=/tmp/tether-meridian-501`.

Report: commits with what each verifies, the failure modes you exercised on a running daemon
(the brief's risk list), what you changed from p60's partial work and why, and which probe
gates need the Linux dev box.
