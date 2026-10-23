# Apply the thermo review of the limits and wrap lanes

Read the review in full: /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p81/report.md (strict maintainability, with probes). Specs:
docs/design/daemon-core.md §3.4–3.5 (snapshots, history, wrap) and §6 (budget). Apply:
1. **Wrap**: one escape scanner in wrap.rs (`escape_end`) used by align's stripping and by
   snapshot::first_character; this fixes M1 (an OSC 8 hyperlink in a history chunk erases every wrap
   bit). Replace align's boundary loop with the single running-offset rule the review verified on
   300,000 random cases. History owns the row/bit invariant: History.wraps is a WrapMap with one
   History::truncate(n), into_bytes only at the proto boundary; delete wrap::truncate_packed and the
   duplicate truncation (L1); tests/tmux_real.rs uses WrapMap::wraps instead of decoding bits by
   hand. Delete the unreachable range check in history::from_replies (L3) and WrapMap's unused
   Default derive (L4). Verify on real tmux 3.8 that a hyperlinked long line keeps its wrap bit.
2. **Limits**: resolve returns Result<&'static Tier, BelowMinimum>; delete Budget and caps() (update
   main.rs). The test-only cost table moves into mod tests as data (a list of fixed rows plus per-cap
   costs); add the two rows 47b4d93 added to §6.3 (shell slots kernel buffers 1 MiB, LocalAPI answers
   0.3 MiB) and make the test assert the spec's published ceilings (63.6/58.3/53.0/48.8/37.5) so a
   spec-only edit fails it (H1). Delete tiers_keep_the_round_boundaries_and_caps (M3). If the 53–57
   tier margin is now too thin by the spec's own headroom rule, say so rather than silently moving a
   boundary: tier boundaries stay round (72/64/58/53/42) by Jimmy's call.
3. **daemon-core.md**: fix the §3.4/§3.5 capture code blocks to match command.rs (M2); delete the
   §6.1 debug-endpoint sentence (L5) and keep §6.1's claim about the ceiling test true; §5.1 per the
   alignment review /Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p80/report.md (4401 and 4503 meanings, 4423 reserved, tether.v1 only, runtime
   exit codes 78 and 1, as implemented in 47b4d93: read src/http/ws.rs and src/runtime.rs);
   main.rs:63 `device add` help says it adds a native device, for the dev shim or Playwright.
4. Not yours: the slots-plus-waiters unification (review L2) belongs to the other coder.

You own: src/budget.rs, src/tmux/**, src/hub/**, src/main.rs, tests/tmux_real.rs,
docs/design/daemon-core.md, src/tmux/AGENTS.md and .context/. Another coder owns src/auth/**,
src/http/**, src/blocking.rs, src/proto/**, src/config.rs, build.rs, tests/http_*.rs and the other
docs; put any edit you need there in your report. AGENTS.md has an uncommitted note that is not yours.

Commit rules (two coders share this checkout): commit only paths you own, with `git commit --only -m ... -- <paths>` (new files: `git add <file>` immediately before that commit); never `git add -A`, `-a`, or a bare `git commit`. One change per commit, each passing `scripts/preflight.sh full --commit <sha>` run with your own `TETHER_PREFLIGHT_DIR=/tmp/tether-meridian-501/pf-<your-spawn-id>`. Use pnpm-free commands as they exist today (the repo still uses npm until a pending switch lands; do not touch package files). Never touch the installed tether service, Tailscale serve config, or real tmux sessions (real-tmux tests: private -L sockets, TETHER_TMUX_TESTS=1, TMPDIR=/tmp/tether-meridian-501). Do not push. Commit messages end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

The real-tmux suite must stay green on 3.8 (homebrew) and, if you can build them (see how p65 did,
via --from is not available: build official 3.4/3.7b release tarballs into a /tmp prefix with Homebrew
libevent/ncurses and --disable-utf8proc), on 3.4 and 3.7b. Report commits, verification per
version with run counts, and anything you disagreed with.
