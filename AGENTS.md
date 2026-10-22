# tether

Phone-first client for tmux on a dev server, over Tailscale. A Rust daemon bridges
tmux control mode to an installable web app. The design and its review are in
`docs/design/`; read them before adding a subsystem.

## How work lands (initial build)

tether is being built in one pass: commit straight to `main` in the primary
checkout. No PRs, no feature branches, no worktrees. Dropping PRs drops only the
review ceremony; the rigor stays:

- **Design before code.** Settle each subsystem's design and spec in
  `docs/design/` before building it, starting from `plan.md` (the one current
  design; `plan-review.md` is the review record already folded into it). Record
  decisions with the alternatives rejected.
- **Coding standards.** Follow the structure and style in `plan.md` §11
  (pure parser and state core, one task per control client, bounded queues, one
  focus controller on the web side). Get a review of each subsystem's design and
  code before moving on.
- **Probe the real thing.** Verify against real tmux (3.4 and 3.7b), a real iPhone,
  and the resource budget measured on the dev box. Passing tests is not enough.
- **Coherent commits.** One change per commit; `scripts/preflight.sh full` passes
  before every push (the pre-push hook enforces it). Keep `docs/design/` and any
  `.context/` notes accurate in the same commit as the code they describe.

Direct pushes to `main` never release. Cut a release only when Jimmy asks, with
`scripts/manually-release.sh`. The PR-and-label release flow in `docs/releasing.md`
applies once tether switches to PRs.

## Safety Rules

- **Never create or push `v*` tags by hand.** The only tag path is
  `scripts/manually-release.sh`, run when Jimmy asks; the pre-push hook blocks the rest.
- **Never use `--no-verify` on git push** unless explicitly told to.
- **Never edit generated agent directories** (`.claude/agents/`, `.claude/skills/`,
  `.codex/`, `.cursor/`, `.opencode/`, `.pi/`, `.agents/`). `meridian mars sync`
  overwrites them.

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

Add a bullet under `CHANGELOG.md` `[Unreleased]` with each user-visible change;
the release that ships it promotes the section. Mechanics: `docs/releasing.md`.
