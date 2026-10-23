# P2 follow-up: Add folder, a listing fix, and two tests Jimmy asked for

You are the only writer in this checkout (reviewers use clean exports). Commit each change with
`git commit --only -m ... -- <paths>` (git add new files first), one change per commit, each passing
`scripts/preflight.sh full --commit <sha>`. Don't push; don't commit .meridian/. Messages end
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. pnpm only. TETHER_E2E_PORT=5221.

1. **Add folder in Files** (Jimmy's call; reverses client-architecture.md §3.1's removal). On the
   Files roots list: "Add folder…" opens a picker that browses `/fs/dirs` from $HOME, one directory
   at a time (directories only; docs/design/fs.md "The picker"), and adds the chosen folder with
   `POST /fs/roots/add`; each root can be removed with `POST /fs/roots/remove` (confirm first). The
   daemon refuses $HOME itself and anything outside it: show those refusals plainly. Use the existing
   primitives and overlay/router patterns (Dialog on desktop, sheet on phone); match the design
   system. Extend the harness fixtures and the files e2e specs for add, remove, and the refusals. Log
   the decision in docs/design/decisions.md (Jimmy reversed the removal so a fresh install can add
   roots), update browser-behaviors.md, client-architecture.md §3.1, the .context/TODO entry p95 left,
   and a CHANGELOG bullet.
2. **Listing refresh coalescing** (web/app/listing.ts): `refresh()` is a no-op while a listing is in
   flight, so a refresh requested after a create can be satisfied by a listing that started before the
   create and lacks the new session; the 5 s creation wait then fails (seen as a flake in
   e2e/home/home.real.ts on WebKit + tmux 3.4). A refresh requested mid-flight must cause exactly one
   more listing after the current one returns (still one in flight at a time; still one listSessions
   per reconnect). Extend app/listing.test.ts. Verify home.real.ts repeatedly on both tmux versions.
3. **Tests Jimmy asked for**: (a) a Playwright keyboard-only walk of Home and the picker
   (e2e/home: Tab/arrow/Enter/Escape through search, the sessions list, expansion, opening a window,
   the picker open and close with focus returning correctly), Chromium and WebKit; (b) a vitest unit
   test of `bufferText` in web/term (soft wrap joined, hard break at the exact column kept, blank
   lines, indentation). Remove the matching .context/FUTURE entries.

Run the full web check and the default e2e suite at the end, plus `pnpm e2e:real` for home. Report
commits, verification with counts, and anything you disagreed with.
