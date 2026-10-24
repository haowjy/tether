# Lane P4a: the native iOS shell, native side (ios/ only)

Build tether's iOS app as `docs/design/ios-shell.md` specifies (read it whole), with the bridge at version 2 per `.meridian/work/tether-mvp/design/client-architecture.md` §5.10 (and its W5 row in §11). No `ios/` directory exists yet; the keyboard spike was deleted. Jimmy's phone-input decisions, which override any older rule in ios-shell.md: `.meridian/work/tether-mvp/phone-input-decisions.md`. Repo rules: AGENTS.md.

Scope — you may edit only `ios/`, `docs/design/ios-shell.md` (where the build forces a spec change; say so), and, if the spec needs Rust-emitted auth fixtures, the fixture-emitting test in `src/proto/`. Do NOT edit `web/`: a frontend lane (P3b) is editing it in this checkout right now, and the web half of the bridge (W5, `web/platform/native/`) is the next lane, P4b. So:
- Put the bridge contract in shared JSON fixtures (one file per message, both directions) that TetherKit's `swift test` decodes and encodes, at a path P4b's web tests can read (propose `ios/TetherKit/Tests/Fixtures/bridge/` or similar; say where).
- Write `$MERIDIAN_ACTIVE_WORK_DIR/p4b-web-bridge.md`: exactly what the web side must send, receive and do for each message, including the known gaps (`web/.context/TODO` W5 items: the ⌨ toggle has no `terminal` element in native, native must report `keyboardInset`).

Build: XcodeGen `project.yml` (generated .xcodeproj gitignored), TetherKit Swift package without UIKit, `ios/scripts/check.sh` (xcodegen, `swift test`, simulator `xcodebuild`), `ios/scripts/build-web.sh` (pnpm, never npm). Never write the signing team ID into project files; leave the team unset so Jimmy picks it in Xcode. Bundle id: pick one and note it.

Verify: `ios/scripts/check.sh` passes; the app boots in the iOS Simulator (iPhone 17 Pro) showing the bundled web UI from the custom scheme (screenshot via `xcrun simctl io booted screenshot` into `$MERIDIAN_ACTIVE_WORK_DIR/evidence/p4a/`); what can only be checked with P4b's web side or on the device, list it. The Simulator here can't show the software keyboard. Don't commit. Report: files, spec → implementation, verification, divergences from ios-shell.md.
Spawn env TMPDIR=/tmp/tether-meridian-501.
