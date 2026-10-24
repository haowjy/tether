# Lane PC: paste confirmation (daemon + web), one commit's worth of change

Implement the paste confirmation exactly as specified in `docs/design/daemon-core.md` (search `pasted`, `paste { req`, §3.4, §4.4, §5.3 and the failure table) and `.meridian/work/tether-mvp/design/client-architecture.md` §10–11 (lane PC). Design was reviewed (p114 verified the protocol against the hub code and that a failed paste skips later commands on tmux 3.8). Commit 7372e37 holds the spec.

Summary of the spec (the docs win if they differ):
- `paste` gains `req` and `enter`. The daemon answers every paste exactly once: `pasted { req, watch }` on success; refusals (connection- or hub-level) carry `req`; a tmux failure answers `error { tmux }` with req. If tmux stops answering first (crash, reply timeout, linger close) the reply is an error saying the paste may have been sent; never resent.
- With `enter: true`, `send-keys Enter` goes in the same tmux command list as the paste so tmux skips it if the paste fails.
- The hub's existing handling for requests tmux never answers (as for `History`) is the model for `Paste`.
- Web side in the same change (a required `req` breaks `tsc` otherwise): `web/tabs/input.ts`, `web/net/host.ts`, the generated protocol types, `web/screens/terminal/terminals.ts`. Client shows "Not sent" for a refusal, "May not have been sent" for a tmux error or dropped socket; no client-side timeout. The line field (P3a) will use `enter: true`; existing paste (desktop Ctrl+Shift+V, image path insert) uses `enter: false`.

Read first: `AGENTS.md` (repo root) — sans-IO cores, thin I/O, bounded queues; `docs/design/plan.md` "Code structure and standards"; nearest `.context/` docs in `src/` and `web/`.

## Verify
- `scripts/preflight.sh full` passes (fmt, clippy -D warnings, tests, release build, web checks). MSRV: `cargo +1.85 check --locked --all-targets` (no let-chains etc.).
- Real tmux, never Jimmy's sessions: isolated servers (`tmux -L <name>`), and the real-tmux suites (`TETHER_TMUX_TESTS=1`, `TETHER_TMUX=<binary>`, one at a time). The repo requires tmux 3.4 and 3.7b; this Mac has only 3.8. Build tmux 3.4 and 3.7b from source (release tarballs from github.com/tmux/tmux; libevent/ncurses via Homebrew if needed) into `/tmp/tether-meridian-501/tmux/<version>/` so later lanes reuse them, and run the paste-related real tests on 3.4, 3.7b and 3.8. Specifically prove on each: a successful paste+Enter runs; a refused paste (busy/over limit) sends no Enter and the reply carries req; a paste to a dead pane fails and skips the Enter. If a version can't be built, say why and run the rest.
- Exercise the web client against a running daemon (dev harness or the real daemon with an isolated tmux): desktop paste still works and the new reply is handled.
- Keep new tests only where the spec names fixture tests (failure table / protocol fixtures); delete throwaway checks you wrote to verify.

## Constraints
- Do NOT commit. Another lane (design docs, p115) is editing `docs/design/daemon-core.md`, `plan.md`, `decisions.md` and client docs in the same checkout right now: don't edit those files; if the code must diverge from the spec, write the divergence in your report instead.
- CHANGELOG: add an `[Unreleased]` bullet only if user-visible (paste refusal now reports "Not sent"/"May not have been sent" — probably yes, one line).
- Spawn env needs `TMPDIR=/tmp/tether-meridian-501`.

## Report
Files changed (one line each), how each spec point is implemented, verification by type with the tmux versions actually run, anything that diverged from the spec, the tmux build location.
