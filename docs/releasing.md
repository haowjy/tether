# Releasing

Releases are automatic from PR merges to `main`. Mechanics, edge cases and
rerun behaviour: [.github/workflows/README.md](../.github/workflows/README.md).

## What you do

1. Add a bullet under `CHANGELOG.md` `[Unreleased]` as you work.
2. Open a PR with the template and set one release label. The bump tracks breakage,
   not size: a change that breaks nothing is a patch, however much it adds.
   - `release:patch` (or `release:stable`): next stable patch
   - `release:minor` / `release:major`: a release that breaks behaviour, config or state
   - `release:rc`: a prerelease of the next patch; add `release:minor` too for the
     next minor's RC (for example `v0.1.0-rc.1`)
   - `release:skip`: no release
3. Merge. No `release:*` label means an RC; `release:skip` in the head commit
   message also skips.

## What CI does

`release-on-main.yml` reads the merged PR's labels, runs `scripts/preflight.sh full`,
computes the version from existing `v*` tags, bumps `Cargo.toml`/`Cargo.lock`,
promotes `[Unreleased]`, commits `release: vX.Y.Z[-rc.N]`, tags it, and calls
`release.yml`. That builds static musl binaries for Linux x86_64 and aarch64 plus
macOS arm64 on native runners, smoke-tests each, and publishes a GitHub Release
with `SHA256SUMS`. RC tags become prereleases.

## Backfill

Direct pushes to `main` don't release. To release them:

```bash
scripts/manually-release.sh patch --push     # bump, commit, tag, push
```

Pushing that tag runs `release.yml` directly.

## Boundaries

- Don't edit the version in `Cargo.toml`; CI owns it.
- Don't push `v*` tags yourself except through `scripts/manually-release.sh`.
