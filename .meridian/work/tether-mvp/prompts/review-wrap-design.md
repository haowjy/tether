# Structure review before implementing wrap-preserving snapshots

Review `.meridian/work/tether-mvp/design/snapshot-wrap.md` against the code it lands in:
`src/tmux/command.rs`, `src/tmux/snapshot.rs`, the history path, `src/proto/frames.rs`,
`src/hub/`, `web/term/pipeline.ts`, and `docs/design/daemon-core.md`. The fix: carry a
wrap-forward bitmap with snapshots and history chunks; on tmux 3.7b+ read it from
`capture-pane -F`; on 3.4 derive it by aligning a `-N -T` capture with a `-J` capture,
leaving ambiguous bits unset; restore wrapped rows through xterm's autowrap instead of
CUP. Find the simpler structure before code exists: where the version branch should
live, whether two captures on 3.4 can share one round trip, wire format cost on spotty
links, budget charging, and anything the design leaves without an owner. Severity per
finding; write to `design/snapshot-wrap-review-1.md` (or the report). Edit nothing else.
