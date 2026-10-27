# Write the redesign into tether's design specs

## Task

Update tether's design docs in `docs/design/` so they state the redesigned client UI as
the current rule, on all three surfaces (iPhone app, phone Safari/PWA, desktop browser),
and log each decision in `docs/design/decisions.md` with the alternatives rejected. This is
design-before-code: no source code changes. Do not commit; leave the changes in the
working tree and report.

## Source of truth for what was decided

Read these first, in order. Later rounds override earlier ones.

- `.meridian/work/tether-mvp/phone-redesign-brief.md`: the direction and every decision,
  round by round, with Jimmy's words quoted. Rounds 5-7 reversed some earlier choices
  (for example, the terminal has no tab strip any more: a current-tab button opens the
  sessions sheet; windows stay inside sessions; the compose box is always visible with the
  keyboard up).
- `.meridian/work/tether-mvp/phone-ux-pass.md`: the issues Jimmy reported (1-12) and
  readings; issue 10 (Files "speaks a different version") is already fixed in e3bc335 and
  needs no spec change beyond what is there.
- `.meridian/work/tether-mvp/phone-redesign-walkthrough-p309.md`: a user walkthrough of
  an earlier mockup; several findings were adopted in Round 5. Use it for edge cases the
  specs must answer (states, gestures, empty states), not as decisions.
- `.meridian/work/tether-mvp/phone-redesign-mockups/*.dc.html` + `canvas.json`: the
  current mockups (static HTML; wrappers import a base file with props). Where the brief
  and a mockup disagree, the brief's latest round wins; flag the disagreement.

## The specs to update (read each before editing; follow `docs/design/AGENTS.md` if any)

- `docs/design/client/browser-behaviors.md`: Platform layout table, Visual treatment
  (theme: System/Light/Dark setting, dark = true-black neutral terminal), Home (now
  server-first; Settings is its own screen behind a gear), Session picker/switcher (the
  sessions sheet: half height over the terminal, full height from Home with a back
  arrow; tabs + `+` at its bottom; bell dots; windows only for multi-window sessions),
  Window switcher, Files (multiple Files tabs, files as tabs, "‹ parent" row, Mermaid),
  Phone dock (bar = current-tab button + keyboard; keyboard-up = compose box always shown,
  idle without caret, text-only key row with hide keyboard; key routing while composing),
  Persistence.
- `docs/design/client/terminal-interaction-design.md`: the dock/line field/key row rules
  and focus cues, where they live; key routing changes (while the box has focus, ← → move
  its caret and esc leaves the box; ↑ ↓ ^R ^C tab etc. go to tmux; Send keeps focus in the
  box; tapping the terminal returns typing to tmux without lowering the keyboard).
- `docs/design/plan.md`: "Tabs and the session sheet", the product/UX summary, the scope
  table (Mermaid moves from v2 into this redesign: lazy, strict, behind DOMPurify), and any
  sentence the redesign makes false.
- `docs/design/auth.md`: the Face ID relock rule (today fixed 5 min) becomes a setting:
  5 min / 1 hour (default) / At launch. Keep the threat-model sentence honest.
- `docs/design/ios-shell.md`: only where it restates dock/keyboard/theme rules; it may
  need the app's appearance setting (the app reports the scheme today from
  `traitCollection.userInterfaceStyle`).
- `docs/design/decisions.md`: one entry per decision (date 2026-10-27, Jimmy), What /
  Why / Rejected, in the file's existing format. Mark entries that reverse an earlier
  logged decision and name it.
- `CHANGELOG.md` gets nothing yet (no user-visible change ships).

## Open items: write them as open, do not decide

- The bell/attention dot depends on a running probe (`.meridian/work/tether-mvp/probe-bell.md`
  will hold findings). Spec the UI intent and mark the mechanism "pending probe".
- Anything the brief leaves open that a spec needs: list it in your report instead of
  inventing a rule.

## How to write

Specs state the current rule only, no history (history goes in decisions.md). Match each
file's existing voice, headings and density; edit in place rather than appending new
sections where a section already covers the topic; delete rules the redesign replaces.
Keep ASCII diagrams in the dock/switcher sections accurate to the new layout. Plain words;
no marketing tone.

## Report

Per file: what changed (sections), what you deleted, and any place the brief, mockups and
existing specs conflicted and how you resolved it. List open questions for the lead.
