# Clean up docs/design/decisions.md

## Task

`docs/design/decisions.md` is 5,071 lines and 273 entries. Jimmy: "I think there's a
lot of stuff in there that doesn't matter." Make it a log of the decisions that still
matter, so a cold reader (a tech lead about to build the client redesign, a reviewer)
can find why the current rules are what they are.

## What stays

An entry stays when a reader could get the current rule wrong without its reasoning:

- a product call by Jimmy (keep his quoted words);
- a tradeoff between real alternatives, with why the rejected ones lost;
- a constraint from an external fact (tmux, WebKit, iOS, Tailscale behavior), with the
  evidence that settled it.

## What goes

- **Replaced decisions.** When a later entry fully replaces an earlier one, delete the
  earlier entry. If its option is still worth knowing, add it to the survivor's
  "Rejected" list in one line, and keep any reason from it that still explains the
  current rule. When a later entry replaces only part of an earlier one, edit the
  earlier one down to what still holds and drop the "supersedes in part" cross-talk.
- **Bookkeeping:** review-fix lists, build rounds ("G2 fixes", "W0 refinements"),
  code-organisation trivia with no alternative worth knowing (helper placement, one-off
  refactors), and entries that only restate a spec.
- **Provenance noise:** spawn ids (p7, p25...), commit hashes, review-round numbering,
  and the "Who decides" paragraph's list of spawns. Keep who decided (Jimmy, tech lead,
  design) and the date.
- Repetition: merge entries that decide the same thing.

Change the header's rule "A later entry that changes an earlier one says so; the earlier
one keeps its text" to: the log holds the decisions in force; a decision that replaces
another removes it, naming the old option under Rejected; git history keeps removed
text.

## Constraints

- Do not change any decision's substance, and do not invent reasons. When unsure whether
  an entry still matters, keep it and list it in your report.
- Every 2026-10-27 entry (the client redesign, at the end) stays; it is current.
- Keep the file's entry format (Decided / What / Why / Rejected) and section grouping;
  regroup only where a section is now nearly empty.
- Other docs link to headings in this file. After editing, run
  `meridian kg check docs/design --strict` and fix every broken link in other docs
  (point it at the surviving entry), plus `grep -rn "decisions.md#" docs AGENTS.md`.
- Edit only `docs/design/decisions.md` and links to it. Commit on `main` with a message
  ending in the two attribution lines below; do not push.

    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_013DrQ9AvNXvtKuoUR2cLkki

## Report

Write `.meridian/work/tether-mvp/decisions-cleanup.md`: line and entry counts before
and after; every removed or merged heading with a one-line reason and, for merges,
where its content went; entries you were unsure about and kept. Return its summary.
