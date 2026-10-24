Review an uncommitted design change in /Users/jimmyyao/repos/tether: the phone input redesign ("phone dock"). Read-only: report findings, edit nothing.

Source of truth for intent: .meridian/work/tether-mvp/phone-input-decisions.md (Jimmy's settled calls). The design changes are in the working tree (`git diff` and `git status`):
- docs/design/client/browser-behaviors.md (new "Phone dock" section), docs/design/client/terminal-interaction-design.md, docs/design/plan.md, docs/design/ios-shell.md (line-field lending, focus table, device checklist), docs/design/decisions.md (new entries at the end), docs/design/client/README.md, browser-setup.md, auth.md
- .meridian/work/tether-mvp/design/client-architecture.md (§1, §2, §5.3, §5.4, §5.6, §5.8, §5.9, §5.10, §6.5, §7.1, §7.3, §7.4, §7.6, §11 P3a/P3b rows, §12, §14)
- docs/design/client/mockups/index.html (mobile/native terminal shows the dock; open it in a browser if useful)
- deleted: ios/spikes/keyboard/, docs/design/spike-1-keyboard.md

Check:
1. Alignment: every Jimmy decision is stated as the current rule, consistently, in every spec; no spec still says a terminal tap focuses/raises the keyboard, that there is no custom key strip, a multiline draft editor, Insert-without-Enter, compose, an accessory key row, or a hide key. Specs should state current rules only (history belongs in decisions.md).
2. Correctness and edge cases of the design: the focus owner model (terminal input vs line field vs none) and the toggle; key-row routing; armed modifiers across three sources; Return = paste then Enter (and its interaction with L4 acks); per-tab drafts; tmux sizing with the dock (stable box), pan area; Safari form accessory bar; hardware keyboard.
3. Native feasibility risks: lending first responder to WebKit by touch location (passive recognizer + guard), removing WKWebView's form accessory bar, restore rules, `focus hidden` from the line field. Say what is plausible vs likely to fail on iOS 26, and whether the device checklist covers it.
4. Implementability of the P3a/P3b rows in client-architecture.md §11 against the existing web code under web/ (app/focus.ts, platform/types.ts, screens/terminal/, tabs/keymap.ts): missing pieces, ownership conflicts, file names that don't fit.
5. Dangling references (anchors, file paths) from the deletions and renames.

Report findings ranked by severity with file:line and a concrete fix for each.
