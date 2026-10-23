# W3 Files: notes for decisions.md, browser-behaviors.md, plan.md and CHANGELOG.md

## Departures and decisions

1. **Settings and the $HOME picker are gone from `FileBrowser`** (client-architecture.md §3.1
   says so). Adding or removing a root, and moving `uploads_dir`, now happen in
   `~/.config/tether/config.toml` on the host; the roots list says so, and the empty state says
   how to add one. The `/fs/roots/*`, `/fs/uploads-dir` and `/fs/dirs` client methods stay in
   `files/api.ts` (tested, and the daemon serves them). The tests for the deleted places went with them.
   Alternative rejected: keep the places unused for a later Settings lane (dead code, no UI).
   For Jimmy: a fresh install has no way to add a root from the app. W1's Settings could take it.
2. **The router owns the Files place; `FileBrowser` follows it** (§6.6). Tapping a folder or file calls
   `router.pushFiles`; `FileBrowser.follow(place)` brings its state to the entry. What is on
   screen stays when `follow` is asked for it again, so Back from a preview makes no request.
   The saved workspace gets its place from `FileBrowser` through `persist.provideFiles`.
3. **No auto-open at the active tab's cwd.** `start(cwd)` is deleted: the cwd lives in the terminal
   lane's `watching` state, which `AppView` does not carry. Files opens at the roots list (or the
   restored place). Add when the terminal lane publishes the cwd.
4. **Upload completion does not navigate.** Spec §7.5 says Files shows the preview and the offer.
   Built instead: a panel above the list with a row per upload: progress, then "Saved <name>",
   "Insert path into <tab>" and Preview. Alternative rejected: jumping to the preview, which pulls
   the user out of the folder they were browsing, and breaks with several files in one pick.
5. **Browser `pick` takes several files.** The input is `multiple`. The queue is the page's
   (`platform/browser/uploads.ts`): one request at a time, four held at most counting the one in
   flight; the fifth is refused with "Wait for the current uploads to finish" as an `error` event.
   `busy` from the daemon is retried three times at a second apart. Progress uses
   `XMLHttpRequest`, since `fetch` has no upload progress in Safari. The `UploadEvent` has no file
   name, so a running row says "Uploading 40%"; the saved row names the daemon's timestamped file.
6. **The insert target is the tab active when the action starts** (tap on Upload, or the click on
   Insert in a preview). A tab is eligible when open and not `restoring`. A gone target disables the
   offer ("That tab was closed") and never redirects. `TabDriver.insertPath` already queues until the
   watch is bound and quotes the path, so "connected" is approximated by "proven by a listing".
7. **List rows are one grouped list with hairlines**, not the bordered cards of Home's rows: a folder
   can hold hundreds. Same `Row` primitive, same height, icon and chevron slots.
8. **Hidden files toggle is a quiet button under the list**, not a header control: the header has
   room for back, title, Refresh and Upload on a phone, and the toggle is rarely used.
9. **Header and bar share Home's centred 720 px column on a wide screen** (`--files-inset`), including
   code, so nothing starts at a different left edge.
10. **Markdown headings keep their level.** A document's `h1` is a second `h1` on the page. The sanitizer
    strips classes, so the viewer styles by element; demoting levels would change the document.
11. **Syntax colours reuse `--term-*` tokens** (and `--color-text-muted` for comments, which passes AA
    where `--term-bright-black` did not). The `--shiki-*` names live in the viewer's CSS module.
12. **Grammars trimmed to the 13 of §8.4** (`files/kinds.ts`): bash, c, diff, go, javascript, json,
    markdown, python, rust, swift, toml, typescript, yaml. `.jsx` uses javascript; `.tsx` has no
    grammar and shows plain.
13. Paths show as `~/...` once the roots are known (`FileBrowser` fetches them in the background when
    it opens straight onto a folder or file). The Insert path uses the absolute path.

## For browser-behaviors.md "Files" and "File upload and path insertion"

- Folder rows: icon, name, chevron. File rows add a size; links that cannot open say why
  ("Broken link", "Not a file", "Name can't be opened") and are disabled.
- Each folder shows the next page as its end nears the screen; "Show more" is the fallback.
  A folder past the daemon's scan cap says it is too big to list in full.
- Loading and errors never look like empty lists: a spinner with words, or the refusal in the
  file manager's words with "Try again".
- Videos play inline in the browser (`playVideo` answers "inline"); native keeps its player.
- Markdown relative links open the file here (a probe decides file or folder); web links go to
  `platform.openURL`.

## CHANGELOG (for the lead)

- Files: folder list, previews (code, Markdown, images, video, binary), upload with progress,
  and "Insert path into <tab>" for an upload or an open file.
