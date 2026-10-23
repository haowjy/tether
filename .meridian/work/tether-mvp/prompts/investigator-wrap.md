# Design the fix: snapshots lose soft-wrap, so copy after reconnect breaks lines

Symptom: when a tab (re)watches, the daemon sends a snapshot and the client repaints;
the repaint loses which rows were soft-wrapped, so copying text that wrapped yields
hard line breaks. Evidence so far: `docs/design/client/terminal-interaction-probe.md`,
`terminal-selection-source-research.md` (pinned xterm 6.0.0 headless probe). Relevant
code: `src/tmux/` snapshot capture, `src/hub/`, `src/proto/`, `web/term/`. Spec:
`docs/design/daemon-core.md` (snapshots, history).

Find the causal chain and propose the fix at the right boundary (capture flags such as
`capture-pane -J`/`-N`, a wrap bitmap in the snapshot frame, how xterm can be fed wrapped
rows, same for `history` chunks), with its byte and memory cost (connections are
spotty; the daemon is budgeted). Verify on real tmux only through an isolated server
(`tmux -L tether-wrap-<you>` with a fresh `TMUX_TMPDIR`); never touch existing sessions.
Do not edit source: write the analysis and proposed spec text to
`.meridian/work/tether-mvp/design/snapshot-wrap.md`, partial findings first. Note 3.4 vs
3.7b differences if you can check them (3.7b is on this Mac via `tmux -V`?).
