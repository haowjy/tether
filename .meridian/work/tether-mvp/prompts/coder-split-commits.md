# Split the working tree into three coherent local commits

The tree holds two concurrent daemon changes plus small web type fixes; `scripts/
preflight.sh full` passes on the combined tree. Make three commits on `main`, in order,
each one passing the checks on its own (verify each with a clean export: `git stash`
is not allowed to lose anything — prefer building each commit's tree with
`git worktree add --detach /tmp/tether-split-<n> <sha>` *only as a scratch checkout to
run checks*, then remove it; never commit from it):

1. **Correct history ranges** (tmux clamps history captures): the before/after
   `history_size`/`pane_height` bracket, the pure clamp in `src/tmux/history.rs`, true
   start lines, empty above-top chunks, the client fetch loop's stop in
   `web/tabs/driver.ts`. Report of the coder who wrote it: `meridian spawn show p46`.
2. **Preserve soft wraps in snapshots and history**: `src/tmux/wrap.rs`, snapshot
   paint, the `wraps` field on `HistoryChunk`, the history view join, docs.
3. **Resource limits**: `src/budget.rs`, `src/http/server.rs`, caps, config, exit 78,
   tmpfs refusal, `welcome.daemon.completion`, the `limit` reason, unit file, docs
   (`meridian spawn show p47`), plus the web type fixes (`web/net/fakes.ts`,
   `web/proto/link.test.ts`, `web/tabs/connection.ts`).

If 1 and 2 are too entangled to separate so each compiles and passes, merge them into
one commit and say so. Shared files (`src/proto/messages.rs`, `web/proto/generated/
messages.ts`, `tests/*`, `docs/design/daemon-core.md`, `decisions.md`, `CHANGELOG.md`)
must be split by hunk: write patch files, edit them, `git apply --cached`. No
interactive git. Each commit message: a subject line and a body saying what and why,
ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push. Don't
change file contents except to make an intermediate commit compile (say where). Leave
`.meridian/` changes alone. Report the shas and what each check run showed.
