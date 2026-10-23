# P2 integration (one writer)

Landed all lane requests as W0 changes (commit d308079 and the lane commits that use them), deleted every
stand-in, and committed the lanes in 21 commits, each passing `scripts/preflight.sh full --commit <sha>`.

Judged and changed from the request as filed:
- W1 #8 (daemon LocalAPI env hook): rejected. The e2e front proxy answers `/auth/info` instead.
- W1 #1 busy retry and W2/W3 `FakeLink` hooks: landed as `FakeDaemon.watch` and `FakeDaemon.fs`; both are used by
  harness fixtures (terminalLive, terminalLimited, `/fs/roots` for the Files route).
- W3 #4 `uploads` option on the test platform: not landed (no consumer; Files' fixtures overwrite `pick`). In `.context/FUTURE`.
- W3 #7 grammar stubs: not changed (file count only); now 14 stubs, shell is 48 files, 569.8 KB gz.
- "Saved host record" (offline banner): built as `SavedWorkspace.hostName`, saved by Persist, seeded into the
  browser host's entry at boot.
- `build.rs` deadlocked writing large incompressible assets to gzip (hung `cargo build` on macOS): fixed with a writer thread.
- Real-daemon specs are `*.real.ts` (not `*.spec.ts`), run with `pnpm e2e:real`: the default run no longer needs tmux builds.
