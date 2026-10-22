## Why

<!-- Problem or motivation. What breakage, gap, or need makes this PR worth merging? -->

## Goal

<!-- Intended outcome. What should be true after this merges? -->

## Summary

<!-- What changed? Paste the agent-generated summary, then adjust for clarity. -->

## Resulting Behavior

<!-- User-facing end state. What can someone do after this merges that they could not do before? Prefer examples/CLI outcomes over implementation details. -->

## Changes

<!-- Notable implementation details, behavior changes, risks, and follow-ups. -->

## Work Item

<!-- Meridian work item slug, for example: harness-aware-agent-inventory -->

## Verification

<!-- What was run or checked? Include tests, smoke checks, type/lint, or why verification is not applicable. -->

## Knowledge Updates

<!-- Were .context/, KB, docs, or other durable knowledge artifacts updated?
     If not, note why (for example: no new behavior, docs not applicable). -->

## Spawn Trace

<!-- Direct/top-level Meridian spawn IDs only: role and short purpose, for example:
     - p123 coder — implemented catalog filtering
     - p124 qa-lead — reviewed/updated tests
     - p125 kb-lead — updated durable knowledge
-->

## Release Label Guide

Set one `release:*` label on this PR:

- `release:patch` / `release:stable`: next stable **patch** release
- `release:minor` / `release:major`: next stable **minor** / **major** release
- `release:rc`: next **prerelease (RC)**; combine with `release:minor` for the next minor's RC
- `release:skip`: no release

No `release:*` label, or an unknown one, makes an RC.

## Post-Merge Automation

After merge, `.github/workflows/release-on-main.yml` bumps `Cargo.toml`, promotes
`CHANGELOG.md` `[Unreleased]`, commits `release: vX.Y.Z[-rc.N]`, tags it, and runs
`.github/workflows/release.yml`, which publishes the binaries to GitHub Releases.
