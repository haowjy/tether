## Additional ordinary-use crash confirmed

Opus review matched an earlier integration timeout to a tmux 3.4 SIGSEGV in `control_write <- control_notify_client_detached`, then an independent raw-tmux probe reproduced it. This is a **separate bug** from the destroyed-session notification described above: a new control client has CLIENT_CONTROL set before its identify handshake allocates control_state. A notification in that gap dereferences NULL. Early client exit also crashes control_stop.

- Default-environment real attach/detach race: 2/300 crashes on 3.4. Enlarged environment and narrowed timing: 59/300. These are workload-dependent reproductions, not production probabilities.
- Deterministic half-identified-client reproduction dies on 3.4; 3.7b survives. Real-client races on 3.7b: 0/300 for each detach method.
- Fixed in 3.7 by https://github.com/tmux/tmux/commit/e5a2a25f and https://github.com/tmux/tmux/commit/31c93c48 (#4980 / #5004).
- tether can reach this in normal tab opening/linger eviction; external terminal actions can trigger it too. Serializing daemon operations only narrows exposure. Increasing test timeouts is not a fix.

**Decision still needed:** choose and verify a tmux baseline/backport containing BOTH the handshake fixes and the destroyed-session fix (035447b0). Merely upgrading to 3.7b does not address the original reproduction. Do not upgrade the installed host without Jimmy. No deployment on affected baseline is signed off.

Evidence: `.meridian/work/tether-mvp/evidence/session-follow-tmux-attach-crash.md`, client final review, and `docs/design/daemon-core.md` §9. Exact timing of the historical integration crash is inferred; its crash stack and the raw-tmux cause are confirmed.
