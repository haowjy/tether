# Revise the browser auth draft against round 2 of its security review

Round 2 returned "request changes": `.meridian/work/tether-mvp/design/browser-auth-review-2.md`. Revise `.meridian/work/tether-mvp/design/browser-auth.md` again. Every round-2 finding (N1–N10) must end up fixed or explicitly accepted with its reason; extend the "Review disposition" table to cover them.

This is probably the last design round before Jimmy decides, so the goal is a draft he can choose from in one sitting:

- **D2 (N1, N2): an honest choice for Jimmy, not a recommendation that oversells.**
  - For each of (a) revoke on detection, (b) a dedicated hostname, (c) a warning: state the residual risk in one plain sentence and the workflow cost in one plain sentence.
  - Apply the narrowing from N2: plain-HTTP entries and TCP forwards without `TerminateTLS` are not siblings.
  - Say concretely where spikes go under each option.
  - If (a) would need a refresh on the 10 s re-check while a browser socket is live, spell out what that costs against the "no polling" rule (one loopback LocalAPI read per 10 s, only while a browser tab is connected) and make it its own sub-decision.
  - Recommend if you still have a recommendation, but the costs come first.
- **Static shell (N3–N5, N10): one redesign of the bounding scheme, not three patches.**
  - The accept cap is a backstop that normal bursts never reach.
  - Per-route caps answer 503 immediately, with waiters bounded by count, not time.
  - The shell is precompressed.
  - The accounting rule for reclaimable pages is stated, and G12's pass rule is written down.
  - Decide between the `Listener`-wrapper cap and an owned accept loop using the review's analysis. If you own the loop, specify `ConnectInfo`, `small_buffers`, graceful shutdown and the 4004 semantics. Pick the simplest design that holds the bounds.
  - Redo the memory ceiling. Restate clearly whether the third control client still has to go; that remains Jimmy's call, so make it a numbered decision with the numbers.
- **N6–N9:** apply the review's fixes or better ones.

Keep the six-section structure, and keep §1's summary readable in a minute. Put every open decision for Jimmy in §2's table with your recommended answer: D1–D4, plus any new ones. Edit only `browser-auth.md`. No source code, and don't touch live services.
