# Make the real-tmux tests pass on tmux 3.8

`TETHER_TMUX_TESTS=1 cargo test --test tmux_real --test hub_real -- --test-threads=1`
fails two ways on tmux 3.8 (macOS here): (1) a tab in a window name — 3.8 rejects it
with "invalid window name"; gate that case on the detected version rather than deleting
the coverage for 3.4/3.7b; (2) a test asserts the default window name `sh`, but 3.8 on
macOS shows `tmux`/`bash` because of automatic-rename timing and /bin/sh being bash:
stop asserting the default name. Edit only `tests/` (and `src/tmux/.context/TODO` to
remove the 3.8 item if fixed). Never touch existing tmux sessions; tests use private
`-L` sockets. Run the real-tmux tests and `cargo test`; do not commit. Report changes
and results.
