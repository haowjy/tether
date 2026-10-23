# P2 integration: land the W0 requests, remove the stand-ins, commit the lanes

Four parallel lanes built the web screens in this checkout and finished; their work is
uncommitted in `web/` (and `tests/fixtures/proto/keys.json`). They could not touch W0-owned
shared files, so each worked against local stand-ins and filed requests. You are now the only
writer: integrate everything into one tree that passes the full gate, and commit it.

Read: the four lane reports (W1 /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p91/report.md, W2 /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p92/report.md, W3 /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p93/report.md,
W4 /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p94/report.md), the request files `.meridian/work/tether-mvp/lanes/w{1,2,3,4}-requests.md`, the notes files
`.meridian/work/tether-mvp/lanes/w{1,2,3,4}-notes.md`, and design `.meridian/work/tether-mvp/design/client-architecture.md` rev 4 (§3, §6, §11).

## Do
1. **Land every W0 request** (each lane's requests file), as W0-owned changes, then delete the
   matching stand-ins and casts in the lane files. Includes: `TabHandle.insertPath` /
   `AppController.insertPath` (W2 #2 = W3 #1); `Router.go("files")` returns to the last Files place
   and `Router.toParent`; `daemonFetch` serves `/fs`; `createPwa(emit)` and an `UpdateState`
   `reload` with its banner; `Shell.tsx` keeps the terminal mounted under admission screens;
   `app/listing.ts` `linkLost` emits `failed` and `busy` retries; the controller owns the sessions
   cache (W1's WeakMap stand-in goes); `admitted` carries the device name; `Dialog.returnFocusTo`
   takes an element; `SearchField` spreads `data-*`; no tooltip on programmatic focus on touch;
   `FakeLink` answers `watch`; per-port Playwright `outputDir` (keyed on TETHER_E2E_PORT);
   `web/AGENTS.md` `native/bridge.ts` line; add `tsx` to GRAMMARS (lead's call: yes); Home's phone
   Files pane renders `<FilesScreen />` (lead's call); the offline banner names the host from the
   saved host record and offline tabs read "reconnecting" (§9.4); the vite.dev-proxy `/auth/info`
   credential fix W1 filed. Judge each request; if one is wrong, say why and do the right thing.
2. **One real-daemon e2e stack** (lead's call). W1 patched a copy of the daemon to read
   `TETHER_LOCALAPI_SOCKET` and ran a fake LocalAPI; W2 put a front proxy in front of an isolated
   daemon (`--allow-login e2e`) standing in for Serve and answering `/auth/info`. Use W2's approach,
   moved to `web/e2e/shared/` as one stack both W1's and W2's real-daemon specs use; delete W1's
   patched-daemon path, `run-real.sh` if it becomes redundant, `dev-proxy.real.ts`,
   `vite.real.config.ts`, and any scratch specs (W2's `e2e/terminal/scratch.spec.ts`). Do not add a
   LocalAPI override to the daemon. Tests needing the real daemon and tmux stay opt-in as they are
   now (they need `~/.cache/tether-tmux` binaries); say how to run them in `web/README.md`.
3. **Daemon nit**: "allows 1 tmux sessions" (`src/hub/owners.rs` ~336) pluralises correctly.
4. **Whole gate green**: `pnpm --dir web run check` (tsc, eslint ., checks source, vitest, build,
   budgets) and the full e2e suite (shared, home, terminal, files, pwa; real-daemon specs on tmux
   3.4 and 3.7b) in Chromium and WebKit, run twice. No dead code left from the stand-ins.
5. **Docs** from the lane notes, in the same commit as the code each describes:
   docs/design/decisions.md (each departure with alternatives rejected), docs/design/client/
   browser-behaviors.md, docs/design/plan.md where the layout changed, the client-architecture.md
   sections the requests changed, and CHANGELOG.md [Unreleased] bullets for Home/picker/Settings,
   Terminal, Files, PWA (user-visible changes only). Match each file's style.

## Commit
You may commit (no other agent edits the checkout now). Order commits so each passes
`scripts/preflight.sh full --commit <sha>` on its own: W0 shared changes first, then each lane
along its suggested split, adapted as needed. One change per commit; stage by explicit pathspec
(`git add <paths>` then `git commit -- <paths>` or `--only`), never `-A`. Do not commit
`.meridian/`. Don't push. Messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
Web uses pnpm, never npm. Minimum Rust 1.85 (no let chains). Never touch the installed tether
service, Tailscale serve config or real tmux sessions; sockets under
TMPDIR=/tmp/tether-meridian-501/wi. Use TETHER_E2E_PORT=5220.

Report: commits (sha, what, preflight result), each request landed or rejected with reason, e2e
pass counts per suite and browser, anything left for the G2 review to look at.
