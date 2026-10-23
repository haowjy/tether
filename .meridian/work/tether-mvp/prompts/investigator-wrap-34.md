# Find an exact wrap map on tmux 3.4, and build 3.4 and 3.7b to check it

Your earlier analysis (`design/snapshot-wrap.md`) found the fix on 3.7b+ (`capture-pane
-F`'s `W` flag) but none on 3.4, which is what Jimmy's dev server runs, so a 3.7b-only
fix leaves the main deployment broken. Find an exact 3.4 answer.

Candidate to test first: capture the same range twice, physical rows (`-N`, plain, no
`-e`) and joined (`-J`), and align them. Each joined logical line is the concatenation
of consecutive physical rows; a row that wrapped forward is always full width. Check
equality before prefix matching. Work out where alignment is ambiguous (trailing
spaces in wrapped content, wide characters at the right edge, empty continuation rows,
tabs, a logical line crossing the `-S`/`-E` boundary of a history chunk, the alternate
screen) and whether each case is exact, detectably ambiguous (then: no join, never a
wrong join), or wrong. Cost: one extra capture per snapshot and history chunk; say
what it costs in time and bytes on a 200-row chunk. Consider other exact options too.

Build tmux 3.4 and 3.7b from the release tarballs into a scratch prefix (libevent and
ncurses are in Homebrew), and run the probes on both plus 3.8, each on an isolated
`-L tether-wrap-<you>` server with a fresh `TMUX_TMPDIR`. Never touch other sessions.
Keep the binaries' paths in your report: later lanes will reuse them
(`TETHER_TMUX=<path>` runs the real-tmux tests against a given tmux).

Update `.meridian/work/tether-mvp/design/snapshot-wrap.md` with the result and a single
recommended design covering 3.4, 3.7b and 3.8, with spec text for daemon-core.md. If
your filesystem write is refused, put the full text in your report. No source edits.
