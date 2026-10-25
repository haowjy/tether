# Session-follow client review (web + iOS), current tree

Reviewed: dirty `main` on base 3821927, design base 18ae3f2. Scope: `web/` and `ios/` as they
stand after p238 and p245, plus the daemon's reply shapes where the client depends on them.
No source edited and no suites rerun. p245's gates (web 406, harness 838, Swift 7, Simulator,
real 145 + terminal rerun 52) were taken as reported. They do not add up to one uninterrupted
real-suite pass.

**Verdict: approve with notes.** I found no blocking defect. Session identity, v1 discard,
fixtures, the targeting of input, line, paste and Files insert, the band rule, the pinned
history pane and the lists all match the spec. p245's three fixes are correct. One of them
(creation focus) adds a second focus path beside the one the Dialog primitive already has.

## Findings (all low)

| # | Where | Issue | Evidence | Fix direction |
|---|---|---|---|---|
| L1 | `web/net/host.ts:98,150` | `selects` gains one entry per `selectWindow` and loses it only on a refusal, `leave`, link loss or background. A success has no reply (daemon-core §protocol: "Success shows as the `watching` that follows"), so on a long-lived socket every successful switch leaves an entry behind. | The deletion sites are lines 141, 217, 289 and 345 only. `ServerMsg` has no select reply. | Delete the map. Daemon refusals carry `watch` (`requests.rs` `refuse(conn, Some(req), Some(watch), …)`), so route an `error` whose `req` nobody is waiting on by its `watch` to `watchRoutes`. That also stops such an error being dropped silently at `replyTo`. |
| L2 | `web/screens/terminal/paste.ts:119-135` | The edit menu's Paste reads the clipboard asynchronously, then `paste()` re-reads the shown tab and `windowId` after the read. On iOS, `UIPasteboard` access can show the paste-permission prompt, and the session's window can change meanwhile (laptop prefix-n, a window exiting, a script). Text and image paths then type into the new window, not the one shown at the tap. This breaks "image paste and Files insert capture the window with the tab". | Code trace: `tab` is captured but used only for `clipboard.read(tab.key)`. `this.paste()` calls `this.deps.shown()` and `driver.windowId` again. The follow branch reads `windowId` at resolve time too. | Capture `{id, window}` before `clipboard.read` and pass it through, letting `paste()` take an explicit target. |
| L3 | `web/tabs/driver.ts:303` | A re-watch after a blip decides "held the window" from the debounced band flag. During the wait (≥1 s, or RTT + 0.5 s on a slow link) after the laptop took the window back, or after following a laptop-held window, `sizedForOther` is still false. A reconnect in that gap therefore claims and takes the window from the laptop. The spec says a reconnect never takes it unless the tab held the window. The reverse case: the band timer keeps running through `reconnecting` and can set the flag for a claim the daemon never got. | Code trace: `bandTimer` is not cleared on `linkLost`/`reconnecting`, and `claim = claimNext ‖ !sizedForOther`. Not run. | Track "held" directly: false once a `watching` after the last claiming send reports a size other than `sentSize`, true after a matching one. Keep the band flag for display only. |
| L4 | `web/screens/terminal/WindowsMenu.module.css` | The popover has no `max-height` or scroll. With `inset: auto` and `top` set, a session with many windows (~20+ on a short laptop window) puts the lower rows and "New window" (the desktop's only creation path) below the viewport, out of reach. | The CSS has no max-height or overflow. The UA `[popover]` is `position: fixed; height: fit-content`. Not rendered. | Add `max-height: calc(100dvh - top - edge)` (set with `top` on open) and `overflow-y: auto`. |
| L5 | `web/screens/home/CreateDialog.tsx:61-66` (p245 fix) | Focus after creating a window works, but by a second mover: the Dialog's layout effect returns focus to the opener, then a parent `useEffect` keyed on `open` refocuses the terminal through a ref that Form mutates. The primitive already has `returnFocusTo`, used this way by `Picker` (`touch ? "plus" : "terminal"`) and `FolderDialogs` (`removed ? … : null`). | Read `Dialog.tsx:41` and `focus.ts:175`. | Lift `created` to state in `CreateDialog` and pass `returnFocusTo={created && !touch ? "terminal" : null}`. Delete the ref and the effect. |
| L6 | standards | The new window-switcher states (loading, refused with Try again, one-window, many windows) have no harness fixture. web/AGENTS.md: "a harness fixture … that Playwright opens in both layouts". e2e covers only the ready menu. | `grep WindowList harness/` returns nothing. | Add a `WindowList` block to `harness/home/States.tsx` (it is pure props). |
| L7 | docs | Stale descriptions remain. `web/screens/terminal/.context/CONTEXT.md` still describes `onLarger`, the 1 s band in `terminals.ts` and the "pane no larger" claim rule. Older `[Unreleased]` bullets in `CHANGELOG.md` (lines 45-62) still promise a search over windows, sessions with their windows, New window on Home, a band only for larger windows and "a reconnect … leaves it there". `ios-shell.md:690` says "Bridge v2". `TabStrip.tsx:39` says "Selection is fill and weight" (weight no longer marks selection). | Read. | Edit the older bullets in place (nothing in them has shipped) and update the .context paragraph. |

## Checked and holding

- **Identity:** `tabId` is `host/server/$N`, so it can never equal a v1 window tab's id. It matches the fixtures' `active: "host-01/main:42-7/$2"`. Swift `SessionRef { server, session: Int }` matches. `bridge.ts` refuses a boot that isn't bridge 3. `DaemonProtocol.version` is 2.
- **v1 discard:** the browser clears only the `workspace` and `drafts` stores, which hold nothing else. Native removes `tether.workspace.v1` and `tether.drafts.v1` only; the host and token stores are untouched. Nothing migrates.
- **Restore and pruning:** listings match by session id within the same server run. The shown tab keeps the window name from `watching`, the others take the listing's active window. One notice per prune. `sessionClosed` closes the tab silently.
- **Targeting:** keystroke batches flush when the window changes inside the batch. The line field and native input use the window shown at send. Files Insert captures the window at the tap, and a queued path keeps its window. The image-paste upload captures it before the upload.
- **Sizing:** either direction, a wait of max(1 s, RTT + 0.5 s), restarted on each claiming send (watch, resize, input, paste, Fit, select, newWindow, insert). The band clears on a match.
- **p245 fixes:**
  - The clamped menu position is computed on open, and a resize closes the menu, so the position can't go stale.
  - The pinned history pane is a single check, with `view.reset()` generation as the outer guard.
  - Creation focus: see L5.
- **Lists:** session rows only, search by session name, "here" and "open" in words. Home has no New window.
- **Bounded work:** each `watching` (cwd, size, name) costs a store patch and a no-op reducer step, with no save. The menu fetches one listing per open; the sheet, one per mount.

## Hypotheses (not checked)

- L4 was not rendered in a browser, so the window count at which rows go off-screen is estimated.
- L2: I didn't check on a device how long the iOS paste prompt blocks while `watching` keeps arriving.
- L3 was not reproduced: it needs a link drop timed inside the band wait.
- I did not check `DraftStore`'s JSON-encoded key order (this predates the change and was not touched).
