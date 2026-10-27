# Structure review: the client redesign build plan, against the code it lands in

Review `/Users/jimmyyao/repos/tether/.meridian/work/tether-mvp/redesign/plan.md` before
any code is written. It orders a large redesign of tether's web client (`web/`, Preact,
shared by desktop browser, phone Safari/PWA and the iOS app's WKWebView), plus small iOS
(`ios/`) and daemon (`src/`) parts. The behaviour is settled and not under review:
`docs/design/client/browser-behaviors.md` and
`docs/design/client/terminal-interaction-design.md`. What is under review is the
structure: the tab model (D1), the sessions surface (D2), desktop chrome (D3), dock
layout and key routing (D4), preferences ownership (D5), bell (D6), and the slice order.

Read the code each decision lands in: `web/workspace/state.ts`, `web/app/router.ts`,
`web/app/persist.ts`, `web/platform/types.ts`, `web/files/browser.ts`,
`web/screens/shell/`, `web/screens/switcher/`, `web/screens/picker/`,
`web/screens/terminal/dock/`, `web/app/focus.ts`, `web/platform/native/bridge.ts`,
`ios/TetherKit/Sources/TetherKit/BridgeTypes.swift`, and the current web design
`.meridian/work/tether-mvp/design/client-architecture.md` §6 and §7.4 (state owners).
`web/AGENTS.md` states the ownership rules. Two inventories of today's code against the
redesign are at `/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p317/report.md`
(web) and `.../p318/report.md` (iOS, daemon).

Find the moves that make the whole build, and the system after it, simpler: the
enabling refactors that belong in slice 1 or before it, states the plan would leave
representable that shouldn't be, owners the plan splits or duplicates, code it should
delete instead of adapt, and slices whose order makes later ones rework earlier ones.

Risks I want checked, beside whatever else you find:
- D1's router/history design for N Files tabs: whether history entries should carry
  `{tab, place}` or Files drill-in should not touch browser history beyond what the spec
  requires (spec: "Back closes the top sheet/preview before leaving its parent
  destination"; "folder drill-in, preview ... create reversible navigation entries";
  "Opening or switching terminal tabs does not add browser history entries").
- Whether the workspace union should hold the Files place, or `FileBrowser` instances
  keyed by tab id should own it with persist assembling as today.
- v2 → v3 migration versus discarding, and whether Swift decodes the workspace shape.
- D4: computing grapheme caret moves in web for the native line (native owns the text;
  races with in-flight native edits, marked composition).
- D5: native owning preferences versus web owning them and pushing to native.

Edit nothing. Report findings ranked by how much they change the plan, each with the
code it rests on (path:line) and the move you recommend; say which you'd fold into
slice 1 and which can wait.
