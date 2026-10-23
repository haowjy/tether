# Test-gate verification

## Test runs

- Before the HTTP harness change, `cargo test --test http_auth` passed 6/6, then a
  20-run batch passed 18/20. Both failures were `Connection reset by peer` in
  `every_route_needs_the_tailscale_login` at `tests/support/daemon.rs:158` (2/20 in
  that batch; 2/26 overall).
- After sending head and body in one write, retaining bytes read before a reset, and
  checking `Content-Length` on a reset, `cargo test --test http_auth` passed 20/20.
- `scripts/preflight.sh full` passed on macOS with Rust 1.94.1: fmt, Clippy, 71 lib
  tests, integration tests, release build, and web check (89 tests).
- `cargo test --locked --lib fs::list::tests` passed 2/2; `... fs::open::tests`
  passed 7/7. The Linux-only non-UTF-8 filesystem checks are cfg-excluded on macOS.
- Real suites ran with tmux 3.8 and a fresh `TMUX_TMPDIR` for each run. Final run:
  `hub_real` passed 4/4; `tmux_real` passed 14/16. The remaining failures are the
  expected tab-in-window-name rejection at `tmux_real.rs:986` and a 3.8 observation
  where the new-session window name was `tmux`, not the expected `sh` (its canonical
  temporary path matched). A first full run also failed the stall/output test once;
  a focused rerun and the final full run passed it.
- `actionlint .github/workflows/ci.yml` passed. Running actionlint across the release
  workflows also reports existing ShellCheck warnings in their unrelated scripts.

## Decisions and remaining verification

- Vitest resolves the Vite config in `mode: "test"`; only that mode omits the dev
  proxy. A live Vite request with `TETHER_DEV_LOGIN=devtest` still reached a local
  upstream with `Tailscale-User-Login: devtest`.
- The blocking-lane admission uses the same AcqRel success / Acquire failure CAS as
  `fetch_update`: it increments only below the cap, retries contention, then leaves
  the same RAII decrement and timeout path in place. The installed Clippy 1.94.1
  passed before and after this replacement; the audit's deprecation warning was not
  reproducible on that toolchain.
- A real HTTP/1.1 client can also race an early refusal with an unread POST body and
  observe a connection reset on close; the test's separate writes made that race more
  likely. No production HTTP behavior was changed.
- CI now pins 1.94.1 in build/check/release jobs; the MSRV job explicitly invokes
  `cargo +1.85` to override the project pin. The Ubuntu real-tmux job logs `tmux -V`
  and runs both suites serially.
- The default tmux socket had no server before or after testing. Test support starts
  only `-L tether-test-<pid>-<name>` servers; local runs additionally used a separate
  temporary `TMUX_TMPDIR`, so no user's server or session was touched.
- Linux-only filesystem behavior and the Ubuntu-installed tmux version/suites remain
  for CI to prove. Docker was not running on this Mac.
