# Lane PC: fix the review findings (p121), still uncommitted

Read `meridian spawn show p121`. Fix:

- **M1 (must):** with `enter: true`, Enter can go to copy mode while `pasted` claims success. Decision (tech lead): the `enter: true` group starts by quitting any pane mode so the paste and Enter both reach the program: `copy-mode -q -t <pane/window target>` (verify `-q` exists and behaves on tmux 3.4 and 3.7b at `/tmp/tether-meridian-501/tmux/{3.4,3.7b}/bin/tmux`; if not on 3.4, use an equivalent that is a no-op when not in a mode and never errors the group). Rationale for the spec: the user acted on the phone, so leaving the laptop's copy mode is the user's intent (consistent with "last active wins"). Only `enter: true` quits modes; plain paste is unchanged. Add a copy-mode case to the paste fixture recording (re-record on 3.4 as the fixtures are), and update `docs/design/daemon-core.md` §3.4 (and the failure table if affected) in a minimal edit stating the rule — this file is now free to edit (the other lane committed).
- **L1:** a paste result notice names the tab it belongs to (pass the tab id through `onPasteResult` → `pasteResult`), per client-architecture §7.5 "shown on the tab".
- **L2:** keep `enter` (P3a uses it next); omit `enter: false` on the wire since it's optional.
- **L3:** `git add tests/fixtures/proto/messages.json` is mine to do at commit; leave the file, but if no web test reads it, keep it Rust-only and say so in a comment at its include site only if non-obvious.
- **L4:** fix the stale line in `.meridian/work/tether-mvp/design/client-architecture.md` (~163) about errors with no `req`.
- **L5:** no new test (project policy: no new tests unless asked); I'll propose it to Jimmy.

Then rerun `scripts/preflight.sh full`, `cargo +1.85 check --locked --all-targets`, and the real-tmux paste checks on 3.4, 3.7b, 3.8 including copy mode: pane in copy mode + paste with enter → command runs and pane leaves the mode. Do not commit. Report changes and verification.
Spawn env: `TMPDIR=/tmp/tether-meridian-501`.
