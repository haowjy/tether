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
