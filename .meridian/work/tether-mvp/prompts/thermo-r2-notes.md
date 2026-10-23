# Fold in round-2 thermo review notes (p104) on the web client

Repo /Users/jimmyyao/repos/tether, commit straight to `main`, one change per commit, `git commit --only -- <paths>`,
trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use pnpm only. Don't push. Run
`scripts/preflight.sh full --commit <sha>` on each commit. Docs in docs/design/ change in the same commit as code.
Read p104's report first: `meridian spawn show p104` (report at ~/.meridian/projects/steep-lamp-cloud/spawns/p104/report.md).

Fix these, one commit each:

1. **H2 remainder.** `web/e2e/files/files.spec.ts:126` "a reload returns to the folder and the preview" only proves restore.
   Make it prove the save side too: browse into a folder, `persist.persistNow()` (or whatever the harness exposes),
   read the test platform's saved workspace, assert `files.place` is that folder. Extend that spec; add no new test file.
   Check it fails if `session.ts` stops saving the place (then revert that sabotage).
2. **M-a.** `docs/design/ios-shell.md:495` says the web unwatches while a native screen covers the terminal; §6.1 of
   `client-architecture.md` (~797) says W5 needs no web mechanism; the bridge has no "covered" message. Settle it as one
   rule: add a native→web signal (e.g. `lifecycle.covered {covered: boolean}`) in client-architecture §5.10 and
   ios-shell's bridge table, add it to `web/platform/types.ts`, and fold it into the single predicate `Terminals.sync()`
   reads (shown tab AND not covered). No second owner, no parallel path. Reword §6.1. Log the decision in decisions.md
   with the rejected alternative (Swift-only state). The web side is testable with the test platform emitting the event;
   verify by hand, keep no new test.
3. **L-a.** `web/tabs/keymap.ts:78-80` matches chords on lowercased `e.key`; on non-Latin layouts Ctrl+Shift+F/C fall
   through. Resolve chord letters by `e.code` (KeyF, KeyC), ideally through the same code-based path `printable()` uses,
   so every chord letter is layout-independent. Check keymap.test.ts still passes; adjust its cases if they built events
   with only `key`.
4. **L-b.** `web/e2e/shared/harness.ts:43` awaits `animation.finished`, which rejects with AbortError on cancel:
   `.catch(() => undefined)`.
5. **L-c.** `docs/design/decisions.md` ~2884: replace "from memory" with p104's first-hand sources (Chrome help,
   Firefox browser-sets.inc.xhtml + DevToolsStartup, Safari shortcuts page), and add one line that Windows' Microsoft
   Pinyin IME uses Ctrl+Shift+F while active (rebindable). Fold into commit 3 if natural.

Verify: `pnpm --dir web run check`, the files + keyboard + shared e2e specs on chromium and webkit (set your own
`TETHER_E2E_PORT`, e.g. 5231; the machine is loaded, so rerun a lone flake in isolation before calling it real).
Report commits, what you verified, and anything you judged differently.
