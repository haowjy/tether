# Cold-reader review: `docs/design/setup.md` and `docs/running.md`

Read these two documents as someone who has never seen tether's design conversation, in /Users/jimmyyao/repos/tether:
1. `docs/design/setup.md`: a design spec for an implementer who will build `tether setup` and `tether teardown`. Can they build it from this without guessing? What is ambiguous, unexplained, or contradicted?
2. `docs/running.md`: the user guide; `tether setup` is now the primary path ("Set it up"), and the old manual steps moved to "Manual setup" at the end. Jimmy (the only user) reads it to install and operate tether on his Linux dev box and his Mac. Does the answer come first? Is anything stale (refers to removed sections, old commands as the primary path, contradictions between sections)? Are any pieces of the old guide lost that a reader still needs? `git diff docs/running.md` shows what moved.

Judge the information hierarchy (answer first, depth later), terms used before they're defined, conversational bleed (references to discussions the reader never saw), and sentences that don't earn their place. Don't edit files. Report findings with severity and location and a concrete rewrite where useful.
