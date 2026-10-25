# Remove `attachedElsewhere` end to end

Jimmy asked to remove the session list's note "Another terminal is attached. Opening may
resize it." ("who cares if it's gonna resize"; switching between his laptop terminal
and tether works fine under the acted-last sizing rule). That note,
`web/screens/sessions/SessionList.tsx:118`, is the only reader of the listing's
`attachedElsewhere` field. Delete the whole path, not just the line:

- Daemon: `attached_elsewhere` in `src/tmux/mod.rs` (ListedSession), how
  `src/tmux/reply.rs` computes it (the `attached` set: if a tmux command or format field
  exists only to compute it, remove that too, and re-check recorded tmux fixtures and
  tests that depend on it), `src/hub/requests.rs`, `src/proto/messages.rs`.
- Generated TypeScript `web/proto/generated/messages.ts`: regenerate the way the repo
  does (find the generator; don't hand-edit if a generator exists).
- Web: the SessionList line and its `.attached` CSS rule (`SessionList.module.css`),
  fixtures in `web/harness/home/index.ts`, `web/harness/shared/index.ts`, test literals
  in `web/app/listing.test.ts`, `web/proto/window.test.ts`, `web/workspace/state.test.ts`,
  `web/e2e/home/home.real.ts:81`.
- Docs (current rule only): `docs/design/daemon-core.md` (ListedSession, the `sessions`
  reply table), `docs/design/client/browser-behaviors.md` item 3, the mockup
  `docs/design/client/mockups/index.html` (attached-note), and add a decision to the end
  of `docs/design/decisions.md`: what, why (Jimmy: the note isn't useful; acted-last
  sizing makes the resize harmless; one fewer field per listing), rejected (keeping the
  field for a future use). Check `.context/` and AGENTS.md notes near the touched code.
- CHANGELOG `[Unreleased]`: only if a released version showed the note (check git tags /
  CHANGELOG history); otherwise none.

Another agent (p212) is editing `web/ui/primitives/*`, `web/screens/files/*` and maybe
other web CSS concurrently in this same checkout. Do not touch files outside this list;
before editing `SessionList.tsx` / `SessionList.module.css`, check `git diff` on them and
keep any change you find. Do not commit; the lead commits by pathspec.

Verify: `cargo test`, `cargo clippy --all-targets -- -D warnings` (and
`--target x86_64-unknown-linux-gnu` if installed), the real-tmux integration tests if
reply parsing changed (see `tests/` and AGENTS.md; isolated `-L` sockets only, never
Jimmy's tmux), `pnpm --dir web run check`. `grep -rn "attachedElsewhere\|attached_elsewhere\|Another terminal is attached"`
must find only the decision entry. Report the files changed and verification.
