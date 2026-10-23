# G2 fixes for the rebuilt web client

Three G2 lanes reviewed commit d051e21; read all three reports in full (each has file:line,
scenarios and repro scripts): Home+Terminal /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p96/report.md, Files+PWA /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p97/report.md,
browser probe /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p98/report.md. Since then p99 landed Add folder, listing coalescing and two tests
(its report: /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p99/report.md). You are the only writer in this checkout.

Fix, choosing the shape yourself (fix the class where a reviewer names one):
- p96 **H1** (close never sends unwatch; MAX_WATCHES leak), **M1** (resize during in-flight watch
  lost; also check it explains p99's "drag resizes tmux twice" flake), **M2** (watch error retries
  ~2 Hz forever, hides the daemon message), **M3** (Settings closeAll double back fails in WebKit;
  give the router a proper multi-close), **M4** (superseded snapshot un-blanks the wrong tab),
  **L1** (save only when the saved projection changed), **L2** (image-paste toast truthfulness),
  **L3** (storage-closed banner must not resize the terminal).
- p97 **H1** (double upload on re-pick), **H2** (Markdown sanitizer: allowlist tags and attributes,
  click handler covers a and area and cancels other navigation; close the class), **M3** (refuse to
  insert paths containing C0 or DEL, with a notice), **L4** (insert disabled unless the tab is live;
  a pending insert dropped with a notice when the watch fails), **L5** (sw network fallback for a
  missing hashed asset), **L6** (choose: daemon answers 503 to the precache's / while the origin is
  unknown, or always emits wss://<host>; src/http/shell.rs is yours for this), **L7** (Update after a
  hard reload), **L8** (refuse > 128 MiB before sending), **L9** (mailto: opens or is not a link).
- p98: Home's "Another terminal is attached. Opening may resize it." notice is missing on the real
  daemon (both browsers, tmux 3.4 and 3.7b), although p95 reported that spec passing. Find why
  (regression or environment) and fix.
- p99: the create request failing with "Couldn't reach pop-os" under heavy load (WebKit, tmux 3.4).
  Investigate the 5 s request timeout against "usable on spotty, barely-there connections"
  (AGENTS.md): should a create on a live but slow socket time out at 5 s? Fix what the evidence
  supports and say what you changed.
- Report only, no change: keyboard users cannot Tab out of a focused terminal (Tab goes to the
  shell). Check whether client-architecture.md or browser-behaviors.md define a way out; list
  options with tradeoffs for Jimmy.

Tests: extend existing tests where a changed behaviour already has coverage (driver tests for
unwatch on close and resize-in-flight, the sanitizer, the router, insert); no new spec files except
a WebKit Settings confirm case added to an existing spec if one fits. Docs: update
browser-behaviors.md, decisions.md and client-architecture.md (work dir) where a fix changes a rule.

Commit each coherent change with `git commit --only -m ... -- <paths>` (git add new files first),
one change per commit, each passing `scripts/preflight.sh full --commit <sha>`. Don't push. Commit
`.meridian/` only for the client-architecture.md edits. Messages end
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. pnpm only; minimum Rust 1.85 (no let
chains). TMPDIR short (e.g. /tmp/tg2) for real-daemon runs; TETHER_E2E_PORT=5222. Never touch the
installed tether service, Tailscale serve config, or real tmux sessions. End with `pnpm check`, the
default e2e suite, and `pnpm e2e:real` (report load average with the counts). Report commits, each
finding fixed or not (with reason), and verification.
