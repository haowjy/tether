# Verify revision 2 of the client architecture design

`.meridian/work/tether-mvp/design/client-architecture.md` is now revision 2. It answers
`design/client-architecture-review-1.md` and `design/client-architecture-review-alignment.md`;
its "Review disposition" table maps each finding to a section.

1. For every High and Medium finding in both reviews, check the fix in the design actually
   resolves it (read the cited sections against the same sources the reviews used: web/ code,
   xterm 6.0.0 source in web/node_modules, ios-shell.md, daemon-core.md, browser-auth.md rev 4,
   resource-limits.md, plan.md, docs/design/client/*). Mark each: resolved / partially / not.
2. Look for regressions or new contradictions the revision introduced (e.g. the owned-input
   sentinel table, the stable-box rule, cache-first navigation + whole-build precache vs the
   shell budget, the native draft bridge, focus-mode-by-screen, lane ownership).
3. Flag anything an implementer would still have to guess.

Be proportionate: only findings that would cause a wrong build or a blocked lane are High.
Write findings to `.meridian/work/tether-mvp/design/client-architecture-review-2.md`
(verdict first; then per-finding status table; then new findings with severity, location, fix).
Do not edit the design or any source.
