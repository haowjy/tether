# tether

Phone-first client for tmux on a dev server, over Tailscale. A Rust daemon bridges
tmux control mode to a native iOS app that hosts a web UI. The design is in
`docs/design/`: `plan.md` is the product and UX spec and the index of the subsystem
specs; `decisions.md` logs every decision. Read them before adding a subsystem.

## How work lands (initial build)

tether is being built in one pass: commit straight to `main` in the primary
checkout. No PRs, no feature branches, no worktrees. Dropping PRs drops only the
review ceremony; the rigor stays:

- **Design before code.** Settle each subsystem's spec in `docs/design/` before
  building it, starting from `plan.md`. Specs state the current rule only; log each
  decision, with the alternatives rejected, in `docs/design/decisions.md`.
- **Coding standards.** Follow "Code structure and standards" in `plan.md`
  (sans-IO cores for the tmux protocol and the hub, thin I/O tasks, bounded queues,
  one native focus controller). Get a review of each subsystem's design and code
  before moving on.
- **Probe the real thing.** Verify against real tmux (3.4 and 3.7b), a real iPhone,
  and the resource budget measured on the dev box. Passing tests is not enough.
- **Coherent commits.** One change per commit; the lead preflights each commit on a
  clean export before pushing. The pre-push hook runs `scripts/preflight.sh full` on
  each pushed branch tip only, not every commit in the range. Keep `docs/design/` and
  any `.context/` notes accurate in the same commit as the code they describe.

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
scripts/setup-hooks.sh        # once per clone: pre-push runs full preflight on pushed tips
scripts/preflight.sh full     # fmt, clippy -D warnings, test, release build
cargo run -- --version
pnpm --dir web install       # the web client uses pnpm
```

Use **pnpm, never npm**, for anything in `web/`: installs, scripts, `pnpm exec`. The lockfile
is `web/pnpm-lock.yaml`; don't add a `package-lock.json`.

## Principles

- **tmux is the source of truth.** tether is a window onto Jimmy's tmux, never its
  owner: tmux's life never depends on tether's.
- **Usable on spotty, barely-there connections.** Every byte and round trip on the
  network costs the user; reconnecting must be cheap.
- **Light on a busy host.** The dev box runs many processes. tether's CPU and memory
  stay small, bounded, and capped where Jimmy chooses.
- **Private.** Reachable only from Jimmy's tailnet.
- POSIX only (Linux, macOS). tmux doesn't run on Windows.

## Releases

Add a bullet under `CHANGELOG.md` `[Unreleased]` with each user-visible change;
the release that ships it promotes the section. Mechanics: `docs/releasing.md`.
