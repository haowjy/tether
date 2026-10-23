# Fix the review findings on the history, wrap and limits commits

Three local commits on `main` (not pushed) were reviewed: `f94a83c` history ranges,
`75dd513` soft wraps, `ce9ca40` resource limits. Reviews: `meridian spawn show p52`
(wrap/history) and `meridian spawn show p51` (limits). Fix them as new commits on top,
one coherent commit per concern, in this order. Each commit must pass
`scripts/preflight.sh full` run on a clean export of that commit (`git archive <sha> |
tar -x -C /tmp/tether-fix-<n>`, plus `npm ci` in its `web/`); delete the export after.
Commit with explicit pathspecs; messages say what and why and end with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.

1. **History payload is the physical side (p52 H1, M1):** capture history rows with
   `-p -e -N -T -S start -E end+1` as the payload, drop the separate lookahead capture,
   drop `-e` from the alignment pair in both the snapshot and history lists.
2. **Repaint a row after its continuation's first char (p52 H2, L1):** after
   `?7h <first char> ?7l`, CUP to the row start and repaint it; fix the false drift claim
   in `docs/design/daemon-core.md` (~line 422).
3. **No join across chunks when history moved (p52 M2):** carry `history_size` in
   `HistoryChunk`; the client calls `finishLine()` without joining when it changes.
4. **Accept loop reaps finished connections (p51 H1):** reap as you go; a regression
   check that the set's length stays bounded after N connections earns its place.
5. **Budget costs and a real tier test (p51 M2):** a const cost table in KiB and a test
   that recomputes each tier's ceiling + 4 MiB against its range; restore the spec
   sentence in daemon-core §6.1.
6. **The limit message names sessions (p51 M1):** `#{session_name}` in the Locate format,
   carried in `Found`, stored on the hub's client; message per spec ("tether on <host>
   allows N tmux sessions at a time; open now: work"); restore the docs/CHANGELOG text.
7. **Lows (p51 L1–L3):** the hub test uses `TIERS[..].caps` not the host cgroup; fix stale
   figures in `fs.md` and `complete.md`; drop `socket2` for tokio's `TcpSocket`.

Verify the tmux changes on real tmux 3.4, 3.7b, 3.8 (`TETHER_TMUX=` with
`/tmp/tether-wrap-build/prefix/3.4/bin/tmux`, `.../3.7b/bin/tmux`, `/opt/homebrew/bin/tmux`;
`TETHER_TMUX_TESTS=1 cargo test --test tmux_real --test hub_real -- --test-threads=1`),
isolated `-L` sockets only. Re-run the reviewers' probes where you can (a space at the
wrap point; a width-2 emoji at a soft boundary in `@xterm/headless` with Unicode11; a
heavily styled 250×80 pane's reply size). Another agent is rebuilding `web/` at the same
time: touch only `web/tabs/driver.ts` and regenerated `web/proto/generated/`; if a web
check fails in a file you didn't touch, report it rather than fix it.
Report each commit's sha, what it fixed, failure modes exercised.
