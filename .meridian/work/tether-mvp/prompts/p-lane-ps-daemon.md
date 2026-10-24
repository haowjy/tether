# Lane PS-daemon: window size follows the client that acted last (daemon half)

Implement the daemon side exactly as specified: `docs/design/daemon-core.md` §3.3, §3.4, §3.6, §3.7, §3.9, §4.1–4.4, §5.3, §8 (tests), §9; decisions.md "Window size follows the client that acted last"; probe evidence `docs/design/research/probe-latest-activity.md`; review `.meridian/work/tether-mvp/design/review-window-size-latest.md`; lane text in `.meridian/work/tether-mvp/build-plan.md` (PS-daemon). Commit e334e0e holds the design; 96216b1 the paste lane you build on.

Scope (from the lane): claims and yields in `src/hub/` (state, requests, reconcile: desired votes become claimed bound windows, so `withdraw` clears a vote on a window the client still owns but nobody claims); `claim?` on `watch` in `src/proto/` and the regenerated `web/proto/generated/messages.ts` (optional field, so web compiles unchanged); `Event::Acted` and the window subscription format/parsing (tmux `L:` client loop with activity, size, flags; baseline after Subscribe; focus-out, leaving and ignore-size clients are not acts) in `src/tmux/` (command, session); fixtures re-recorded on 3.4 and 3.7b; the real-tmux sizing test (§8) with a pty "laptop" client on both versions; CHANGELOG bullet.

Read `AGENTS.md` (sans-IO cores, thin I/O, bounded queues, no polling) and the nearest `.context/` in `src/`.

## Concurrency note
A frontend lane (P3a, p123) is editing `web/` in this same checkout right now. Do not edit `web/` except regenerating `web/proto/generated/messages.ts`. Its in-progress edits may make web checks fail; for your verification run the Rust gate (`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --locked`, `cargo build --release`), `cargo +1.85 check --locked --all-targets`, and `pnpm --dir web exec tsc --noEmit` only to confirm the generated types compile (if it fails only in P3a's files, say so). I run the full preflight on a clean export at commit.

## Verify
- Hub unit tests from §8; real tmux 3.4 and 3.7b (`/tmp/tether-meridian-501/tmux/{3.4,3.7b}/bin/tmux`, also 3.8 system), isolated `-L` servers only: a laptop pty client typing takes the window back (vote cleared, window grows to latest); the phone's claiming watch caps it again; a reconnect `watch {claim:false}` doesn't claim; focus-out/ignore-size don't count; no reports when nobody else acts (no polling, no new periodic op).
- Do not commit. Report files changed, spec points → implementation, verification by type and tmux version, divergences.
Spawn env: `TMPDIR=/tmp/tether-meridian-501`.
