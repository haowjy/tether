# Real-tmux TUI snapshot test: find the cause and settle it

`tests/tmux_real.rs` `check_restores` (around lines 286–316) asserts that restoring snapshot N
and replaying the bytes after it reproduces snapshot N+1 and the final screen, under a
continuous TUI workload (around 720–760). It fails on tmux 3.4 (11 of 12 focused runs) and
on 3.8, and fails on a clean export of `origin/main` (54abaaf) too, so it predates last night's
wrap commits. A live-output stress test also failed on 3.8 in those runs. Prior reports (read
them; you get p57's transcript via --from):
- `/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p57/report.md`
- `/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p58/report.md`
- `/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p59/report.md`

An uncommitted edit in the primary checkout's `tests/tmux_real.rs` (see `git diff
tests/tmux_real.rs`, origin unknown and unverified) replaces the `look` comparison with
`screen_text`, which compares cell text, cursor and modes but drops all styling, on the
theory that tmux 3.4 doesn't report the current SGR pen, so output replayed after a snapshot
taken mid-style can't carry the right colours. Treat that as a hypothesis. Questions:
1. What exactly differs when the assertion fails? Capture the first mismatching cells and
   their attributes on 3.4, 3.7b and 3.8.
2. Is the pen hypothesis true: is the current pen absent from what tether captures on each
   version, and does that alone explain every failure? If 3.7b/3.8 do expose it and tether
   doesn't use it, that is a product bug, not a test problem.
3. If it is the cause, the edit is broader than the limitation: it also stops checking
   styles of cells already drawn at snapshot time. The right assertion probably excludes
   only what tmux can't report. Judge that.
4. The 3.8 live-output stress failure: same cause or separate?

Then fix what the evidence supports (product code in `src/tmux/` or the test) and say whether
the behaviour broke, the test is stale, or the test asserts something tmux can't provide.

Work in a clean export, not the primary checkout: another coder is mid-edit there on
`src/auth/`, `src/runtime.rs`, `src/config.rs`, `src/http/server.rs`, `src/lib.rs`, and the
tree doesn't compile. `git archive HEAD | tar -x -C /tmp/tether-tui-r2`, then apply the test
diff if you want it (`git diff tests/tmux_real.rs > patch`). Run real tmux only through the
tests' private `-L` sockets; never touch the default tmux server or Jimmy's sessions. Use
`TMPDIR=/tmp/tether-meridian-501` if socket paths get too long. tmux binaries for 3.4, 3.7b
and 3.8: find how prior runs selected them (p58's report).

Deliver your fix as a patch file at `.meridian/work/tether-mvp/evidence/tui-snapshot-fix.patch`
against HEAD (only `tests/` and `src/tmux/` paths), verified by repeated runs on all three
versions (say how many runs and their pass counts). Do not edit or commit in the primary
checkout. Delete your /tmp exports when done.
