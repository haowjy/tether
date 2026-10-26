# iOS: take a `tether://add?host=…` link, and add a host this phone is already admitted by

Repo `/Users/jimmyyao/repos/tether`, iOS app in `ios/`. Work in the primary checkout.
**Do not commit, do not push.** Another agent is editing `web/` at the same time: touch
only `ios/`.

Read `.meridian/work/tether-mvp/app-handoff.md` first: it has the evidence for the
admission model. `ios/AGENTS.md` and `docs/design/ios-shell.md` ("Hosts", "Auth") are the
local rules; `docs/design/auth.md` is the auth design.

## Why

Jimmy opens the setup link in Safari, which enrols the phone's **node**
(`POST /auth/node/enroll`). The app on the same phone is then already admitted by node
identity (`src/auth/mod.rs:293-299`: no token presented → the node lane decides), but
today it insists on an enrolment code of its own, so the same phone has to be enrolled
twice.

## What to build

1. **Register the scheme.** `tether://` in the app's Info.plist, declared through
   `ios/project.yml` (`info:` properties — `project.yml` is the project; never hand-edit
   `project.pbxproj`).
2. **Handle `tether://add?host=<percent-encoded origin>`.** It arrives through SwiftUI's
   `onOpenURL` (or the app delegate if that is where the model lives). Validate it
   through the existing `AuthClient.serverURL` path rather than a new parser: an https
   URL, no user/password/query/fragment. Show *Add server* with the host filled and the
   code empty, and do nothing else.
3. **Add a host with no code.** With the code empty, `GET /auth/node/session`:
   - `200 {deviceName}` — this phone is enrolled: save the host and admit it with **no
     device token**. The daemon admits every request from this node, so nothing else is
     needed.
   - `401 not_enrolled` — say plainly that this phone is not enrolled yet and to run
     `tether enroll` on the server for a code (the code path still exists).
   Whatever you pick, the message has to tell Jimmy which of the two happened.
4. **Make a token-less host a real state, not a broken one.** Today the token map, the
   transport and the Face ID lock assume every host has a token. A node-admitted host has
   none: the transport sends no `Authorization` header for it, nothing tries to unlock
   it, and the lock screen does not treat a missing token as "needs enrolling". Check
   every place that reads a token for a host (`Auth`, `Hosts`, `Web`, `TetherApp`) and
   make the absence explicit and safe. If a place genuinely cannot work without a token,
   say so in your report rather than leaving a half state.

## Constraints

- Keep the existing code-based enrolment working exactly as it is.
- No new dependencies. No new permanent tests (Jimmy's standing instruction) — but do
  build and run what verifies your work.
- **Signing:** the team is `D4K9ZT557F` (the ID in `security find-identity` is a
  certificate, not a team). Do not install on the phone or run `xcrun devicectl`; report
  instead. `ios/scripts/check.sh` is the build/test gate (Simulator + `swift test`).
- Do not touch the deployed LaunchAgent, the live tether state, or `web/` and `src/`.

## Report

What you changed and where; how a token-less host flows through transport, lock and host
list; what `GET /auth/node/session` refusal produces on screen; the exact `check.sh`
result; anything that cannot work without a device token; and anything in the note above
that the code contradicts.
