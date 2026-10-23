# Three small fixes in the tether repo (primary checkout, branch main)

Do them in order. Do NOT commit; the tech lead reviews and commits each as its own change. Read /Users/jimmyyao/repos/tether/AGENTS.md first. Never touch the physical iPhone (another agent is using it): Simulator only. Never type into personal tmux sessions.

## 1. KeyboardSpike crashes at launch on the Simulator

`ios/spikes/keyboard/Spike/Accessory.swift` `build()` (around line 115-118) activates
`key.widthAnchor.constraint(equalTo: keyViews[0].widthAnchor)` before the keys are added to `keyRow`, so they share no view hierarchy → NSLayoutConstraint SIGABRT. Crash report: ~/Library/Logs/DiagnosticReports/KeyboardSpike-2026-10-22-225142.ips. Fix it so constraints activate after the views are in the hierarchy; check the rest of `build()` and the other spike files for the same pattern.

Verify on the existing isolated simulator `tether-keyboard-p6` (UUID 58631B31-3F9C-4562-AD4B-5C1404E9EB40). Do not boot/modify other simulators. Previous build used: iphonesimulator SDK, signing disabled, derived data /tmp/tether-keyboard-p6-build (see ios/spikes/keyboard/README.md; xcodegen is installed). Install, launch, confirm it stays running, take a screenshot (`xcrun simctl io <udid> screenshot`) into .meridian/work/tether-mvp/evidence/. Then, as far as the Simulator allows, run the keyboard checklist in docs/design/spike-1-keyboard.md: focus the terminal input, show the software keyboard (simctl / Hardware > Keyboard toggle), confirm the accessory renders and keys respond. Record per check what you saw, and mark anything the Simulator can't prove (real keyboard dismissal behaviour, Face ID part B, hardware feel) as "needs real device". Write results to .meridian/work/tether-mvp/simulator-status.md (replace its content; keep it short).

## 2. Stale status in the keyboard-spike design doc (review finding from p5)

The `override` fix in `ios/spikes/keyboard/Spike/TerminalInputView.swift` (uncommitted, keep it) made the unsigned real-iphoneos-SDK build succeed under Xcode 27.1. `docs/design/spike-1-keyboard.md` (around line 144) and `ios/spikes/keyboard/README.md` must state the current status: compiles against the real SDK; signed device build blocked on Xcode having no Apple account; Simulator launch result from step 1; no real-device results yet. Specs state the current rule only — no change narration. Also make the spike README accurate for running on the Simulator.

## 3. Two daemon tests fail on macOS

`scripts/preflight.sh full` fails on macOS: `src/fs/list.rs` (~line 250, a file named b"caf\xe9") and `src/fs/open.rs` test `a_link_to_a_name_that_isnt_utf8_is_a_bad_request` (b"bad\xff") fail with "Illegal byte sequence": APFS refuses non-UTF-8 file names. `tether serve` runs on Linux only (docs/design/plan.md, Product rules), and non-UTF-8 names are a Linux reality the tests rightly cover. Make them run where the filesystem can hold such names and not fail on macOS — choose the cleanest mechanism consistent with how the repo already gates platform-specific code/tests (look first). Don't weaken what they assert on Linux. If list.rs's test mixes the non-UTF-8 case into a larger listing test, keep the rest of that test running on macOS.

Then run `scripts/preflight.sh full` on this Mac and report the result. If any other failure appears, report it with output; don't fix unrelated things.

## Report
Per item: files changed, what you verified and how (commands, screenshots), what remains unverified.
