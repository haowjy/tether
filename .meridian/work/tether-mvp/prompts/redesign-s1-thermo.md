# Strict maintainability review: slice 1 of the client redesign, after its fixes

Repo `/Users/jimmyyao/repos/tether`, local commits on main (not pushed): `da1373b`
(Swift stores the saved workspace as raw JSON; one web parser), `450b454` (Files opens as
tabs: one tab model, routes `home | tab`, derived screen, desktop top row), `a484cd1`
(review fixes: tab-scoped Files continuations, per-host listing cache in
`web/files/recent.ts`/`folders.ts`, draft key validation, `lastTerminal` saved, empty
workspace navigates Home, router stack with cursor). Base `093441d`. Review the code as it
stands at HEAD.

Intent: `.meridian/work/tether-mvp/redesign/plan.md` D1 (from structure review p320, which
you may read: `meridian spawn show p320`). Earlier reports on this code: correctness p322
(`/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p322/report.md`), runtime
p324 (`.../p324/report.md`), fixes p325 (`.../p325/report.md`), orphaned-code list p329
(`.../p329/report.md`: fold its stale items into your findings where they matter).

Find the move that makes this code, and what slices 2-7 will build on it, simpler:
duplicated ownership (workspace place vs router record vs `FileBrowser` view vs listing
cache), states that should be unrepresentable, the controller's new Files entry points
(`openFiles`, `openPlace`, `toPlace`, `resolvedPlace`, `shownFiles`), the router's
special cases (stamp, stale skip, overlay base, cursor), the `Folders`/`Recent` caches
(one structure or two? bounded? invalidation complete?), and docs
(`client-architecture.md` §6, `web/AGENTS.md`, `docs/design/`) that would mislead the
next writer. Slice 2 next merges the `picker` and `switcher` overlays into one `sessions`
overlay and builds the phone sheet; flag anything here that would make that harder.

Edit nothing. Report findings ranked by structural impact, each with path:line, why it
costs the next change, and the move. Say clearly whether slice 1 is fit to push as is
with follow-ups, or needs another round first.
