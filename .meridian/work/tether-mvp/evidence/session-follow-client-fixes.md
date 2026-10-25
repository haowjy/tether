# Session-follow client fixes (answers to p248)

Base: dirty `main` on 3821927. Touched only `web/`, docs, `CHANGELOG.md`. No commits, no new tests.
Disposable repros are copied to `/tmp/sf-fixes/` (`l1.test.ts`, `l2.test.ts`, `l3.test.ts`,
`l456.spec.ts`, `l2.real.ts`, `l3.real.ts`) and are not in the tree. Raw logs: `/tmp/sf-fixes/*.log`.

| # | Outcome | Fix | Evidence |
|---|---|---|---|
| L1 | Fixed | `net/host.ts`: the `selects` map is deleted. An `error` that no pending request or paste awaits goes to its `watch`'s tab through the existing `watchRoutes`; a late non-error answer is still ignored. | Scratch vitest: 2000 `selectWindow` + `watching` cycles leave no `Map` over 3 entries on the host; a refusal carrying `watch` reaches only the asking tab. |
| L2 | Fixed | `paste.ts`: `Pastes.target()` returns `{id, window}`. `pasteFromMenu` captures it before `clipboard.read`; `paste()`, `pasteImage`, `followUpload` take it as a parameter and never re-read shown/active. A closed target gives "Not sent: that tab is closed". | Scratch vitest: delayed read with the window changed, the tab switched, and the tab closed (goes to captured window / captured window / refused). Real daemon, Chromium touch, tmux 3.4: `read()` held, `select-window` to window 1, release → text in window 0, none in window 1. No claim about the iOS prompt. |
| L3 | Reproduced, fixed | `tabs/driver.ts`: re-watch claims iff `claimNext || holdsWindow()`, where `holdsWindow` = last `watching`'s window size equals `sentSize`. No new state. The band timer is cleared when the tab leaves live (reconnecting, limited, closed), so a stale wait cannot raise the flag; the flag is display only. Before the first `watching`, `shown` is null but `claimNext` is true, so the first watch claims. | Real daemon: laptop takes the window, socket dropped 24 ms after the `watching` that reported it (inside the wait): old rule sent a claiming watch (test failed), new rule sends `claim:false`, window stays 250x69. Scratch vitest does the same with fake timers. Existing real "reconnect leaves the laptop's size" passes. |
| L4 | Reproduced, fixed | `WindowsMenu.tsx` sets `max-height` = viewport − top − 8 px on open; CSS adds `overflow-y: auto`. | 30 windows at 1280x420: unfixed bottom 1411 px; fixed bottom 412 px, `scrollHeight` 1368 > `clientHeight` 369, "New window" scrolls into view and opens its dialog. Screenshot `/tmp/sf-fixes/l4-menu.png`. |
| L5 | Fixed | `CreateDialog.tsx`: ref and effect deleted. `createdWindow` state is set by the form before it awaits (cleared on error); `Dialog returnFocusTo={createdWindow && !touch ? "terminal" : null}`. | Chromium desktop: create a window from the menu, focus is the xterm textarea, typing `q` sends an `input`. Touch-density desktop: textarea not focused (no unasked keyboard). Cancel leaves focus on the windows button. Real home/terminal/dock groups pass. |
| L6 | Done as asked, nothing kept | Temporary `WindowList` fixture with loading, refused + Try again, one window, many windows, in sheet and menu variants, both layouts. | Rendered with no console errors; screenshots `/tmp/sf-fixes/l6-*.png`. Fixture and spec removed. The standard "harness fixture" rule is unmet on purpose (Jimmy's instruction). |
| L7 | Fixed | `terminal/.context/CONTEXT.md` (sizing, claims, input-targets-at-start), CHANGELOG older bullets, `ios-shell.md:690`, `TabStrip.tsx` comment. `client-architecture.md`: a banner naming what is superseded and where the current rules live, plus in-place edits of the glossary tab/host rows, §5.4 band and re-watch rules, §6.1 `TabKey`, labels, saved workspace v2, §6.2 restore. Everything else there stays as history. | Read-through. |

## Gates

- `pnpm run check` (tsc, eslint, source checks, vitest 392, build): pass, twice.
- Harness Playwright (e2e/home, dock, terminal, shared, files; chromium + webkit): 828 passed, 2 failed in
  `files/pathfield.spec.ts` "straight through costs one listing" (webkit). Untouched code, passes alone (4/4); load flake.
- Real daemon (`TMPDIR=/tmp/sfx`, port 5393, both tmux versions, both browsers): `home.real`, `terminal.real`, `dock.real` 120 passed.
  Without a short `TMPDIR` macOS fails with "File name too long" for the tmux socket (environment, not code).
- Not rerun: the full 838-case suite, gesture.real as a group, Swift.

## Rejected or adjusted suggestions

- **Reviewer's L3 "held" flag:** not added. `holdsWindow()` derives it from `sentSize` and `shown.size`, so there is no second mutable fact. Known limit: a resize sent but not yet echoed by a `watching` reads as "not held", so a blip in that instant skips a claim; the window keeps the size it already has and the next typing claims it.
- **L5 as `created && !touch` from the parent:** the flag is set before the await, because the dialog closes inside `createAndOpen`, before it returns. A user pressing Escape mid-creation gets terminal focus; harmless.
- **L4:** the whole popover scrolls; "New window" is not pinned. Simple and reachable.

## Gaps

- iOS paste prompt not exercised on a device; the desktop checks do not claim it.
- No retained regression tests for L1–L6, per Jimmy's instruction. The scratch files above are candidates if he changes his mind (L3 and L1 earn a place most).
