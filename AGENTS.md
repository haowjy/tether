# tether

Phone-first client for tmux on a dev server, over Tailscale. A Rust daemon bridges
tmux control mode to an installable web app. The design and its review are in
`docs/design/`; read them before adding a subsystem.

## Safety Rules

- **Never merge a PR into `main` without explicit human approval** in the current
  conversation. Approval for one PR does not carry to the next.
- **Never create or push `v*` tags by hand.** CI owns them; the pre-push hook blocks it.
- **Never use `--no-verify` on git push** unless explicitly told to.
- **Never edit generated agent directories** (`.claude/agents/`, `.claude/skills/`,
  `.codex/`, `.cursor/`, `.opencode/`, `.pi/`, `.agents/`). `meridian mars sync`
  overwrites them.
- The primary checkout stays on `main`; do branch work in a worktree
  (`git worktree add ../tether.worktrees/<slug> -b <branch> main`).

## Dev Commands

```bash
scripts/setup-hooks.sh        # once per clone: pre-push runs the full preflight
scripts/preflight.sh full     # fmt, clippy -D warnings, test, release build
cargo run -- --version
```

## Design Constraints

- **tmux is the source of truth.** tether attaches; it never starts the tmux
  server (a server started from tether's systemd unit dies with it).
- **Resource budget first.** The server is already overloaded: event-driven only,
  no polling, bounded buffers and queues, nothing held for panes nobody views.
- **Tailnet only.** Never Tailscale Funnel.
- POSIX only (Linux, macOS). tmux doesn't run on Windows.

## Releases

Label-driven and CI-owned: see `docs/releasing.md`. Add a bullet under
`CHANGELOG.md` `[Unreleased]` with each user-visible change.

PRs use `.github/PULL_REQUEST_TEMPLATE.md`; fill every section and set one
`release:*` label.
