# W3 requests for W0-owned files

Each request names the file, the exact change, and why. W3 works against the stand-in named
under it; the next W3 commit deletes the stand-in once the change lands.

## 1. `AppController.insertPath(id, path)` and `TabHandle.insertPath` (app/controller.ts)

```ts
export interface TabHandle {
  cover(): void;
  uncover(): void;
  /** The tab's driver quotes `path` and types it, with no Enter, when its watch is bound. */
  insertPath(path: string): void;
}

// AppController
/** Hands `path` to the driver registered for tab `id`. False when none is registered. */
insertPath(id: string, path: string): boolean {
  const handle = this.drivers.get(id);
  handle?.insertPath(path);
  return handle !== undefined;
}
```

Why: Insert path (§7.5) must reach the tab's `TabDriver.insertPath`, which already queues,
quotes and sends. `drivers` is private to the controller and `TabHandle` has no insert.
W2 passes `driver.insertPath.bind(driver)` in `attachDriver`.

Stand-in: `screens/files/insert.ts` reads `app.insertPath` through a cast and, when the method
is absent, reports "the tab is closed" and sends nothing. Until this lands, Insert path
sends nothing in the real app. The harness fixtures define `app.insertPath` to record calls.
Delete the `CanInsert` cast when it lands.

## 2. `Router.go("files")` returns to the last Files place (app/router.ts)

`go("files")` pushes `files: null`, so the rail's Files button and Home's Files tab always
open the roots list, and "returning from Terminal preserves folder and preview context"
(browser-behaviors.md "Files") fails. Change: the router remembers the last non-null
`files` place it emitted (on push, replace and pop) and `go("files")` pushes an entry that
carries it. `reload` already restores through the saved workspace. `FileBrowser` follows the
entry exactly, so nothing else changes.

Stand-in: none; Files opens at the roots from the rail until this lands.

## 3. `Router.toParent(files?)` for Files' in-app back (app/router.ts)

§6.6 says in-app back buttons call `history.back()` when the previous entry is the logical
parent, else `replaceState` to the parent. `toParent()` only knows destinations. Change: accept
a `FilesPlace`; if the previous entry is on Files with `files` equal to it, `back()`, else
replace the top entry with `{ destination: "files", files: place, parent: "home" }`.

Stand-in: `[<]` calls `router.pushFiles(parent)`, which pushes. After previewing a file and
tapping `[<]`, browser Back then returns to the preview instead of the folder before it.

## 4. The test platform's `daemonFetch` serves `/fs` (platform/test/index.ts)

`daemonFetch` answers 404 to every `/fs/*`, so `harness/` fixtures that render the real
`<App>` show Files' error state. Wanted: a `FakeDaemon.fs?: (request: { method; path; query;
body }) => Response | Promise<Response> | undefined` that `daemonFetch` tries before its 404.
W3's fixtures use `render` with a `FakeFs`-backed session instead, and its real-adapter spec
(`e2e/files/uploads.spec.ts`) uses `page.route`, so neither is blocked.

Also `uploads: { pick: noEvents }` could take an option for scripted events; W3's fixtures
overwrite `app.platform.uploads.pick` at render instead.

## 5. `GRAMMARS` in vite.config.ts (tsx)

`.tsx` files open as plain text: the §8.4 allowlist has TypeScript but no JSX-aware grammar,
and Shiki's `typescript` grammar mis-colours JSX. `jsx` maps to `javascript`, which handles
it. If tsx colouring matters, add `tsx` to `GRAMMARS` (about 190 KB raw, 17 KB gz) and to
`files/kinds.ts`.

## 6. Home's Files pane renders `<FilesScreen />` (screens/home/Home.tsx, W1)

On phone Home shows the Files pane for `#/files`. `FilesScreen` is a full-height flex column
with its own header (title, path, Refresh, Upload) and scrolling body, and is meant to
replace the pane body entirely, under `HomeNav`, with no Home header above it. Until W1 does
that, the phone layout of the real app shows Home's placeholder; the harness fixtures frame
`FilesPane` the same way.

## 7. vite emits 13 re-export stubs for the grammars (vite.config.ts)

`manualChunks` merges each wrapper into `grammar-<name>`, yet a dynamic-import facade
(`c-*.js`, 44 to 60 bytes) remains for each of the 13 grammars. The shell is 46 files and
553 KB gz, within budget; only the file count is spent.
