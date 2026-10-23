# Revise the browser auth draft against its security review

Your draft `.meridian/work/tether-mvp/design/browser-auth.md` got "approve with changes" from an independent security review. The full review is in `.meridian/work/tether-mvp/design/browser-auth-review-1.md`. Revise the draft so that every finding is either fixed or explicitly accepted with its reason. Jimmy has not answered D1–D4 yet; keep them as open decisions with your recommendations.

Notes on specific findings:
- **H1.** Rework D2 into an honest choice among: (a) revoke every browser device when a sibling service is detected; (b) a dedicated hostname for tether as the plan of record, with G9 as a ship gate; (c) a warning, with the residual risk accepted. Recommend one. Fix the rationale as the review describes: Origin checks plus fetch metadata stop a sibling *page*; D2 is about a sibling *server* seeing the cookie. Keep L5 (the dev Vite proxy forges the login header) next to it.
- **H2.** This was a gate from the earlier review. Specify static serving with concrete numbers: how the shell is packaged, a concurrency cap or reuse of the fs raw slots, a per-response buffer bound, a header timeout and a slow-client timeout, and a size limit on the shell. Add the row to the daemon-core §6 memory ceiling (it's already about 1 MB over `MemoryMax`, so say what gives), and add a measured probe gate. Ground the numbers in `daemon-core.md` §6 and the existing fs raw limits.
- **M1–M5 and L1–L6.** Apply the review's fixes unless you have a better one; if you deviate, say why. **M4:** name the unlock state and the RP-ID choice now, with the public-HTTPS phase in mind.
- Update the probe gates and acceptance checks as the review lists.

Keep the six-section structure. Add a short "Review disposition" table at the end mapping each finding to fixed or accepted, with the section it landed in. Edit only `browser-auth.md`. No source code, and don't touch live services.
