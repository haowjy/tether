# Review browser auth revision 5

Review `.meridian/work/tether-mvp/design/browser-auth.md` rev 5 and
`browser-auth-rev4-notes.md` against `browser-auth-review-4.md`: did each finding's fix
hold, and is the result simpler or more complicated than it needs to be? New in rev 5
and unreviewed: the "read security state when used" rule and its table (§3.3), two
sockets (`serve.sock` for tailscaled with node + native lanes, `local.sock` native only),
the startup order with `flock`, the version gate (Tailscale ≥ 1.100), the upgrade path
from today's TCP publication, and native now depending on LocalAPI `/status`.
Requirements: tailnet now; public HTTPS later without redesign; several Unix users;
several revocable devices; room for guests; unlocked-device risk accepted. Check
Tailscale claims against source (a clone may be at `/tmp/tsrc/`). Severity per finding;
write `design/browser-auth-review-5.md` (or the report). No other edits.
