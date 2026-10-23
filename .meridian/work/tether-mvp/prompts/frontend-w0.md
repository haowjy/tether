# W0: delete the old web UI and build the client skeleton and design system

You are lane W0 of the web rebuild. The settled design is
`.meridian/work/tether-mvp/design/client-architecture.md` (rev 4): read §1, §3 (what
survives, the new layout, lint rules), §4 (boot, admission, Enrol), §5 (platform
adapter), §6 (workspace core, restore, the sessions listing, refusals and limits, focus,
routes), §8 (design system: owned primitives on native HTML, three token tiers, fonts and
the shell budget, mockup improvements, the copy rule), and §11's W0 row and hand-off
protocol. The contract it implements: `docs/design/client/browser-behaviors.md` and the
mockup `docs/design/client/mockups/index.html` (approved layout; §8.5 lists improvements
Jimmy invited). Jimmy's fixed choices: no Files in `+`, no intermediate menu, no dot
markers or separators, no custom browser keyboard strip, draft Insert sends no Enter.

Deliver the W0 row of §11 exactly: the deletions; every shared file; the platform
interface and the browser and test implementations; `net/admission.ts`; the workspace
core with restore and pruning; the single listing fetcher; persist; the router; the focus
controller; `useApp()`; tokens and every primitive with CSS modules; stub screens on
their routes; the Enrol screen; font subsets with the script that makes them; budgets
enforced on the build; the lint rules each proven by a seeded violation; Playwright and
axe installed; `scripts/preflight.sh --commit <sha>` (clean export) and the pre-push hook
using it; one stub per lane (`sw/vite-plugin.ts`, `platform/browser/pwa.ts`,
`harness/<lane>/index.ts`). The daemon's auth routes (`/auth/info`, `/auth/node/*`) don't
exist yet: the `test` adapter fakes them so the real `net/admission.ts` runs.

Constraints: another agent is fixing daemon code now and edits `web/tabs/driver.ts` and
regenerates `web/proto/generated/`; don't edit those (keep `tabs/` as the spec says).
Keep the UI-free core and its tests green. Use the project's patterns; delete what you
replace, no compatibility layers. Never type into real tmux sessions; nothing you run
should start one. Commit your work as coherent commits by explicit pathspec (e.g.
deletions + skeleton, design system, screens/stubs + harness, checks), each passing
`scripts/preflight.sh full` on a clean export of the commit, messages ending
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push. Record any
departure from the spec in a short list in your report, and any mockup departure for
decisions.md. Verify: unit tests named in §11, lint seeded violations, Playwright over
every route in both layouts, themes and densities, budgets; take screenshots of each
route in both layouts into `.meridian/work/tether-mvp/evidence/w0/`. Report commits,
verification, departures, and what the next lanes should know.
