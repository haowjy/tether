# Review: "window size follows the client that acted last" (design docs, uncommitted)

Jimmy decided (2026-10-24): "just whoever has the last focus gets the focus and the size of
the screen" — tmux's `window-size latest` semantics, replacing tether's rule where a phone's
per-window size vote capped a watched window even when the laptop was `latest`.

A design spawn changed these docs (working tree, uncommitted; other agents have unrelated
uncommitted edits in src/, web/ and other files — ignore those):
- docs/design/daemon-core.md: glossary (claim, window subscription), §3.3 notifications,
  §3.4 Subscribe row, §3.6 Sizing (rewritten), §3.7 Window subscription (rewritten, renamed
  from "cwd subscription"), §3.9 Event::Acted, §4.1 state, §4.2 items 7-8, §4.4 desired state,
  §5.3 watch/resize/input/paste rows, §7 failure table, §8 tests, §9 risks 2 and 8.
- docs/design/research/probe-latest-activity.md (new: probe evidence on tmux 3.4 and 3.7b)
- docs/design/decisions.md: new section at the end
- docs/design/plan.md (product rule, Still open), complete.md (anchor), ios-shell.md (sizing line)
- docs/design/client/browser-behaviors.md (Terminal bullet)
- .meridian/work/tether-mvp/design/client-architecture.md §5.4 (pane at tmux's size, Fit band), §2, §8.2
- .meridian/work/tether-mvp/build-plan.md (lane PS under P3)
Use `git diff` on those paths to see the change.

Review for correctness and edge cases, and for coverage of the decision. Risks to check, beside
whatever else you find:
- Does the claim/yield rule actually deliver "whoever acted last gets the size" given tmux's
  real rules (resize.c `clients_calculate_size`, server-client.c `server_client_update_latest`;
  tmux source is at /tmp/tether-meridian-501/tmuxsrc/src, tags 3.4 and 3.7b fetched; built
  binaries at /tmp/tether-meridian-501/tmux-bin/{3.4,3.7b}/tmux if you want to check something)?
  Interleavings: phone claim vs a laptop act reported late; laptop switching away from and back
  to the window; laptop on another session; a second tether connection; window moved to another
  session (owner changes, subscription re-baselined); control client crash/respawn; reconnect.
- The subscription format and the Session's "new entry" rule: false acts or missed acts?
- Does anything in the hub's existing state machine (§4) conflict, e.g. votes recorded as
  applied per client, reconcile ordering, ClearVote when the claim moves between watches?
- The client display rule: is it implementable against the stated sizing invariant (§5.4: sizer
  never fed by display; keyboard never resizes; resting dock row in the sized area) and the
  gesture rules (§7.6)? Does the band rule (wider/taller than the tab's own size) hold?
- Do the docs agree with each other (one name per concept: claim/yield vs the existing
  `Release` op; "cwd subscription" leftovers; anchors)? Anything left that still states the old
  cap rule?
- Resource/limits docs (daemon-core §6) unaffected?

Write your findings to .meridian/work/tether-mvp/design/review-window-size-latest.md with
severity (high/medium/low), each with the failing scenario and a proposed fix. Do not edit
the design docs themselves.
