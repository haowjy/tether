# Revise the resource-limits spec for its first review and for browser auth rev 4

Revise `.meridian/work/tether-mvp/design/resource-limits.md`. Apply
`design/resource-limits-review-1.md`: H1 (drop MemoryHigh, or set it at budget − 4 MiB
if a soft limit is wanted; say which and why), M1 (refuse uploads to tmpfs/ramfs via
statfs), M2 (pass formula fields and one unit, MiB), M3 (state the CPU wait bound
honestly or shorten the period), M4 (cgroup read from mountinfo, missing/unreadable
memory.max, v1/hybrid not enforced, restart after set-property, macOS has no hard cap),
M5 (exit 78 for every configuration error), M6 (the limit message names the session
holding the slot), S1 (drop the small-slot halving), S2 (completion flag in `welcome`),
and the lows. Then align with browser auth revision 4 (`design/browser-auth.md`,
`browser-auth-rev4-notes.md` lists the stale lines): the daemon listens on a Unix
socket, backlog, the 30 s stall deadline only, whois memory/permits rows. The default
stays 72 MiB (Jimmy). Edit only that file and record each finding's disposition at the
end. Report what changed and anything still open.
