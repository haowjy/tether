# Client implementation checkpoint

## Current state

The backend and native-oriented web core exist. The approved desktop/mobile layouts
are mockups, not implemented browser redesigns. Release web boot still expects the
native bridge; the browser harness is development-only. The iOS tree contains the
keyboard spike, not a finished app. Do not confuse running previews with release
readiness.

## Read first

- [Design/Mac entrypoint](../../../docs/design/client/README.md).
- [Interaction contract](../../../docs/design/client/browser-behaviors.md) and
  [mockup](../../../docs/design/client/mockups/index.html).
- [Touch, copy, paste and drafts](../../../docs/design/client/terminal-interaction-design.md).
- [Browser/PWA setup research](../../../docs/design/client/browser-setup.md).
- [Connection roadmap](../../../docs/design/client/connection-roadmap.md).

Tailscale first, public HTTPS as intended follow-up; SSH is not the planned second
phase. Phone PWA installation is required. First-phase authentication remains to
settle; neither identity-only discussion nor cookie research authorizes removing
current checks. The tailnet-only/no-Funnel policy remains in force.

## Mac baseline and immediate blocker

The keyboard spike builds against the real iphoneos SDK with Xcode 27.1 after adding
`override` to `TerminalInputView.paste(itemProviders:)`. A physical iPhone 17 Pro is
connected, but the signed device build fails with `No Accounts` and no development
provisioning profile for `dev.tether.spike.keyboard`. Add the Apple ID in Xcode
Settings → Accounts, then retry provisioning/build/install. A signing certificate
exists; no signing credentials or team settings were added to the repository.

No real-device keyboard or clipboard result is available yet. Do not adopt native
focus/geometry decisions from the successful unsigned build. Authentication and
platform-interface decisions remain unresolved; production code is unchanged.
Execution plan and before-state evidence: [implementation-plan.md](implementation-plan.md).

## Next work

1. Settle first-phase auth, static serving and browser/native adapter boundaries;
   review the security changes before source edits.
2. Implement the approved browser layouts and real browser input/lifecycle adapter;
   do not promote the fake-keyboard/owner-injecting dev shim into production.
3. Run the existing keyboard spike on Mac/iPhone; prototype mobile selection,
   keyboard-open local drafts, clipboard and PWA installation/lifecycle.
4. Fix snapshot/history wrap preservation before claiming newline-correct copy.
5. Probe against isolated tmux 3.4 and 3.7b; never type into personal running sessions.

Remaining gates and draft-retention choices are listed in the linked specs. Preserve
bounded resources and the daemon's three-WebSocket cap; static HTTP needs separate
bounds. Offline drafts never imply queued terminal input.

## Handoff evidence

Design bundle: `76f3d2c`; browser/PWA research: `482a942`; connection roadmap:
`4ff4b19`. All were pushed to main after full preflight. Independent recommendation
review accepted browser setup with explicit biometric-protection and static-resource
gates. Real iPhone and production deployment remain unverified. Initial build uses
reviewed commits directly on main, not PRs; no release without Jimmy's request.

## Session c8 (2026-10-22 night) — decisions and overnight plan

- Jimmy chose browser auth direction **A built to accept C**: enrolment code →
  HttpOnly `__Host-` cookie as a typed browser device credential (Origin/CSRF/Host
  checks), accepting the unlocked-phone risk for the Tailscale-only phase; passkey
  unlock (C) is to be addable later without rework, likely with public HTTPS.
  Rejected: B (JS-held token: XSS-readable, awkward media), D (tailnet identity only).
  Draft + security review tonight; **no auth code until Jimmy approves the draft.**
- Overnight lanes: Simulator crash at Accessory.swift:118 (Simulator only — never the
  physical iPhone); stale spike-1-keyboard.md / implementation-plan.md status (p5
  findings); 2 macOS fs test failures ("Illegal byte sequence"); auth design draft.
- Spawns on this Mac need `TMPDIR=/tmp/tether-meridian-501` (socket path limit).
- Jimmy (c8): "feel free to improve upon the mockups when implementing." The mockup is
  a starting point, not pixel spec. Improvements are allowed; log each deliberate
  departure from browser-behaviors.md in decisions.md and update the contract in the
  same commit. Behaviours Jimmy explicitly removed or required stay (no Files in `+`,
  no intermediate menu, no dot markers/separators, no custom browser keyboard strip,
  local draft with Insert-without-Enter) unless he reopens them.
- Committed e47dd74 (spike override + Simulator launch fix + status docs). Not pushed.
- Test audit p13 → test-audit.md: suite is not oversized (~10 of 229 deletable); real
  problems are red CI (vitest needs Tailscale; clippy fetch_update deprecation), an
  http_auth harness flake, real-tmux suites never run. Lane p16 (coder) fixing the gate;
  a second pass will do the audit's deletions/merges/restructures. New tests (ws.rs
  gaps, loopback refusal, default-deny auth guard) are proposals for Jimmy.
- Auth review p14 → design/browser-auth-review-1.md: approve with changes (H1 sibling
  server leak, H2 unbounded static serving, M1–M5). Revision p15 (design-lead --from p12).
- Watch: msrv CI job pins Rust 1.85; the fetch_update replacement must build there.
