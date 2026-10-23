# Apply the maintainability review of the web client, plus the terminal-exit chord

Read the review in full: /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p102/report.md (at f5c8869). You are the only writer in this checkout.

1. **H1, the move** (a concern now on its third round; apply the review's move, not another patch):
   `Terminals` is the single owner of tab drivers and of which tab is shown. `Terminals.sync()`
   covers/uncovers from `shownTab(workspace)`; `Terminals.shown`, the `detach` map and
   `connected()` go. One `insertPath(id, path)` and one `canInsert(id)` read the driver's own state
   (one eligibility rule, one notice per outcome, a result that reflects what happened); Files and
   image paste both use it (through one port the terminal lane registers, if Files must not import
   terminal code). Delete `TabHandle`, `attachDriver`, the controller's `drivers` map and
   `insertPath`, `tabsOffline`/`setTabOffline`, the cover/uncover effect types and their reducer
   cases/tests. Check whether native (W5, client-architecture.md §5) needs reducer cover/uncover; if
   not, say so in §6.1. Update §6.1, plan.md, screens/terminal/.context/CONTEXT.md.
2. **H2**: Files fixtures become ordinary fixtures on the real app at `#/files`: `daemonFetch` serves
   FakeFs through `daemon.fs`, scripted upload events become a `createTestPlatform` option; delete
   `Frame.tsx`, `Frame.module.css`, `window.__files`, the `inserted` recorder and `withFiles`; specs
   assert on `platform.daemon.requests` and the terminal's real input. Fix the `hostName` capture
   (read from the registry on use). The Files e2e must keep covering everything it covers now.
3. **M1** `useOverlay(screen, name)` and opener recording in the focus controller; the fine-pointer
   initial-focus selector fix; delete `initialFocus` and the page-wide queries. **M2** `requested`
   from `ListingFetcher` drives "updating"; `SessionsCache` extends `Store`; one
   `HostSessionLists` for Home and the picker; `listing.setHosts` replaces the controller's `listed`
   set. **M3** `router.closeOverlay(then?)`; `openWindow`/`useSessions` move out of screens/home.
   **M4** build §6.4's 4005 host banner (map the close code to a host state HostBanner reads).
4. **Lows**: delete L1's no-caller code (keep what the review lists as built ahead for P3/W5; align
   the test platform's draft key with the browser adapter's `tabId(key)`); give each harness fixture
   no spec opens a spec in the shared route matrix or delete it; L2 one reload banner; L3 move
   `applyViewport` out of the controller constructor so the controller runs under vitest.
5. **Terminal-exit chord** (Jimmy's call): a keyboard user leaves a focused terminal with one
   dedicated chord that moves focus to the tab strip. Choose a Ctrl+Shift chord that no default
   Chrome, Firefox or Safari shortcut takes on macOS, Linux or Windows (state your check; terminals
   can't encode Ctrl+Shift+letter distinctly, so shells lose nothing; avoid Ctrl+Shift+C/V which copy
   and paste). Handle it in the keymap before keys are sent; name it in Settings and wherever help
   text lives; extend the keyboard e2e (e2e/home/keyboard.spec.ts) to leave the terminal with it.
   Log it in decisions.md and browser-behaviors.md.

Tests: extend existing tests where behaviour moved; delete tests of deleted mechanisms. Docs in the
same commit as the code they describe (decisions.md, browser-behaviors.md, plan.md, CHANGELOG for
user-visible changes, client-architecture.md in the work dir).

Commit each coherent change with `git commit --only -m ... -- <paths>` (git add new files first), one
change per commit, each passing `scripts/preflight.sh full --commit <sha>`. Order: enabling
refactors first. Don't push. Commit `.meridian/` only for client-architecture.md. Messages end
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. pnpm only; minimum Rust 1.85. Short
TMPDIR (/tmp/tth) for real-daemon runs; TETHER_E2E_PORT=5223. Never touch the installed service,
Tailscale serve config or real tmux sessions. End with `pnpm check`, the default e2e, and
`pnpm e2e:real` (report load average). Report commits, each finding done or not with reason, and
verification counts.
