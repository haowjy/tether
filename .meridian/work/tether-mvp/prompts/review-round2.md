# Review: round 2 of the session-follow / sizing design (alignment + correctness)

Review the uncommitted changes under `docs/design/` (diff against HEAD; round 1 of this
design is also uncommitted, and was reviewed by p226/p227/p228, so focus on what round 2
changed, but flag anything in round 1 that round 2 makes wrong). This is the last design
round before implementation: report what would make an implementer build the wrong
thing. Write no files; report findings with severity, file:line and a concrete fix.

## What round 2 set out to do (the requirements to check alignment against)

1. **Jimmy's sizing requirement** (`.meridian/work/tether-mvp/real-use-decisions.md` item
   10 and item 2): typing, pasting or Fit in tether takes the window to tether's size
   even when the laptop is smaller; laptop typing takes it back; the band "Sized for
   another terminal" + Fit shows whenever tmux's size differs from tether's (not only
   when larger), nothing when tether holds it. Mechanism mandated: same-session
   `switch-client -c <owner> -t <session>` serialized before the claiming command; no
   `resize-window`, no `send-keys -K`; side effects (session activity/last-attached,
   key-table reset) accounted for, and its interaction with the per-session owner and
   `selecting`. Evidence: `docs/design/research/probe-latest-client.md` (p225),
   `docs/design/research/probe-session-follow.md` §8-16 (p231, p232),
   `.meridian/work/tether-mvp/window-size-investigation.md` (p216: why tests missed it).
2. **Review p228's findings N1-N7** (see `meridian spawn show p228`): the current-window
   check moved to a per-owner `c::#{window_id}` subscription, `#{window_active}` dropped
   from `w<W>`, with the entry saying why this doesn't reopen the rejected session-scoped
   subscription; when `selecting` clears; §7 rows; the paste claim condition; one drafts
   rule (drop at boot); `Changed` notes on superseded decisions; tests for swap-window and
   both selection orders.
3. **Jimmy's answers** (real-use-decisions.md items 6-9): all four recommendations accepted
   (laptop moves with a tether window selection; path field replaces Add folder, no
   "pending" marker left; desktop windows button on one-window sessions; window name in
   the tab label always), with tab labels following the no-dot/no-separator copy rule
   (`docs/design/client/browser-behaviors.md` "Visual copy rule").

## Where to look

- `docs/design/daemon-core.md`: §1 vocabulary (take), §3.1 startup line, §3.3
  notifications (`%session-changed`, `%client-session-changed`, `Layout` window size),
  §3.4 ops (`Vote { take }`, `SelectWindow`), §3.6 Sizing (the take, ordering, costs),
  §3.7 current-window subscription, §3.9, §4.1, §4.4, §5.3 (`ShownWindow.size`,
  `watching`), §7, §8, §9.
- `docs/design/decisions.md`: the two new entries at the end ("tether takes tmux's
  `latest`…", "The band shows whenever…"), `Changed 2026-10-25` notes, and the edited
  2026-10-25 entries.
- `docs/design/client/browser-behaviors.md` (the sizing/band bullet in Terminal, tab
  labels, windows button), `docs/design/plan.md` (tmux bullet).

## Risks I want checked (not an exhaustive list)

- Is "take with every vote on a window with no applied vote, plus every Fit" sufficient
  for every claiming act to end at tether's size? Walk: watch open, typing after a yield,
  typing while a laptop act is unreported, Fit, rotation, `selectWindow` (both orders of
  a laptop `CurrentWindow` vs the group's reply), `newWindow` with a watch, owner
  respawn, two watches on one window, a window linked into two watched sessions.
- The `%session-changed` own-session rule vs the `detach-on-destroy off` path and the
  `SessionChanged` hub test; does anything else in the spec still treat every
  `%session-changed` as a move?
- What the window does when a claim ends without a yield (the owner stays `latest`), and
  whether the spec states the user-visible consequence consistently (daemon-core §3.6,
  browser-behaviors, decisions).
- The band rule's data: is window size available everywhere the client needs it
  (Locate, `%layout-change` root, zoomed panes, `watching` re-send), and is the 1 s rule
  well-defined against a claim's resize in flight?
- Ordering claim: "a claiming input writes its take-and-vote group before its own" vs
  §4.4's reconcile-at-end-of-handle and capacity rules: implementable as written?
- Leftover text anywhere in docs/design/ (outside research/) still saying a vote only
  caps, tether can't be `latest`, the band shows only when larger, or a smaller window
  has no band.
