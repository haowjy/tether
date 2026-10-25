# Round 2: check the `tether setup` design fixes

Two reviews (p192 structure/correctness, p193 cold reader; their reports are attached via --from) found issues in the uncommitted design docs in /Users/jimmyyao/repos/tether. The designer revised:
- `docs/design/setup.md` (rewritten)
- `docs/design/decisions.md` "## tether setup" section (updated entries)
- `docs/running.md` (new lede, Install with pnpm, Set it up, Mac stop/start split, Enrol more devices, Manual setup)
- `docs/design/auth.md`, `docs/design/plan.md` (small touch-ups)

Check: did each major finding (p192 M1–M3, p193 F1–F4, R1–R5) get fixed correctly, and did the fixes introduce new contradictions between the five documents or new correctness problems? Pay attention to: the restart order (restart, publish, restart again only if the write changed Serve) and verification waiting for the new daemon by `local.sock` inode; the single matcher for tether's handlers (exact `unix:` path on Linux, tether-shaped on the plist's port on a Mac) shared by publication and teardown; Mac teardown order (read serve config, bootout, withdraw); the Mac Login Items/GUI-session/hand-install checks.

Report only what remains wrong or newly wrong, with severity and location. Don't edit files. If it's clean, say so plainly.
