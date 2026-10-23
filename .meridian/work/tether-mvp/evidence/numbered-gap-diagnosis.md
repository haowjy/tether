# Numbered-line gaps on tmux 3.8

## Conclusion

The missing line is already absent from the tmux control client's stdout. The test collector, `Session`/parser, and pump do not introduce the gap. The defect is upstream of tether, at or before tmux emits control-mode pane output; this run did not distinguish tmux's pane-output ingestion from its control-mode output queue. No local production fix is supported: tether cannot forward bytes that are absent from the subprocess stdout. I did not weaken the test or make a speculative patch. A follow-up against tmux (or a targeted tmux-side repro) is needed before a product fix can be chosen.

## Reproduction and boundary evidence

- Clean `git archive HEAD` export at `/tmp/p65-investigator`, HEAD `f097f42d86e0658560403ed138c95f15d746d8d4`; tmux `/opt/homebrew/bin/tmux` reports 3.8. Only the test's private `-L tether-test-<pid>-...` server was used; `TMPDIR=/tmp/tether-meridian-501`.
- The uninstrumented focused `numbered_lines_at_full_speed_cross_every_snapshot_boundary_once` reproduced the assertion on 3 of 6 diagnostic runs (the other 3 passed). Failures had 1.17 MB, 1.18 MB and 0.87 MB of `Event::Output` bytes. Each failure had **no `Event::Gap`**.
- On two further failures, I captured the complete raw `PumpMsg::Bytes` input into a test-local vector (dumped only on failure). On a subsequent failure I also saved the concatenated event bytes. Decoding each `%output` / `%extended-output` payload and concatenating it showed byte-for-byte equality with `Event::Output` (both were 638,640 bytes in that captured failure). The exact same numbered gaps were present in both: e.g. `L1784 → L1786`, `L2460 → L2462`, and `L3321 → L3323`. This is raw tmux subprocess stdout, before parsing; the pattern also appeared in raw control output where a line was split across adjacent `%extended-output` frames, so the comparison decodes each frame before extracting numbers.
- `tests/tmux_real.rs:69–124` collects pump messages; `Client::next` passes their bytes to `Session::feed` and `Client::apply` appends all `Event::Output` bytes. `src/tmux/pump.rs:138–181` forwards each stdout read via awaited channel send, with no drop path on a successful send. `src/tmux/parse.rs:74–100,119–123` assembles protocol lines and decodes octal output; `src/tmux/session.rs:256–272` emits pane output unchanged for wanted panes. These layers agree with raw stdout.
- `tests/tmux_real.rs:262–283` builds `output` by appending every matching event's bytes; it has no bounded output collector. The `TrySendError` handling at `tests/tmux_real.rs:82–90` is for commands sent **to** the pump, not incoming pane output; `Full` panics, and `Closed` means the pump is ending. The test does not instantiate the hub, so hub output/outbox code is not in this repro path.
- The test's current global continuity assertion is at `tests/tmux_real.rs:496`; the source's command loop is `NUMBERED` at `tests/tmux_real.rs:595` and the failing test is at `tests/tmux_real.rs:791–813` (HEAD line numbers). The assertion observes real missing bytes, not an offset or snapshot-boundary arithmetic error.

## User impact and disposition

For a tether client consuming `Event::Output`, the missing bytes are unavailable and no `Gap` warns that they were omitted. A later snapshot can restore the pane's current screen/history state, but this repro does not prove that every transient line remains recoverable after scrollback advances. So this is not safely dismissible as a test-only collection bug. The test remains useful as a detector; making it pass by removing the stream-continuity assertion would hide missing control output.

No `.patch` was produced: a local pump/parser/session change cannot reconstruct absent tmux stdout, and a test-only relaxation would conceal the observed loss. The clean export and failure captures were temporary and removed. The primary checkout was not edited.

## Structural note

This bridge has no independent completeness signal when tmux silently omits data: only tmux's explicit `%pause` becomes `Event::Gap`. Because this test bypasses the hub, there is no queue/outbox path to blame or alter. Any recovery policy beyond tmux's explicit flow-control notices needs a separate design decision; it is not justified by this evidence alone.
