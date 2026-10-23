# W0 review fixes

The W0 web skeleton (commits b11c82b 8033239 aaa5163 948868f; notes .meridian/work/tether-mvp/w0-notes.md; design
.meridian/work/tether-mvp/design/client-architecture.md rev 4) was reviewed by three lanes. Read all three reports in
full; they carry probes and file:line evidence:
- correctness: /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p69/report.md
- structure/alignment: /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p70/report.md
- browser probe: /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p71/report.md (screenshots in .meridian/work/tether-mvp/evidence/w0-probe/)

Fix these, judging the best shape yourself:
1. **Dev proxy** (`web/vite.dev-proxy.ts`): it injects the device token into WebSocket upgrades
   that never pass the Serve check, from any Origin, and `/wsx` slips past a path check that
   disagrees with Vite's prefix-matching proxy keys. Make the dev server's own origin the check
   on HTTP and on the upgrade (destroy refused sockets before they're proxied); treat the Serve
   login header as a hint, not authentication; one list for the proxied paths and the check; a
   non-JSON `/auth/info` reply answers 502 instead of crashing Vite. This is a class: any dev path
   that injects a credential must refuse foreign origins.
2. **Blocked buttons submit** (Button `disabledReason`, Enrol): a blocked button prevents default,
   so every future submit button with a reason is safe; Enrol's submit guards busy/empty.
3. **check-install.mjs**: also fail on installed packages absent from the commit's lockfile, and on
   package.json deps/devDeps/overrides disagreeing with the lockfile root entry.
4. **Tab change + navigation have no owner** (p70 M1): add a `navigate` reducer effect that the
   controller runs through the router before focus effects; focus computed against the
   post-navigation state; last-tab close returns Home and focuses Home search on desktop.
   Update §6.1's effect list in client-architecture.md to match.
5. **Re-render and save cost** (M2, M3, M5): `useAppView(select)` with equality; write viewport CSS
   variables only when they change; reducers return the same state when nothing changed; coalesce
   workspace saves (one IndexedDB transaction per microtask at most); one owner for the Home/picker
   listing trigger so entering Home with the socket opening sends one listSessions.
6. **Phone horizontal overflow**: the hidden "Show keyboard" tooltip widens the phone terminal
   page to 407–411 px at 390 px. No horizontal page scroll at any route/viewport.
7. **Axe contrast flakiness**: a full e2e run gave 45 color-contrast failures that a focused rerun
   didn't reproduce. Find out why (transition/animation mid-flight, load timing, a real token
   problem) and fix the cause, so the a11y gate is trustworthy.
8. Lows worth doing now: move `net/fakes.ts`, `files/fakes.ts` where the build guard and lint rule
   see them; stale `scripts/check-build.mjs` comments; `FocusController.register(target, null)`
   deletes only if the same element; labels split on " / " garble names; delete unused tokens
   (--field-height, --z-toolbar, --z-dialog); lint rule 2 catches `autoFocus` and `el["focus"]()`;
   colour check catches raw oklch/hex/rgb literals in CSS modules; `preflight.sh --commit` stops
   running `cargo clean -p tether` on the shared target (give the export its own target subdir or
   whatever avoids disrupting the checkout's build without a full rebuild each push).

Out of scope, leave them: L5 (terminal stays mounted under admission screens) and the duplicate
Viewport/InputEvent types are W2's; the docs fold into docs/design/ is the lead's. The browser
floor rises to Safari 17.5 for `light-dark()` (lead's call; the lead logs it).

Ownership: edit only `web/`, `scripts/preflight.sh`, `.githooks/`, and §6.1 of
.meridian/work/tether-mvp/design/client-architecture.md. Another coder is mid-edit in `src/` and `docs/` in the same
checkout and the Rust tree may not compile: do not touch those paths, and run Rust-dependent
checks only against a clean export. **Do not commit, stage, or push**; the lead commits after
reading your diff. Verify in a real browser (harness, Chromium and WebKit, phone and desktop) and
run `npm --prefix web run check` plus the e2e suite twice. If socket paths get too long, use
TMPDIR=/tmp/tether-meridian-501. Report each fix with how you verified it, a suggested commit
split (one change per commit, with the paths for each), and anything you disagreed with and why.
