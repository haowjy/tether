# Browser auth revision 5: apply review 4

Revise `.meridian/work/tether-mvp/design/browser-auth.md` per
`design/browser-auth-review-4.md`. Tech-lead decisions:
- **D1: the Unix socket stays.** Minimum Tailscale 1.100. Accept and state the cost:
  every later `tailscale serve` change on the box needs sudo, and another Unix user
  needs root once to publish their own tether. Claim the upside: only root can re-point
  Serve or add a handler beside tether. Root and the Tailscale operator are trusted.
- **H1:** check `X-Forwarded-Host`; require `Host: localhost` from tailscaled; drop the
  DNS-rebinding rationale. **H2:** tether must be the only handler in its Serve entry;
  the daemon checks the serve config when a browser request needs it (at most every
  10 s) and in the socket re-check; delete `browser_origin` and the refusal reasons it
  made unnecessary. This concern has now recurred three times — read security state
  when it is used — so make that the rule for every such check in the doc, not a patch
  to this one. **H3:** `flock` a lock file before unlink+bind; pastes in `paste/`.
- **M2:** choose the admission lane by the socket a connection arrived on, not by uid.
- All lows (L1–L5), including the upgrade path from today's TCP publication and the
  code the change leaves unused.
- D2 (enrolled node trusted whole) and D3 ("Remove this device") are accepted by the
  tech lead; move them to "settled". Align with `design/resource-limits.md` rev 2
  (accept loop §3.7 lives there now; don't duplicate it — reference it).
State current rules only; record dispositions in the table. Edit only that file and
the notes file. Report what changed and anything still open.
