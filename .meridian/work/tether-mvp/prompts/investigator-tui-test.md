# Is the real-tmux TUI snapshot failure a regression from tonight's commits?

On tmux 3.4 and 3.8 (not 3.7b), `TETHER_TMUX_TESTS=1 cargo test --test tmux_real --
--test-threads=1` fails `an_alternate_screen_tui_at_full_speed_restores_at_every_snapshot`,
and combined runs on 3.4 show intermittent stress-test failures (report:
`meridian spawn show p54`). CI runs the real-tmux job on Ubuntu, so this blocks the push.
Tonight's commits on `main` (unpushed) since `63abbb6`: `f94a83c` history ranges,
`75dd513` soft wraps (snapshot paint changed), `ce9ca40` limits, and fixes `df527e7`,
`ba8c40d` (repaint a continuation row), `785d989`, `9fbdd9f`, `15fc3dd`, `c40b3a9`,
`2c7005b`. `origin/main` is `54abaaf`-ish and passed CI.

Find out whether the failures exist at `origin/main` (run the same tests from a clean
export: `git archive <sha> | tar -x -C /tmp/tether-tui-<n>`), and if they are new, which
commit introduced them and why (bisect over exports). Then fix the cause in `src/tmux/`
(or the test, if the test is what's wrong — say which and why), as a commit with an
explicit pathspec, passing `scripts/preflight.sh full` on a clean export and the
real-tmux suite on all three tmux versions: `TETHER_TMUX=/tmp/tether-wrap-build/prefix/3.4/bin/tmux`,
`.../3.7b/bin/tmux`, `/opt/homebrew/bin/tmux`. Run the suite several times per version
to separate flakes from failures. Isolated `-L` sockets only; never touch other tmux
sessions. Another agent is rebuilding `web/` in the working tree: don't edit `web/`.
Commit message ends `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.
