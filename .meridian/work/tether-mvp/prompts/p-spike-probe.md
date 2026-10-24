# Probe the iOS keyboard spike in the Simulator

Jimmy says the spike app at `ios/spikes/keyboard/` "feels like shit and looks like shit". Find out what is actually wrong with it by running it, and bring back evidence (screenshots + observations), not code reading.

Read first: `docs/design/spike-1-keyboard.md` (what the spike is and its checklist), `docs/design/ios-shell.md` (the native design the spike gates).

## Do
1. Build the spike for the Simulator and run it on a booted iPhone simulator (iPhone 18 Pro E5ECC839-... is booted; iPhone 17 Pro sims exist too, and `tether-keyboard-p6` was used before). Note: an earlier Simulator crash at Accessory.swift:118 was fixed in e47dd74; report if any crash recurs.
2. Screenshot (`xcrun simctl io <udid> screenshot`) the app at rest, with the software keyboard up (toggle off the hardware keyboard: I/O > Keyboard > Connect Hardware Keyboard, or `defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false`), and through as many checklist steps as you can drive. Drive taps/typing however works (AppleScript/cliclick on the Simulator window, simctl, XCUITest throwaway target) — find a way; if nothing lets you tap, say so and capture what you can.
3. For each step record: what you saw, layout problems (clipping, overlap, the terminal under the keyboard/accessory, wrong sizing, safe-area issues), jank/latency you can observe, focus losses (keyboard dropping), and anything crude in the visual design. Separate (a) problems in the spike's test harness chrome (control strip, test buttons), which is throwaway, from (b) problems in the parts the real app will inherit: terminal rendering in the WKWebView, native accessory key row, keyboard ownership/focus, geometry.
4. Check the physical-device path is no longer blocked: `xcodebuild` a signed iphoneos build with `-allowProvisioningUpdates` using team D4K9ZT557F (pass DEVELOPMENT_TEAM on the command line; do NOT write the team into project.yml/pbxproj or commit anything). Report success or the exact error. The phone is not connected, so don't try to install.

## Constraints
- Edit nothing in the repo. Throwaway files (XCUITest targets, scripts) go in your own scratch dir and are deleted after; name them with your spawn id.
- Don't touch personal tmux sessions.
- Spawn env on this Mac needs `TMPDIR=/tmp/tether-meridian-501` for sockets.

## Report
Screenshots saved under `$MERIDIAN_ACTIVE_WORK_DIR/evidence/spike-probe/` (pngs are fine there, keep it to the useful ones, <15). A ranked list of what looks/feels bad, each tagged harness-only vs inherited, with the screenshot that shows it and a one-line likely cause if evident. Signed-build result. What you could not exercise in the Simulator and why (real keyboard feel, latency, Face ID need the device).
