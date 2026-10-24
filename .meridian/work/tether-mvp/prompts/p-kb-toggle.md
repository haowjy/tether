# One keyboard toggle; taps on the terminal never touch the keyboard

## Decision (Jimmy, 2026-10-24, after running the keyboard spike on his iPhone)
"clicking in the terminal area opens the keyboard... which it should only be done by the button (like termius...)" and "there should only be 1 place to click to open and close the keyboard".

Settled rule, touch only (desktop click-to-focus is unchanged):
- The toolbar's keyboard button is the single control that opens AND closes the on-screen keyboard. It toggles. It lives in the web toolbar/tab bar, which stays visible whether the keyboard is up or down, so it can do both.
- A tap on the terminal never raises or lowers the keyboard. With app mouse mode on, a tap is still a click sent to the app. With no mouse mode, a tap does nothing to focus. Prompt-row cursor placement (OSC 133) may still move the cursor, but only while the keyboard is already up; it never raises it.
- The native key row (inputAccessoryView) loses its hide key [⌨̲]. With a hardware keyboard the collapsed strip keeps only ctrl.
- Rejected: tap-to-raise (the previous rule; Jimmy finds it intrusive, and Termius doesn't do it); separate open (toolbar) and close (key row) controls (two places).
- Caveat to record: in phone Safari/PWA, iOS adds its own form accessory bar (Done) above the keyboard that a web page cannot remove; the toolbar button is still the only control tether provides. The native app has no such bar in `terminal` mode.

## Do
1. Specs, stating the current rule only (AGENTS.md: specs state the current rule; log the decision with rejected alternatives in `docs/design/decisions.md`, following that file's entry format):
   - `docs/design/ios-shell.md`: key-row diagram (~line 77), focus table (~312-313: `hidden` entered by the keyboard button / `focus hidden`; `terminal` entered by the keyboard button, not a terminal tap), and any other mention of the hide key or tap-to-raise.
   - `.meridian/work/tether-mvp/design/client-architecture.md`: focus-owner table (~957), "Raising the keyboard" (~1144), the gesture table row `tap, no mouse mode` (~1242), the P3a row (~1546), the G3 checklist row (~1588), and anything else that says a terminal tap focuses input.
   - `docs/design/client/terminal-interaction-design.md` line ~9 ("tapping can focus input"), and `docs/design/client/browser-behaviors.md` wherever the keyboard button / tap focus is described.
   - `docs/design/spike-1-keyboard.md`: diagram line 32, S13, F2, H9, S2/S7 wording that relies on tapping the terminal to bring the keyboard back; every step must be doable with the single toggle.
   - grep for other instances ("tap on the terminal", "hide key", "raises the keyboard") across docs/design and the work dir design/ and fix them all.
2. Spike code (`ios/spikes/keyboard/`):
   - `web/spike.js`: remove the termwrap pointerup → focus terminal handler; make `kbbtn` toggle: it must know whether the terminal keyboard is up. Native already pushes viewport/keyboard state to the page; use that (or the focus mode) as the source, and post `focus terminal` or `focus hidden`. Keep the toggle working within the user gesture.
   - `Spike/Accessory.swift` + `SpikeViewController.swift`: remove the hide key and its `.hide` action; hardware-keyboard strip keeps ctrl only. Fix any layout that assumed the key.
   - `Spike/Recorder.swift`: steps S13/F2/H9 (and any others) match the updated spike-1-keyboard.md.
3. Build for device to check it compiles: `xcodebuild -project ios/spikes/keyboard/KeyboardSpike.xcodeproj -scheme KeyboardSpike -sdk iphoneos -configuration Debug -derivedDataPath /tmp/tether-meridian-501/spike-kb/device -allowProvisioningUpdates DEVELOPMENT_TEAM=D4K9ZT557F build`. Do NOT write the team into project.yml/pbxproj. If project.yml generates the pbxproj (xcodegen), keep them consistent. Then run it in a Simulator and check: launch → keyboard down; tap terminal → still down; tap ⌨ → up; tap terminal → stays up; tap ⌨ → down. Screenshot evidence to `$MERIDIAN_ACTIVE_WORK_DIR/evidence/kb-toggle/` (a few pngs).
4. Add a CHANGELOG `[Unreleased]` bullet only if this changes user-visible shipped behavior (it doesn't yet: the web client has no touch focus; skip unless you find otherwise).

## Constraints
- Do not commit. Leave `ios/spikes/keyboard/Spike/Info.plist`'s existing uncommitted reorder alone.
- Do not touch the web client in `web/` beyond what's above (P3a/P3b will implement the rule).
- Spawn env needs `TMPDIR=/tmp/tether-meridian-501`.

## Report
Files changed with a one-line summary each, the build result, the Simulator toggle sequence result with screenshots, and any spec passage you were unsure how to reword.
