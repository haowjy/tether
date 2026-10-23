# Fix the review findings on browser admission (47b4d93)

Your commit 47b4d93 was reviewed by two lanes; read both reports in full, they carry probes and
file:line evidence: security /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p79/report.md, design alignment /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p80/report.md. Design:
.meridian/work/tether-mvp/design/browser-auth.md rev 6.

Fix:
1. **High, idle 503** (identity.rs:144-151): a cell that is merely old (no failed read) must start
   or join a read and wait; the 30 s hold applies only after a failed read. Merge the duplicated
   success/failure bookkeeping in refresh/retry. Add the §6 acceptance rows for the cell (outage at
   20 s and past 30 s) and a test on the default allowlist path (no --allow-login), using paused
   tokio time if it fits; the test daemon always passes --allow-login today, which hid this.
2. **Medium, refused auth.toml rows deleted on write** (store.rs parse/update): keep refused rows
   as raw TOML and write them back unchanged; `tether device remove <name>` can match one by name.
3. **Medium, error codes**: add bad_origin, node_refused, not_enrolled, identity_unavailable to the
   shared HttpError (src/proto/error.rs) per §5 fs.md; regenerate web/proto/generated/ (preflight
   checks it is fresh); delete the hand-built JSON in http/mod.rs and the stale half of
   error.rs auth() so there is one mapping.
4. **Medium, docs**: decisions.md (mark the contradicted older entries superseded or qualified;
   restore §4's Rejected and Changes lists; log the 2→30 s backoff as its own decision, with its
   side effect that recovery can lag tailscaled by up to 30 s, and take the rationale out of
   auth.md); auth.md lines p79 L4 and p80 list (re-read rule, stray sentence, $TMPDIR vs confstr,
   draft section references, Module shape matching the code, a probe-gates section G1–G12 that
   browser-setup.md links to); CHANGELOG [Unreleased] and docs/running.md carry the breaking
   upgrade step (the sudo tailscale serve … unix: command, 502 until then, port ignored); fs.md
   loopback-hop and shutdown text; plan.md's dropped native web-hardening pointer and "a Mac is a
   fine client" note; ios-shell.md hostRejected → enrolment screen.
5. **Lows**: live-socket re-check off the socket's event loop (p79 L1); default device name is the
   first DNS label; admit on the freshly re-read row (p80); startup/origin-change logging from the
   cell's fill; JSON 404 for any method under an API prefix; stable ID in node-lane refusal logs;
   compute shell ETags in build.rs; delete dead code (AuthError::WrongFront, ServeConfig::read,
   Auth::new, backend_state); multi-encoded-word login decoding; device list status read under the
   cap; macOS runtime dir: choose confstr or document $TMPDIR, and fix the "on Linux" message;
   web/vite.dev-proxy.ts default target (no more 127.0.0.1:7850: the daemon's local.sock).
6. **One slots-plus-waiters type** (thermo review /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p81/report.md L2): blocking::Lane::wait_for and
   http/shell.rs's semaphore pair implement the same rule; make one type with an optional deadline,
   each route owning its named limits (shell's 4/16 literals in server.rs become named constants).

You own: src/auth/**, src/http/**, src/blocking.rs, src/proto/**, src/config.rs, src/fs/**, build.rs,
contrib/, tests/http_*.rs, tests/support/daemon.rs, web/proto/generated/**, web/vite.dev-proxy.ts,
docs/design/{auth,decisions,fs,plan,ios-shell}.md, docs/design/client/{browser-setup,connection-roadmap}.md,
docs/running.md, CHANGELOG.md, src/auth/AGENTS.md, src/http/AGENTS.md. Another coder owns
src/main.rs, src/budget.rs, src/tmux/**, src/hub/**, tests/tmux_real.rs and docs/design/daemon-core.md:
if you need a change there (e.g. main.rs:63 device-add help text, daemon-core §5.1), put the exact
edit in your report instead. AGENTS.md has an uncommitted pnpm note that is not yours: leave it.

Commit rules (two coders share this checkout): commit only paths you own, with `git commit --only -m ... -- <paths>` (new files: `git add <file>` immediately before that commit); never `git add -A`, `-a`, or a bare `git commit`. One change per commit, each passing `scripts/preflight.sh full --commit <sha>` run with your own `TETHER_PREFLIGHT_DIR=/tmp/tether-meridian-501/pf-<your-spawn-id>`. Use pnpm-free commands as they exist today (the repo still uses npm until a pending switch lands; do not touch package files). Never touch the installed tether service, Tailscale serve config, or real tmux sessions (real-tmux tests: private -L sockets, TETHER_TMUX_TESTS=1, TMPDIR=/tmp/tether-meridian-501). Do not push. Commit messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

Verify each risk on a running daemon, not only in tests (idle >30 s then shell/native/fs requests
succeed; a refused row survives enrol/remove). Report commits, what each verifies, what you
deferred and why, and edits needed in files you don't own.
