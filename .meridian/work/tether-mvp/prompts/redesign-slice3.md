# Build slice 3 of the client redesign: keyboard-up layout and key routing (bridge v6)

Repo `/Users/jimmyyao/repos/tether`, `main`, primary checkout (no branches/PRs; read
`AGENTS.md`, `web/AGENTS.md`, `ios/AGENTS.md`). Local commits only, **do not push**;
stage only your files.

## Commit 0 first: two leftovers from slice 2b

- Desktop "New window" lost its only entry point in `2bbed88` (the plan keeps window
  creation on tmux's `prefix c` this pass). Delete the client code that is now
  unreachable: `CreateDialog`'s window target, `Terminals.newWindow`,
  `driver.newWindow`, and anything only they use (check with grep). Leave the daemon's
  `newWindow` protocol message alone, and add a line to `src/proto/.context/FUTURE` (create
  it if missing) that no client sends it any more.
- In the + popover and the sheet, the active tab's session reads "here" even on Home
  (`SessionPicks` uses `terminalTabOf(active)` regardless of screen). "here" means the tab
  on screen: on Home it reads "open". Derive it from the screen, not a flag.

## Behaviour (settled)

`docs/design/client/browser-behaviors.md` "Phone dock" and
`docs/design/client/terminal-interaction-design.md` "The dock: line field, key row and
one keyboard toggle" (the routing table is binding). In short:
- Keyboard down: the resting bar (current-tab button + Show keyboard), built in slice 2.
- Keyboard up: the resting bar is gone; bottom-up: keyboard, key row (text-only: esc ←
  ↑ ↓ → ⇧tab tab ^C ^R ctrl alt ⏎ | ~ / -, horizontally scrolling, Hide keyboard fixed at
  its end), compose box (always visible; idle with placeholder "Type or dictate a line"
  and no caret while typing goes to tmux).
- While the box owns focus: unmodified ← → move its caret by one character, unmodified
  esc returns typing to the terminal (keyboard stays up); ↑ ↓ ^R ^C tab ⇧tab ⏎ and the
  rest go to tmux; character keys insert at the caret; armed ctrl/alt chords go to tmux.
  The key row shows which keys act on the box versus tmux.
- A terminal tap with the keyboard up moves typing from the box to the terminal
  without hiding the keyboard.
- Focus cues: terminal target = solid terminal cursor, idle box without caret; line
  target = box ring + caret + Send, hollow terminal cursor, Return labelled Send. Exactly
  one active typing cursor.
- Sizes: row items 34 px, keys 32 px with touch areas extended to the row, compose font
  16 px, no blank band between controls and keyboard.

## Structure (decided, plan D4: `.meridian/work/tether-mvp/redesign/plan.md`)

- The Dock renders `resting` or `typing` from the focus owner: one derived value, not
  flags per element.
- Key-row routing is one pure function `(key, owner, armed) → terminal input | caret
  step(-1|+1) | focus terminal | line insert`. The browser textarea and the native line
  take the same decisions from it.
- A caret step calls a dock callback, like today's `insertIntoLine`: the browser
  textarea steps by grapheme with `Intl.Segmenter`; native gets a new bridge message
  `lineCaretStep` with `-1 | 1`, and Swift steps with UIKit's own text positions
  (`position(from:offset:)` on `KeyboardInput`), respecting marked text (no step while
  composing, or commit first: pick what UIKit does for a hardware arrow and match it).
  Native owns the text and caret; never compute a native caret index in web (it would
  race the 33 ms arrow repeat against the `lineEdit` echo). Rejected alternative, for
  the decision log: web-computed caret index through `lineCaret`.
- esc and the keyboard-up terminal tap use the existing `setFocus("terminal")`.
- Bridge v6: `lineCaretStep` web → native. Version bump in `web/platform/native/bridge.ts`,
  the Swift DTOs, and the fixtures in `ios/TetherKit/Tests/Fixtures/bridge/` (one copy
  of the contract: all three in one commit). Update `docs/design/ios-shell.md` (message
  table, bridge version), `terminal-interaction-design.md` only if something it states
  changes.

Read today's code first: `web/screens/terminal/dock/` (Dock, KeyRow, LineField,
LineMirror, nativeLine, lineDrafts), `web/app/focus.ts`, `web/touch/` (tap routing),
`ios/Tether/Input/` (FocusController, KeyboardInput), and slice 2's commits (`git log`).

No UI tests (Jimmy: "code structure over if statements"): make wrong states
unrepresentable rather than guarding them; update unit tests that pin replaced logic.
Delete what's replaced. Docs and decisions in the same commit; CHANGELOG bullet.

## Verify

`pnpm --dir web run check`, `ios/scripts/check.sh`, `scripts/preflight.sh full`. In the
harness (phone, keyboard-up fixture states) look at both targets' cues and the row.
On the real stack (`TMPDIR=/tmp`, tmux 3.4, the opt-in real e2e stack in `web/e2e/`):
from the browser's compose box, ← → move the caret, esc returns to the terminal and
the next typed key reaches tmux, ↑/^R reach the shell's history, Return sends the line.
The iOS keyboard, focus and geometry can't be verified in the Simulator
(`ios/AGENTS.md`): say what is Simulator-built and device-unverified, and write the
device checklist rows Jimmy should run (one cursor; ← → in box; esc back; tap back;
hardware arrows in the box). Report SHAs and what you saw.
