# Review slice 3 of the client redesign (`229bbe4`, `f141158`, local on main)

Repo `/Users/jimmyyao/repos/tether`. Review a frozen export, not the live checkout
(another writer may start): `git archive f141158 | tar -x -C /tmp/tether-rev-s3` (create
the dir), and read the diffs with `git log -p 2bbed88..f141158 -- web/ ios/ docs/ src/`
(skip `b847e18`, Mermaid, reviewed separately).

What it does: `229bbe4` deletes the unreachable desktop New-window client path and makes
"here" follow the screen. `f141158`: the Dock renders `resting` or `typing` from the
focus owner; one pure `routeKey(key, owner, armed)` (`web/touch/keyRoute.ts`) drives
the key row for the browser textarea and the native line; browser caret steps by
grapheme (`caret.ts`); bridge v6 adds `lineCaretStep` (Swift steps with UIKit
positions); keyboard-up terminal tap gives typing to the terminal; hardware Esc in the
native line returns to the terminal; `focus.ts` now treats a blur handing focus to the
other input as a change of owner. Writer's report: `meridian spawn show p341`.

Intent: `docs/design/client/browser-behaviors.md` "Phone dock",
`docs/design/client/terminal-interaction-design.md` (the routing table is binding),
`docs/design/ios-shell.md` (focus controller, bridge), plan D4 in
`.meridian/work/tether-mvp/redesign/plan.md`. Jimmy's rule: no UI tests; code structure
over if statements: report states the code can represent that it shouldn't, and the
structural move.

Risks, beside anything else:
- one active typing cursor in every transition (show/hide keyboard, box tap, esc, tap,
  sheet open/close, tab switch, Files tab, background/foreground, Safari Done / form bar,
  hardware keyboard); the focus.ts owner change on cross-input blur: can it leave the
  owner wrong after a real blur (Done, system dismissal)?
- native: `FocusController` remains the only first-responder caller; `lineCaretStep`
  during marked text, at text ends, with selection; the 33 ms repeat against `lineEdit`
  echoes; the bridge v6 contract consistent across `bridge.ts`, Swift DTOs and fixtures;
  an old app (v5) with a new web bundle and the reverse (how does a version mismatch
  show?).
- routing: every row of the binding table, armed ctrl/alt from the box, IME composition
  disarming, character keys into the box vs tmux.
- tmux is never resized by showing the keyboard; the terminal pans per spec.
- the "here" derivation and the deleted window path leave no caller or stale text.

Edit nothing. Findings ranked by severity with path:line, a concrete failure scenario and
the structural fix.
