# Implement correct history ranges, then wrap-preserving snapshots and history

Two commits' worth of daemon work, in this order. Do not commit; leave the changes in
the tree and report which files belong to which change (the lead commits).

Settled design: `.meridian/work/tether-mvp/design/snapshot-wrap.md` as amended by
`design/snapshot-wrap-review-1.md`, with these decisions by the tech lead:
- **Change 1 (first): tmux clamps history ranges.** Read `#{history_size}
  #{pane_height}` before and after the history captures in the same command line;
  redo tmux's clamp in a pure function in `src/tmux/`, label rows with their true line
  numbers, return an empty chunk above the top, and use the before/after pair as the
  history tear check. Make the client's fetch loop (`web/tabs/driver.ts`) stop
  correctly. Review F4.
- **Change 2: wrap map.** No tmux version branch: on every version capture the
  `-N -T` / `-J` pair on the same command line and align them, leaving ambiguous bits
  unset (review F5, the tech lead's choice; delete nothing for `-F`, write none). The
  snapshot's map stays inside the daemon: it feeds the `paint()` loop in
  `src/tmux/snapshot.rs` (review F1); no new snapshot frame field, no outbox/charge or
  pipeline change. Paint with autowrap off and turn it on only around the first
  character of a continuation row; ignore a wrap bit on the last painted row (F3). No
  map for the saved screen behind an alternate screen (F2). History chunks do carry a
  packed bitmap to the client (≈46 bytes per chunk); count it in the hub's fitting
  loop up front (F8); the client's history DOM view joins wrapped rows for copy.
- Update `docs/design/daemon-core.md` (§3.5 and the history section, the reply-size
  note for the extra captures) and `docs/design/client/` text that says the pipeline
  takes a wrap map (`client-architecture.md:123` in the work dir) in the same change.

You own: `src/tmux/**`, the history request path in `src/hub/`, `HistoryChunk` in
`src/proto/messages.rs`, `web/tabs/driver.ts` and the history view's join, the docs
above, and tests. Another coder is working at the same time on resource limits and
owns `src/config.rs`, `src/main.rs`, `src/http/**`, `src/fs/**`, `src/complete/**`,
`contrib/`, the hub's cap counting, and `DaemonInfo`/`welcome` in `src/proto/`; don't
edit those. Regenerated TypeScript types in `web/proto/generated/` are shared: regenerate,
don't hand-edit.

Verify on real tmux, isolated only (private `-L` sockets; never other sessions):
`TETHER_TMUX_TESTS=1 cargo test --test tmux_real --test hub_real -- --test-threads=1`
against 3.4, 3.7b and 3.8 with `TETHER_TMUX=/tmp/tether-wrap-build/prefix/3.4/bin/tmux`,
`.../3.7b/bin/tmux`, and `/opt/homebrew/bin/tmux`; plus `cargo test`, `cd web && npm
test`, and a headless xterm check that copy after a snapshot joins a wrapped line. The
existing tests that cover what you change must pass; add a test only where a real-tmux
case for the clamp or the alignment pins behavior no other test does, and say why.
Report: what changed per change, failure modes exercised, verification by tmux version.
