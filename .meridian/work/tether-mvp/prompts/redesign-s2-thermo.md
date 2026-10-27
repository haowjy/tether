# Strict maintainability review: slices 2 and 2b (phone sheet, desktop popover)

Review the frozen export at `/tmp/tether-rev-s2/` (= commit `2bbed88` of
`/Users/jimmyyao/repos/tether`; other writers are editing the live checkout, so read the
export, not the checkout). Commits under review: `c2086d4` (phone bar; one `sessions`
overlay as the half-height sheet), `0d55fbd` (the opener's overlay name chooses sheet or
picker; + acts on the tab's own server), `2bbed88` (desktop + popover via `Dialog
variant="popover"`, `SessionPicks`/`NewActions` shared, WindowsMenu/WindowChoices
deleted). Base `0deedea`. In the repo: `git log -p 0deedea..2bbed88 -- web/`.

Intent: `docs/design/client/browser-behaviors.md` (Session picker and switcher, Window
switcher, Phone dock), `.meridian/work/tether-mvp/redesign/plan.md` D2. Earlier reports:
p335 (correctness), p336 (probe), p338 (writer). Slice 1's structural reviews p330/p333
named a recurring class: one fact copied into two places and trusted (router entry vs
active tab; opener vs form). Look for further instances.

Jimmy's rule: no UI tests; code structure over if statements. Slices next build on this:
3 (keyboard-up dock: resting/typing layouts, key routing), 4 (Home server cards and a
full-height sheet opened from Home as a third overlay name), 7 (bell dot on the
current-tab button, strip tabs and session rows). Flag what would make those harder.

Look at: the `popped` overlay repair in `web/app/router.ts`, `Dialog`'s new variant and
anchor (one primitive or two in one?), `SessionPicks.commit` acting differently per form,
the sheet/popover split, `HostSessionLists`/`SessionList` growth, CSS tokens and module
boundaries (`/react-architecture`), and dead code the three commits left.

Edit nothing. Findings ranked by structural impact with path:line, the cost to the next
change, and the move; say whether it is fit to push as is.
