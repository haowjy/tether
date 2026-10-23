# Client architecture revision 4: apply review 3

Revise `.meridian/work/tether-mvp/design/client-architecture.md` per
`design/client-architecture-review-3.md`. Adopt the reviewer's moves:
- **F1 (third round on the PWA update flow):** delete the roll call and build-hash
  tracking; on activation keep the current and previous caches; every page handles
  IndexedDB `versionchange`. Make it the simplest flow that is correct, not a patch.
- **F2:** one sessions-listing fetcher feeding both pruning and Home; reducers pure.
- **F3–F14** as the review proposes (one owner for Files position and for overlays;
  admission logic to `net/admission.ts`, one change channel, no browser-only optional
  methods or public `kind`, an update capability; a push check that preflights a clean
  export of the pushed commit; hot-spot files owned by W0 with an explicit hand-off
  protocol; lint by a rule that actually catches `window.*`/`globalThis.*`/
  `document.*` access, one DOM focus owner; one sizing formula with width; …).
- The snapshot wrap map now stays inside the daemon (the pipeline gets no wrap map);
  fix line ~123. History chunks carry a bitmap the history view uses for copy.
- Tech-lead calls: the phone picker follows the theme; each server's PWA is named
  "tether <host>" (daemon fills the manifest). Closed-tab draft retention stays open
  for Jimmy (proposal: keep, up to 32).
Edit only that file; record dispositions. Report what changed and what's open.
