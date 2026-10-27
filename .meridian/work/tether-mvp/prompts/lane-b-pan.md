# Lane B: with the keyboard up, show the bottom of the terminal

Jimmy, on his iPhone in the app: "when the keyboard opens... i can't see the bottom of the
tmux session meaning i cant see whats being typed normally in terminal harnesses" (Claude
Code, codex, opencode: input box near the bottom, status lines under it). Prior read-only
investigation: `.meridian/work/tether-mvp/keyboard-hides-bottom.md`.

## Decided (tech lead, Jimmy agreed "either works")

tmux keeps its keyboard-down size (unchanged rule). The pan changes anchor: when the
terminal area is shorter than the rows, slide so the **last row** meets the bottom of the
area, **unless that would push the cursor row above the top of the area**; then slide so
the cursor row is the bottom row as today. Never past the last row; nothing while every row
fits; scrolled back into history = no pan (as today). Code: `web/term/size.ts` `cursorPan`
(rename to what it now means), `web/term/xterm.ts` ~line 97-122.

## Also find out and fix

Whether the pan runs at all in the **app** when the keyboard rises. The native shell
shrinks the web view (`ios/Tether/Web/WebShellController.swift` `keyboardWillChange`) and
reports `keyboardInset: 0` (see `.meridian/work/tether-mvp/keyboard-gap.md`); the dock's
`panArea` may be computed from the strip's size or from geometry that doesn't change in the
app (`web/screens/terminal/dock/Dock.tsx` ~68-93), and xterm may re-pan with a stale area.
Establish with evidence (app viewport messages replayed in the web client, the dev shim, or
the iOS Simulator app) and fix at the owner of the fact, not with a second path.

## Specs

`docs/design/ios-shell.md` "The pan" bullet, `docs/design/plan.md` "Layout" sentence about
the cursor, any client doc that describes the pan; dated 2026-10-26 decisions.md entry
(rejected: resize tmux to the visible rows while the keyboard is up — every keyboard toggle
would redraw every TUI over a spotty link and resize the laptop's view; cursor-only anchor —
hides harness status lines). CHANGELOG `[Unreleased]` bullet.

## Constraints

- A parallel lane (Lane A) is editing `web/touch/*`, `web/screens/terminal/touchControl.ts`,
  `selection/*` and `dock/KeyRow.tsx`, and other sections of plan.md/ios-shell.md. Don't
  edit those; in Dock.tsx touch only the pan area.
- Update `web/term/size.test.ts`'s existing `cursorPan` cases to the new rule; no new
  permanent tests. pnpm only. Gate `pnpm --dir web run check`; if you touch Swift,
  `./ios/scripts/check.sh`. Do not commit.

## Verify on the running thing

Real daemon, private tmux socket (`-L`, e2e stack), mobile viewport: run a TUI-like script
that draws a box with the cursor at rows N-4 and status lines on rows N-2..N-1, raise the
keyboard (or simulate the app's viewport message sequence exactly as native sends it), and
measure that the last row's bottom meets the area's bottom; then a shell prompt at the
bottom; then vim-like cursor near the top (cursor stays visible). Report numbers. Delete
scratch files.
