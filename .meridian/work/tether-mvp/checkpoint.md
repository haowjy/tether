# Client implementation checkpoint

## Current state (2026-10-24, session c62 follow-up) — read this first

P2 (web client) is closed and pushed (f23d015). The phone input design was reset after Jimmy
ran the keyboard spike: one-row dock (tab chip, line field, keyboard toggle; key row while the
keyboard is up), switcher sheet, long-press arrow pad / word selection, paste confirmation.
Committed as 7372e37 (spike deleted). Record of every decision: [phone-input-decisions.md](phone-input-decisions.md);
visual reference canvas: https://claude.ai/artifact/HqphCamD9rj2CbBnAS4sGJ (private to Jimmy).
Plan and lanes: [build-plan.md](build-plan.md). Jimmy asked to push through P5 autonomously.

In flight: p115 window size follows the last-active client (design, docs only); p116 lane PC
paste confirmation (daemon + web, uncommitted until reviewed). Next: review PC, then P3a
(dock, line field, owned input, switcher), P3b gestures, G3 probes + Jimmy's phone checklist,
P4 native shell, P5 final gate. Waiting on Jimmy: OK to use this Mac's `tailscale serve` for
the Serve/PWA gate; `ssh pop-os` host key (or Docker) for Linux checks.

Everything below is the historical log; where it conflicts with the above, the above wins.


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
- Jimmy (c8): "no polling" is not a hard rule. Recorded as a strong default (AGENTS.md,
  plan.md resource budget, decisions.md): no idle wakeups, never poll tmux, cheap
  bounded checks allowed where no event exists, on the 10 s connection timer while
  connected. → D2(a)'s serve-config refresh on the 10 s re-check is allowed, not a
  separate decision; fold into the auth draft after p19 returns.
- Jimmy (c8): the real reasons behind "no polling" are (1) usable on spotty/barely-any
  wifi — clients never poll over the network (hard); (2) host CPU/memory, because the
  box runs many processes — "I want to be able to limit it". Committed f00a418,
  128774c. Pending: hard/soft split of AGENTS.md + plan.md Standards (proposal sent),
  and how Jimmy wants to limit tether's CPU/memory (asked).
- Jimmy (c8): "just list the principles, not the rules." AGENTS.md now has Principles
  (tmux source of truth; spotty connections; light on a busy host, capped where Jimmy
  chooses; private). Hard/soft rule-split proposal dropped. Open: how to cap CPU/memory
  (proposal: CPUQuota in unit, one memory-budget config knob deriving daemon caps, docs).
- CI green (run 39900556140) incl. real-tmux suites on Ubuntu tmux 3.4: TERM was
  missing for the test terminal client. Pushed through edb6064 + TERM fix.
- Auth draft rev 3 (p19): D5 marked settled (principles). D6 (drop to 2 control
  clients) tied to Jimmy's open answer on how to cap CPU/memory. Final review p20.
- Jimmy (c8): yes to tunable limits (option a): CPU cap in the unit, one memory-budget
  knob in config.toml from which the daemon derives its caps, documented tuning. His
  reason: probably rarely hit, but multiple users on the box would make it matter.
  Settles D6 as "a budget-derived default". Spec lane p21. Also: fix the two tmux-3.8
  test cases (tab name: version-gate; default name: macOS /bin/sh is bash, stop
  asserting the default name) — small, no decision needed.
- Jimmy (c8): "auth decisions — i don't really care... do research and design on what
  the best would be for me, as someone with tailscale." Tech lead owns D1–D4.
  Investigating node-identity auth (tailnet device = browser credential, tether-side
  node allowlist, no cookie) — p22 researching whether Serve exposes the peer node.
- Final cookie-draft review p20 (design/browser-auth-review-3.md): ready for decision
  after 4 medium text fixes (M1 graceful shutdown via per-connection select like axum;
  M2 MiB units + full unreclaimable formula, D6 = "no margin" not "over"; M3 drop 60 s
  whole-response deadline; M4 re-check LocalAPI failure keeps last state). Held: the
  node-identity research (p22) may replace the cookie credential.
- Future idea (Jimmy, unsure, leaning no): share a session with someone. Not a link
  (bearer secret = shell as Jimmy). If ever: guest tailnet device, one session,
  read-only by default, expiring, revocable. Auth design should leave room for scoped
  device records; build nothing now.
- Jimmy (c8): multiple users sharing one dev machine (each own devices) makes more
  sense than sharing sessions; and "we should be able to access it normally through
  the web as well" (public HTTPS, already roadmap phase 2). Auth requirements for the
  tech lead's decision: (1) tailnet now: desktop, phone browser/PWA, iOS app; (2) public
  HTTPS later without redesign; (3) several users per machine, own daemons/devices;
  (4) several devices per user, individually revocable; (5) room for scoped guests
  later; (6) unlocked-device risk accepted for now. Lean: one portable browser
  credential (cookie → passkey) + tailnet device approval as an extra factor on the
  tailnet. Decide after p22; confirm "multi-user = separate Unix accounts" with Jimmy.
- Jimmy confirmed: multi-user = other people with their own Unix accounts on the box, each running their own tether.
- Jimmy: "right now it's all just me." Design so multi-user/public/guests aren't precluded, but build and optimize for one user now; no multi-user features or config until needed.

## 2026-10-23 late: whole-client build begun

- Jimmy: implement the entire thing; throw out the old UI. Plan: `build-plan.md` (DAG, lane log).
- Jimmy chose `memory_budget_mib = 72` default (3 sessions at once) after learning tmux and
  its processes run outside the unit and never count.
- Tech lead decision (delegated): browsers admitted as enrolled tailnet nodes via Serve XFF +
  LocalAPI whois stable node ID; no cookie; Origin/Host checks stay. Rev 4 = p23.
- P0 lanes running: p23 auth rev 4, p24 limits 72, p25 web inventory, p26 wrap design, p27 tmux 3.8 tests.
- Jimmy: improve the approved layouts with standard components and a proper design-token system (build-plan.md, P1-D/W0).
