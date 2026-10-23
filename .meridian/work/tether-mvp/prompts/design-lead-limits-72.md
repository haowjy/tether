# Set the default memory budget to 72 MiB in the resource-limits spec

Edit `.meridian/work/tether-mvp/design/resource-limits.md` only. Jimmy chose the
default `memory_budget_mib = 72` (3 tmux sessions at once) over the draft's 64. Make
the spec consistent with that everywhere: the summary, tier table emphasis, the unit's
`MemoryMax`/`MemoryHigh` proposal (MemoryHigh = three quarters), running.md text, the
decisions.md entry (record 64/2-at-once as the rejected alternative with its reason:
tmux and its processes run outside the unit, so a higher cap costs only tether's own
ceiling), and the browser-auth D6 answer (now: keep 3). Check every derived number
that depends on the default. Note: the browser auth design is being revised to admit
enrolled tailnet nodes instead of a cookie; the accept-loop and static-shell rows stay.
Report what you changed and anything that no longer adds up.
