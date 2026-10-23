# screens/terminal

The Terminal destination. The design is client-architecture.md §5.4, §6.4, §6.5, §7.1 to §7.5.

- **`terminals.ts` owns the terminal, not the component.** It is one object per app
  (`terminalsOf(app)`) that holds the renderer's element, every tab's `TabDriver`, tmux's size,
  desktop direct input and paste. `TerminalScreen` only places the element in its slot and draws
  state, so the buffer and each tab's watch survive the screen unmounting (an admission problem
  replaces the shell) or a layout change.
- **Nothing watches before the box is measured.** Drivers start covered. `ready` flips once the
  renderer has a cell size and the sizer has a size, and only then does the shown tab `uncover()`,
  so tmux never sees the 80x24 placeholder. The first size is claimed by that `watch`; later
  ones go out 150 ms after the last change (`term/size.ts`).
- **The surface hides until a tab's own snapshot has painted** (`data-blank`), so no tab shows
  another's content, and an empty terminal never looks live. Reconnecting keeps the last content.
- **Keystrokes are batched for 8 ms.** The daemon answers a burst of separate `input` messages
  with `busy` and, with no `req`, the client never learns: characters were lost under load. The
  batch goes to the tab that was shown when the keys were typed, in order, and before any paste.
- **For other lanes.** Insert path reaches a tab through `TabHandle.insertPath`, which each driver
  registers with `attachDriver`: quoted, no Enter, into that tab only, once it is watching, with a
  notice if the tab closes first. A screen that disables the action while no tab is connected reads
  `connected(tabId)` through `useStore(terminalsOf(app), ...)`. P3 reads `term/index.ts`:
  `bufferText`, `mouseMode`, `cellAt`, `setPanArea`; and `tabs/keymap.ts` (`decideKey(event, "owned")`).
- **Cmd combinations are the browser's, everywhere, and Ctrl+Shift+C copies everywhere.** Telling
  macOS from the rest needs `navigator`, which only `platform/` may read; no terminal key is lost
  by this (nobody sends Super+key to a shell, and `^C` still is Ctrl+C).
- `e2e/terminal/` runs a real daemon, isolated, on `e2e/shared/stack.ts`: see it for why a front proxy
  answers `/auth/info` and why the daemon runs with `--allow-login`. `pnpm e2e:real` runs it.
