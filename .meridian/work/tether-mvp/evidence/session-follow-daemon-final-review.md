# Session-follow daemon: final structural/correctness review (round 3)

Reviewed: dirty `main` on 3821927 (src/hub, src/tmux, src/proto, daemon-core.md,
decisions.md, CHANGELOG). Read-only; scratch repros ran in an rsync copy
(/tmp/rev3-sf, deleted). No tests retained.

## Verdict: approve with notes (no blocking defect, no further claim-model fix)

`View` (src/hub/view.rs) is the single owner of shown metadata, observed `next`,
selection and claim. Target is derived (`target()`), every transition goes through
`retarget`, claims hold watch + take only. The p242 model holds; the next change has one
place to edit. No frame-rot signal.

## Prior findings
- p246 F1 (2nd pre-bind CurrentWindow drops claim): FIXED, view.rs `target()` ignores
  `next` until `shown` exists.
- p246 F2 (stale cwd): FIXED. View.cwd gone; `tell` reads `Session::cwd(shown.id)`.
  Scratch: bound @0 cwd /old; CW@1, CW@2, CW@1 before L1 answers; L1 ignored (needed),
  w1 subscribed+acked, w1 value `/new` lands before L2; final watching = @1 cwd "/new",
  no interim /old or null. The early-path ordering holds by construction.
- p246 note (silent first `c` value): FIXED; first value emits; hub ignores the redundant one.
- p237 #1/#2/#5/#6: still fixed (code read; p246 repros not re-run).

## Findings (all Low; none block)
1. Duplicated claim/vote policy. requests.rs `input` (l.325-355) and `paste`
   (l.390-420) copy the same target check, vote_plan, room_for, claim, record_vote
   block. reconcile.rs `subscribe_and_vote` builds `Vote{..}` + `Op::Vote` inline,
   duplicating `record_vote`. Fix: one `State` method for "claiming act on window"
   returning the extra group count, and reconcile calls `record_vote`.
2. Dead code from p247 cleanup: `tmux::fake::Command::SelectWindow` (fake.rs:20-24,
   59-70) is parsed but nothing matches it (fake_hub falls to "unmodeled command").
   Delete the variant and its arm.
3. Payload nothing reads: `Event::Cwd.path` is unused in production (state.rs:462
   matches `..`, reads Session::cwd). Only tests and the fixture recorder read it.
   Optional: make it `Cwd { window }`.
4. Stale comment: session.rs:642 "The initial c subscription compares against the
   window the client attached to": nothing sets current_window at startup, and the
   first value is reported. Delete or reword it.
5. Nits: `View::located` returns (bool,bool) that its only caller ORs; `targeted()`
   then `yield_if` checks target twice; `Told` repeats ShownWindow's fields.

## Verified edge, spec-consistent (no action)
Crash respawn keeps `shown`, so target exists while Orphaned/Locating (§4.2 "keeps its
claim when respawned"). Scratch: laptop switches @0->@1 during the respawn delay and a
new tab watches. The new owner sends take+vote for @0 before Locate, then the first `c`
value @1 drops the claim, so the new tab is unclaimed until its next act. Consistent with
decisions.md ("Before first binding") and the §3.6 take caveat. It needs a crash plus a
window change in the gap. If it ever matters, fold `shown` into `ViewPhase::Bound`,
not a local patch.

## Checked, no issue
Input goes to the window the client named; it claims only on target, its take group goes
before the input, and busy refusal is atomic. No per-key take: vote_plan takes only when
due. Each view has <=3 subscriptions; votes clear when unclaimed; `selecting` always
settles (reply / failure / settle on exit). Created.window is kept and claims via
`View::created`. Close, respawn and session-gone leave no selecting/vote ghost. The
hot output path (owned_pane scan) is the same as before. CHANGELOG is deduplicated and
states the protocol/workspace incompatibility. Upstream crash p244 / issue #2 is out
of scope.
