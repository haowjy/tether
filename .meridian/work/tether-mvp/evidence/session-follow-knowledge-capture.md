# Session-follow knowledge capture (post-dev)

Nothing committed. The lead commits these with the source once the final gates pass.

## Updated

- `.meridian/kb/client-design-handoff.md`: a tab is a session, and input goes to the
  window the tab showed when the input started. The stale "desktop `+` opens windows;
  windows are created on Home" bullet is replaced (`+` opens sessions only, and the
  active pill's windows menu creates windows). Two new gates: the tmux version for
  daily use (issue #2, Jimmy's call) and the dev-box resource budget (the Docker proxy
  showed about 6.3 MiB idle RSS against the plan's approximate 5 MB).
- `.meridian/kb/probe-environments.md`: the upstream crash on 3.4 and 3.7b
  (`select-window` plus `kill-session` in one command list), with two rules: never
  combine those commands in one list, and leave the installed tmux alone.
- `.meridian/kb/reviews.md` (new) and `index.md`: Opus reviewers (Jimmy's words with
  his hedges kept, limited to reviewing, direction and cutting, so no ban on Astra
  elsewhere), "use ur judgement" triage of findings, and "Temporary verification only"
  limited to session-follow.
- `src/hub/AGENTS.md` (colocated gap): it didn't mention `view.rs`. Without that, a
  cold agent could set selection or window fields from a handler, which is the
  scattered-transition bug p237 and p246 found. The new rule: `View` owns the
  transitions, the claim stores no window, `retarget` is the only path, and cwd lives
  in `tmux::Session`.
- `docs/design/decisions.md`: the 2026-10-25 "A claim names a window…" entry still
  defined a claim as (watch, window) and ended `selecting` at any `CurrentWindow`.
  Both entries now carry "superseded in part" lines that link each other.

## Not needed

daemon-core.md, ios-shell.md, browser-behaviors.md, plan.md, web/AGENTS.md, the
terminal `.context/CONTEXT.md` and the client-architecture banner already state the
current rules. The tmux crash is in daemon-core risk 4. The KB links to these instead
of copying them.

## Corrections

No new register entry. The Opus message (c235 entry 74 and 76) came while every
reviewer was already on Opus, so it states a preference and corrects no mistake. "Temporary
verification only" answered a question. Neither shows a repeated class, and nothing
is ready for `/correct`.

## Cold-reader findings

Two readers: p256 (KB) and p257 (hub AGENTS.md and decisions). Accepted: say which
parts of the old claim entry are superseded; define "one command list"; say what the
RSS number measured; drop the "work directory" pointer and say who to ask in
reviews.md. Rejected:
- Asked to define vocabulary the daemon-core glossary owns (vote, take, `Acted`,
  `watching`, group, Locate, slot, lingering) and the dock's UI terms: the pages
  don't owe that detail.
- Pre-existing text these changes didn't touch (hub credit and timer rules, auth
  gates, TMPDIR path).
- "Duplicate heading" and "built vs unverified contradiction": no such duplicate
  exists, and the intro says what is tested where.

## Validation

`meridian kg check kb` is clean (8 files), and so are `src/hub/AGENTS.md` and
`docs/design/decisions.md`. No diagrams were changed.
