# Review the client architecture spec, revision 3

Review `.meridian/work/tether-mvp/design/client-architecture.md` (rev 3) before the web
rebuild starts. Earlier rounds: `client-architecture-review-1.md`,
`client-architecture-review-alignment.md`, `client-architecture-review-2.md`; check
their fixes held and tell recurring concerns from new ones. Contract it must honour:
`docs/design/client/browser-behaviors.md`, the mockup, `terminal-interaction-design.md`,
`browser-setup.md`; auth it depends on: `design/browser-auth.md` rev 4; limits:
`design/resource-limits.md`. Code: `web/`.

Judge whether this is a codebase another developer would want to build on: module
boundaries, the platform adapter's size and shape (one interface for many concerns —
deep or a grab bag?), state ownership, the owned-primitives design system versus a
library, the lint rules, bundle budget (today 5.1 MB vs a 3 MiB shell cap), the phone
input path, PWA update flow, and whether the lane plan really gives disjoint
directories in one checkout. Severity per finding; write to
`design/client-architecture-review-3.md` (or the report). Edit nothing else.
