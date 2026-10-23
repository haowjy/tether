# TUI snapshot assertion diagnosis

## Scope and decision

- Tested clean `git archive HEAD` export `948868f7db9063fec91d020d526fb35877f660d7` at `/tmp/tether-tui-r2-head`; no source edits in the primary checkout.
- **Fix is test-contract only.** The existing snapshot format cannot carry the current SGR pen, so continuity comparisons should not require styled-output replay fidelity across a boundary. Keep checking captured cell styles directly against tmux via `capture-pane -e`; update the snapshot comment to describe the actual limitation without suggesting it applies only to 3.4.
- No tmux production behavior change is supported by the evidence. The separately failing numbered-line stream test is not explained by the SGR issue and remains unlocalized.

## Evidence and causal chain

- `src/tmux/snapshot.rs:11-18` defines state formats/fields; `src/tmux/command.rs:68-77` requests state, styled cell captures (`capture-pane -e`), pending parser bytes, saved-grid capture, and a state re-read. Neither contains the active SGR pen. `src/tmux/snapshot.rs:66-68` already documents it as un-restored; `docs/design/daemon-core.md:406-410` calls it out as not in the formats.
- Private-server runtime queries on tmux 3.4, 3.7b, and 3.8: `display-message -p '#{pane_sgr}'` returned empty and `display-message -a` had no `pane_sgr` variable. `capture-pane -e` reports styles on cells, not the active pen for future output.
- On a clean export of origin/main `54abaaf` (prior evidence), a 3.4 failure showed first styled difference at row 10 col 1: continued `"o"` had foreground `Default`, expected `Idx(2)`; modes/cursor matched. A tmux 3.8 run showed row 7 col 13 `"r"` underline false vs true; another showed row 10 col 1 foreground `Default` vs `Idx(1)`. The differing cells/attributes varied with timing; this is consistent with bytes emitted under the live pen after a snapshot whose restore resets SGR.
- No styled mismatch was observed on tmux 3.7b in the earlier run. More importantly, on current HEAD the original full-`look` TUI test passed 5/5 on each of 3.4, 3.7b, and 3.8. Thus current HEAD did not reproduce the reported TUI failure, but the assertion still demands a behavior the documented snapshot contract cannot guarantee.
- Distinction: snapshot cell styles are available and should remain checked. The patch changes `check_restores` to compare text/cursor/input modes across live-output replay; `check_against_tmux` now uses one styled capture to check text plus captured cell styles against tmux. No broad loss of style checking at the direct snapshot oracle.

## Separate numbered-line gap

- On current HEAD, uninstrumented tmux 3.8 focused runs failed 4/5 times with a true discontinuity in collected `Event::Output` bytes: `L1742→L1744`, `L1755→L1757`, `L3204→L3206`, and `L1087→L1089`. The failure is `check_numbered_once` in `tests/tmux_real.rs` (near line 496), not a style comparison.
- The independent `@prober` instrumented raw control stdout and `Event::Output` for nine 3.8 runs; those instrumented runs passed 9/9 and both byte streams contained every numbered line (1–188875), with no `%pause`, `%continue`, or `Event::Gap`. It also confirmed `L1738–L1747` in both streams. This did **not** reproduce the loss, so the first layer where a missing line occurs (tmux control output vs pump/parser/session) remains unknown. Do not attribute it to the SGR limitation or modify production output handling without a failure captured at the layer boundary.
- Full-suite results with the patched test, after `npm ci --prefix web --ignore-scripts` in the export: 3.4 **16/16 pass**, 3.7b **16/16 pass**, 3.8 **15/16 pass**; only the numbered-line continuity test failed on 3.8. Separate 3.8 focused numbered-line runs were inconsistent (4/5 fail before instrumentation; instrumentation 9/9 pass). This remains an independent follow-up.

## Verification

- Patched focused TUI test: **3/3 pass each** on tmux 3.4, 3.7b, and 3.8 (clean HEAD export, private `-L` sockets, `TMPDIR=/tmp/tether-meridian-501`).
- Full real-tmux suite: 3.4 16/16; 3.7b 16/16; 3.8 15/16 (numbered-output failure above).
- `cargo fmt --check`: pass. `git apply --check` of `tui-snapshot-fix.patch` against a second clean archive of HEAD: pass.
- Version paths: `/tmp/tether-tui-r2-head/prefix/3.4/bin/tmux` (tmux 3.4), `/tmp/tether-tui-r2-head/prefix/3.7b/bin/tmux` (tmux 3.7b), `/opt/homebrew/bin/tmux` → `/opt/homebrew/Cellar/tmux/3.8/bin/tmux` (tmux 3.8). The first two were built under the export's `/tmp` tree from official tmux release tarballs with local Homebrew libevent/ncurses and `--disable-utf8proc`.
- Tests use private `-L tether-test-<pid>-<name>` servers with `/dev/null` config (`tests/support/tmux_server.rs:28-42`); no matching sockets remained. The default socket was absent (`tmux has-session` reported no server).

## Structural review

The useful simplification is separating two different promises: restore faithfully paints captured cells, while current drawing pen is absent and cannot be replayed from snapshot state. No production branch or version-specific fallback is warranted. The test retains one shared capture response for its text/style oracle, avoiding two captures that could observe different frames. The remaining duplicated cell traversal in test-only `screen_text` and `screen_styles` is small and focused; extracting a generic helper would add abstraction without removing meaningful concepts.
