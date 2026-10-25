# Build: session follow, web client (client half of lane 1b)

The daemon side is built (uncommitted, p235; under review) and speaks protocol 2. Make
the web client follow it. Contract: `docs/design/client/browser-behaviors.md` (committed
design 18ae3f2 plus Files edits), `docs/design/daemon-core.md` (protocol messages, as
updated by p235 in the working tree), `.meridian/work/tether-mvp/design/client-architecture.md`
and `.meridian/work/tether-mvp/design-session-follow-and-folder-find.md` (lane 1b, review
record). Jimmy's decisions: `.meridian/work/tether-mvp/real-use-decisions.md`.

## Wire delta (from p235)
Protocol 2 (min 2). `watch.window` -> `watch.session`. `watching.window` is a
`ShownWindow { id, index, name, size }` (the whole window's size). `input` and `paste`
carry the shown window id. New `selectWindow`. `newWindow.watch` optional; newWindow no
longer detached (creates and shows the window). `historyChunk.pane` (drop chunks for
another pane and restart the history cache). `windowClosed` / `windowRenamed` removed.
`input` errors arrive as `error { watch, tmux }`. Types: `web/proto/generated/messages.ts`.

## What to build (spec wins)
- A tab is a session (`SessionRef`: server instance + session id); it shows whatever
  window `watching` reports and follows it; restore by SessionRef; a saved v1 workspace
  (window tabs) is discarded at boot with the drafts keyed to its tabs (storage v2).
- Lists (Home, picker, phone switcher) show sessions only: one row each with a window
  count, no accordions, search matches session names only. Home loses "+ New window".
- Window switcher: phone, a "Windows in <session>" block in the session switcher sheet
  (window rows only with 2+ windows, then "+ New window"; current labelled "shown", in
  words); desktop, a windows button in the active tab pill (shown on every session)
  opening a menu of the same rows and "New window". Loading and refusal states.
- Tab label: session name bold, window name regular, separated by spacing only (no dot or
  separator characters), window name shown even with one window.
- Sizing band: "Sized for another terminal" + Fit whenever `watching.window.size`
  differs from this screen's size (larger or smaller), after max(1 s, last ping RTT +
  0.5 s); nothing when tether holds it. Input/paste/Fit/opening a tab claim per spec.
- Paste/upload/inserted paths target the window the tab was showing when they started.
- Delete the window-tab model and everything only it used (no compatibility path).

## Also
The iOS shell is a separate lane after you: define the bridge v3 contract change
(`TabKey` naming a session) in `web/platform/native/bridge.ts` and update the shared
fixtures in `ios/TetherKit/Tests/Fixtures/bridge/` that `bridge.test.ts` decodes, then
describe the Swift-side delta in your report. Don't edit Swift.

## Constraints and verification
`web/AGENTS.md` rules (one owner per state, focus via app/focus.ts, router owns history,
environment only in platform/, raw inputs only in ui/primitives/, tokens, every state with
harness fixtures in both layouts, no dot characters in copy). W0-owned files may change
for this; list them. pnpm only; don't touch `src/` or `tests/` (under review — report any
daemon bug you hit with a repro instead). Don't commit; keep throwaway scripts out of
`web/`.
Verify: `pnpm --dir web run check`; `pnpm --dir web run e2e`; the real-daemon suite
`pnpm --dir web run e2e:real` on tmux 3.4 and 3.7b (README "End to end against a real
daemon"; `cargo build` first; TMPDIR short, e.g. /tmp/tether-e2e) including: a 2000x970
browser against an 80x24 pty takes the window on typing and the pty takes it back with
the band showing; laptop prefix-n is followed; a window switch from the switcher; restore
after reload. Report bytes per switch if you measure them. Screenshots of the switcher
(phone, desktop) and lists in `.meridian/work/tether-mvp/evidence/session-follow-web/`.
Report: what changed, deleted, bridge v3 delta for Swift, verification, what Jimmy should
check on the iPhone.
