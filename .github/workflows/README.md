# Workflows

Adapted from mars-agents' release model, without PyPI, npm, crates.io or Windows.

## ci.yml

Runs on PRs and pushes to `main`: `scripts/preflight.sh full` (fmt, clippy with
`-D warnings`, test, release build). On PRs it also reports the release label, or
warns that none is set.

## release-on-main.yml

Runs on every push to `main`, except release commits (`release: v…`) and pushes
whose head commit message contains `release:skip`.

- Finds the merged PR for the pushed commit (exact `merge_commit_sha` match first,
  then any merged PR into `main`). No PR: no release. More than one: fail.
- Labels: `release:skip` skips. `release:major`/`minor`/`patch`/`stable` pick the
  bump. `release:rc`, no release label, or an unknown `release:*` label makes an RC.
  A bump label plus `release:rc` makes an RC of that bump.
- Version: next bump from the latest stable `v*` tag (bootstrap from `0.0.0`); an RC
  takes the next free `-rc.N` for that version.
- Idempotent per trigger: the release commit carries `Release-Trigger: <sha>`. A
  rerun that finds it reuses the existing tag, or recreates a missing one.
- Pushes the release commit and tag with `GITHUB_TOKEN`, then calls `release.yml`
  as a reusable workflow. Tags pushed with `GITHUB_TOKEN` don't trigger workflows,
  so there is no double publish and no extra secret.

## release.yml

The only publish path: called by `release-on-main.yml`, or run by a manual `v*` tag
push (`scripts/manually-release.sh`).

1. Verify provenance: the tag matches `Cargo.toml`, `CHANGELOG.md` has the section,
   the commit is `release: v<version>` and is reachable from `main`.
2. Build on native runners: `x86_64-unknown-linux-musl` (ubuntu-latest),
   `aarch64-unknown-linux-musl` (ubuntu-24.04-arm), `aarch64-apple-darwin`
   (macos-latest). Each runs `tether --version` against the tag, and the Linux
   builds must be statically linked.
3. Publish a GitHub Release with the three binaries and `SHA256SUMS`; `-rc.N` tags
   are prereleases.

If branch protection is ever added to `main`, the release job pushes a commit as
`github-actions[bot]`; allow it, or give it a token that can bypass protection.
