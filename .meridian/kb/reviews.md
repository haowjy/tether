# Reviews: who reviews, and what a finding is worth

Root `AGENTS.md` requires a review of each subsystem's design and code before moving
on. This page records how Jimmy wants those reviews run.

## Reviewers run on Opus

Jimmy: "make sure to use opus reviewers instead of astra reviewers..." and "i consider
oppus better at direction setting... and cutting stuff". Launch reviewers on Opus, and
above all the ones judging structure, direction, or what to delete. The `reviewer`
profile in `.mars/agents/` already defaults to Opus, so the risk is overriding it with
`-m`. This is Jimmy's preference for reviewing. It says nothing about which model
other roles use.

## A finding is a claim to check

Jimmy, authorizing review fixes: "use ur judgement if u think stuff are actually
issues". The lead checks each finding against the code before acting on it, applies
the real ones, and writes down the reason for each it rejects. A reviewer's suggested
code is a proposal; the lead can fix the same defect a different way.

## Ask before keeping new regression tests

Asked whether to keep a small set of new regression tests for session-follow's
window-switch races and session and bridge contracts, Jimmy chose "Temporary
verification only" (`docs/design/decisions.md`, "New session-follow checks are
temporary verification"). The checks ran, their results were written up as
evidence, and the checks were deleted; existing tests whose behavior changed were
migrated. The ruling covers session-follow. For other work, ask Jimmy before keeping
a new regression suite.
