# screens/terminal

The Terminal destination. The design is client-architecture.md §5.4, §5.5, §5.10, §6.1,
§6.4, §6.5, §7.1 to §7.5.

- **`terminals.ts` owns the terminal, not the component.** It is one object per app
  (`terminalsOf(app)`) that holds the renderer's element, every tab's `TabDriver`, tmux's size,
  desktop direct input and paste. `TerminalScreen` only places the element in its slot and draws
  state, so the buffer and each tab's watch survive the screen unmounting (an admission problem
  replaces the shell) or a layout change.
- **Nothing watches before the box is measured, and only the tab on screen watches.** Drivers
  start covered. `sync()` runs on every app change and uncovers `shownTab(workspace)` only when
  ready (a renderer, a cell size and a tmux size) and `lifecycle.covered` is false; otherwise
  every driver stays covered, so tmux never sees the 80x24 placeholder and releases the window
  size beneath a native screen. The reducer and controller never address a driver. The first
  size goes out in that `watch`; later ones go out 150 ms after the last change (`term/size.ts`).
- **The pane keeps tmux's size, whatever the box** (§5.4). The sizer's inputs and the size sent
  stay the tab's own; the snapshot's size is drawn at the tab's font. `TabDriver` reports
  `onLarger` when the pane exceeds the size it sent; `terminals.ts` turns that into the DOM
  renderer at once (`setWebgl(false)`) and `sizedForOther` after 1 s, which shows the Fit band.
  Claims live in the driver: `watch` omits `claim` for the user's own acts (`claimNext`: set by
  `uncover` and by returning from background, cleared once a watch binds) and sends
  `claim: false` otherwise unless the pane was no larger than the size sent. Nothing sends
  `resize` after a re-watch except a real size change, since `resize` claims.
- **The surface hides until a tab's own snapshot has painted** (`data-blank`), so no tab shows
  another's content, and an empty terminal never looks live. Reconnecting keeps the last content.
  `painted` records whose snapshot the surface holds; `showPainted()` blanks it on Terminal
  whenever that is not the active tab, and leaves it alone off Terminal so a return shows the
  last content until the fresh snapshot.
- **Keystrokes are batched for 8 ms.** The daemon answers a burst of separate `input` messages
  with `busy` and, with no `req`, the client never learns: characters were lost under load. The
  batch goes to the tab that was shown when the keys were typed, in order, and before any paste.
- **For other lanes.** `Terminals.insertPath(id, path)` and `canInsert(id)` are the one way a
  path reaches a tab (Files, image paste): quoted, no Enter, into that tab only, once it is
  watching. The driver's own state decides (connecting and live accept; reconnecting, limited
  and closed refuse), the result is `typed`, `queued` or `refused`, and a refusal gets one
  notice. A screen that disables the action selects `canInsert` from the `terminalsOf(app)`
  store. P3 reads `term/index.ts`:
  `bufferText`, `mouseMode`, `cellAt`, `setPanArea`; and `tabs/keymap.ts` (`decideKey(event, "owned")`).
- **Ctrl+Shift+F leaves the terminal** (`decideKey` returns `leave`; the sink focuses the `tabs` target, the active pill's select button). Cmd combinations are the browser's, everywhere, and Ctrl+Shift+C copies everywhere.** Telling
  macOS from the rest needs `navigator`, which only `platform/` may read; no terminal key is lost
  by this (nobody sends Super+key to a shell, and `^C` still is Ctrl+C).
- `e2e/terminal/` runs a real daemon, isolated, on `e2e/shared/stack.ts`: see it for why a front proxy
  answers `/auth/info` and why the daemon runs with `--allow-login`. `pnpm e2e:real` runs it.
