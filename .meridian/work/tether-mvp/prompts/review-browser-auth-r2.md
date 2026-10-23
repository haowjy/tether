# Second-round security review of tether's browser auth draft

You reviewed `.meridian/work/tether-mvp/design/browser-auth.md` and returned "approve with changes" (your report is `.meridian/work/tether-mvp/design/browser-auth-review-1.md`). The design lead has revised the draft; its "Review disposition" table maps each of your findings to where it landed. Check:
1. Is each finding actually resolved, or soundly accepted with its reason?
2. Did the fixes introduce new problems?

Pay most attention to these new pieces:
- **H2 static-serving limits.** These include a custom accept loop replacing `axum::serve`, a 24-connection cap covering WebSockets, and a claim that the memory ceiling forces dropping the third control client. Is this the simplest bounded design? Could existing tower or hyper settings get the same bounds without owning an accept loop? Are the numbers coherent with `docs/design/daemon-core.md` §6?
- **D2 option (a):** revoking every browser credential when a sibling service is detected.
- **M3:** the serve-config cache and when it refreshes.
- **M4:** the `unlocked_until` and RP-ID choices.

Edit nothing. Output findings ranked blocker / high / medium / low, each with a scenario and a fix, then a verdict.
