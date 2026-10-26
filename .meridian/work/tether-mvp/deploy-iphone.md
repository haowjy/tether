# Deploy lane: push + Mac service + iPhone app

Jimmy's instruction (this session): lanes 2 and 3 — push the 15 local commits, then
deploy here and walk the iPhone checklist — and "make sure the iphone app is ready".
Lane 1 (tmux baseline decision, issue #2) deliberately not taken here.

## Facts established before starting

- Local `main` was 15 commits ahead of `origin/main` at `64b78c3`; nothing pushed.
- This clone had no git hooks installed (`core.hooksPath` unset, `pre-push` was only
  the sample). Ran `scripts/setup-hooks.sh` first so the push ran `preflight.sh full`
  on the pushed tip.
- The installed `~/.cargo/bin/tether` was built Oct 25 02:12, i.e. before
  session-follow, and no LaunchAgent was loaded. The daemon had to be rebuilt before
  any device check: the session-follow protocol change makes an old daemon and a new
  app bundle incompatible.
- Host tmux is Homebrew **3.8**. The issue-#2 destroyed-session reproduction
  (`select-window` then `kill-session` in one command list, control client attached)
  survived 3/3 on an isolated `-L` socket here, so this host is on the fixed baseline.
  pop-os was not checked: `ssh pop-os` fails host-key verification until Jimmy accepts
  the key once.
- Tailscale standalone app 1.104.2, which satisfies setup's >= 1.104 check. MagicDNS
  self name `jimmys-macbook-air`. The paired phone is `iphone181` (iPhone 17 Pro,
  `00008150-000254DC02A3C01C`), on the tailnet.

## iOS build facts

- Xcode 27.1, XcodeGen 2.46.0, two valid Apple Development identities.
- The signed-in Xcode account team is **D4K9ZT557F** ("Jimmy Yao", Individual).
  `DQK9XRFMG4` is a certificate ID, not a team: building with it fails with
  "No Account for Team".
- `ios/scripts/check.sh` builds the Simulator with `CODE_SIGNING_ALLOWED=NO`; a device
  build needs `DEVELOPMENT_TEAM` supplied on the `xcodebuild` line. `project.yml` stays
  untouched (the repo intentionally leaves the team unset).
- Device build: Swift tests 7 pass, Release build succeeds, signed with team
  D4K9ZT557F, `com.jimmyyao.tether` installed on the phone. Free-team profile, so it
  expires and needs reinstalling from the Mac about weekly (ios-shell.md,
  "Distribution").
- One build warning: "All interface orientations must be supported unless the app
  requires full screen" — pre-existing, not investigated here.

## Results

- Push: `64b78c3..497d0bd main -> main`; the pre-push hook ran `preflight.sh full` on
  the pushed tip and passed.
- Daemon rebuilt from `497d0bd` and installed to `~/.cargo/bin/tether` (00:56).
  `tether setup --background` installed `~/Library/LaunchAgents/com.jimmyyao.tether.plist`;
  pid runs as `com.jimmyyao.tether` and serves
  `https://jimmys-macbook-air.tail852a76.ts.net` (HTTP 200 on `/`).
- Scratch session `tether-check` (200x50) on the default socket so device checks do not
  touch Jimmy's real work. There was no tmux server on `/tmp/tmux-501/default` before
  setup; this session started one.
- **The Mac's own browser cannot enrol**, by design: the daemon answers a page loaded on
  the server host with "jimmys-macbook-air can't admit this device — This is the server
  itself. Open tether from another device." (403 on the asset). So the published front
  was only verified as reachable, not exercised end to end; that check belongs to the
  phone. Fresh-page oddity noted, not investigated: the refusal page already showed an
  "Update ready" banner with a fresh browser profile.
- App: `com.jimmyyao.tether` installed and launched on the paired iPhone
  (`00008150-000254DC02A3C01C`). Signed with team D4K9ZT557F using profile
  `iOS Team Provisioning Profile: *` (a725be00), which expires **2027-10-24** and lists
  only that device. The profile has `get-task-allow`, so this is a development install.
  This contradicts ios-shell.md "Distribution", which says a free Personal Team with
  7-day profiles; the account is a one-year team profile, so no weekly reinstall.
- Real-service resource measurement (the gate's "actual dev-box service" condition), this
  Mac, no phone connected, 60 s window: RSS **7,392 KiB**, 0.0% CPU, 3 CS ticks total
  (0:00.03), 20 FDs. Plan target is "idle RSS under ~5 MB". macOS RSS counts shared
  library pages, so it is not comparable to the Linux PSS figure (5.09 MiB); the honest
  statement is that the real service is above the target on this host too.

## Second install (after the keyboard-gap fix) blocked

The build that carries the keyboard fix and the Add-server link parse cannot be signed:
`CodeSign … errSecInternalComponent`, because the Mac's console is locked
(`ioreg -n Root -d1 -a` → `IOConsoleLocked = true`). The phone also reported
`unavailable` to `devicectl` for the whole window. Both clear when Jimmy unlocks the Mac
with the phone awake nearby; the command is the Release device build from
`ios/AGENTS.md` plus `xcrun devicectl device install app`.

A `generic/platform=iOS` build without a reachable device hangs after the `codesign`
command line rather than failing fast; use the device destination once it is back.

## Handed to Jimmy

Enrolment code `1D8K-4WX6` (2 h TTL, one device), host
`jimmys-macbook-air.tail852a76.ts.net`. Device checklist rows in ios-shell.md are his to
run; the Simulator still cannot verify keyboard, focus or geometry.
