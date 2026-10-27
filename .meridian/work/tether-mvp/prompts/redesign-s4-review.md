# Review slice 4 of the client redesign (`ca0d42f`, `40d8bab`)

Read the frozen export `/tmp/tether-rev-s4/` (= `40d8bab` of
`/Users/jimmyyao/repos/tether`; another writer edits the live checkout). Diffs:
`git log -p f141158..40d8bab` in the repo.

`ca0d42f`: enabling refactors from strict review p342 (Picker mounted in Shell with the
anchor from the focus registry; one anchored dialog for menus; `rowOf` row state;
`NewActions(host)` as the one New session / Browse files renderer; discriminated
`Dialog` variants). `40d8bab`: Home as one `ServerCard` per host with every state; the
full-height sheet `{sessions, server, {host}}` (a `page` dialog, closes then acts);
Settings as a `page` overlay behind a gear; deletions (OpenTabs, Home search, the
`homeSearch` focus target). Writer's report: `meridian spawn show p345`. p342's report:
`/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p342/report.md`.

Intent: `docs/design/client/browser-behaviors.md` (Product boundaries, Visual treatment,
Home, Session picker ... Phone), `.meridian/work/tether-mvp/redesign/plan.md` D2. Jimmy:
no UI tests; code structure over if statements.

Two lanes in one report:
1. **Correctness**: every Home state and its transitions (offline → live, listing
   failure → retry, tmux exits, a server removed, restored tabs "Checking…" /
   "Reconnecting…"); Back/Escape from the full sheet and Settings, and after a row tap;
   focus return to the gear and rows; the browser stays bound to its origin (no Add
   server, no second host); Remove this device only where the host admits a tailnet
   node; Clear local data clears drafts and the saved workspace only; `reachedAt`
   in-memory is honest in its copy; listing fetched once per open, none per keystroke.
2. **Strict maintainability** (`/thermo-nuclear-review`, `/react-architecture`): did p342's
   moves land as structure; one fact in two places (the recurring class in this work);
   Dialog's variant count (dialog, sheet, popover, page: one primitive or a family that
   should split?); card state as one derived value or flags; tokens vs raw values;
   dead code left; what slice 5 (appearance, text size, relock in Settings) and slice 7
   (bell dot on rows and cards) land on.

Edit nothing. Findings ranked by severity with path:line, a concrete failure or cost, and
the structural move. Say whether it is fit to push.
