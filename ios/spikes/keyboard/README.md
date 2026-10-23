# Spike 1: keyboard ownership

Throwaway app for [docs/design/spike-1-keyboard.md](../../../docs/design/spike-1-keyboard.md).
That file is the source of truth for what each step checks and what the results
decide; this README is how to build and drive the app.

## Build and run

### Simulator

On a Mac with Xcode and `xcodegen` (`brew install xcodegen`), build without signing:

```sh
cd ios/spikes/keyboard
xcodegen
xcodebuild -project KeyboardSpike.xcodeproj -scheme KeyboardSpike \
  -sdk iphonesimulator -configuration Debug \
  -derivedDataPath /tmp/keyboard-spike-build CODE_SIGNING_ALLOWED=NO build
```

Install and launch on a booted Simulator, replacing the placeholder with its UDID:

```sh
UDID="YOUR_SIMULATOR_UDID"
xcrun simctl install "$UDID" /tmp/keyboard-spike-build/Build/Products/Debug-iphonesimulator/KeyboardSpike.app
xcrun simctl launch "$UDID" dev.tether.spike.keyboard
```

The app starts with the keyboard hidden. Use its keyboard button to focus terminal
input and show the software keyboard. In Simulator, Hardware → Keyboard can toggle
the Mac keyboard connection or the software keyboard. Capture the current screen with
`xcrun simctl io "$UDID" screenshot <path>`.

### Physical iPhone

1. Use Xcode new enough to support the phone's iOS version (Xcode → Settings →
   Components shows the supported platforms).
2. On the iPhone: Settings → Privacy & Security → Developer Mode → on. It restarts.
3. In Xcode → Settings → Accounts, add your Apple ID. The free Personal Team is enough.
4. `cd ios/spikes/keyboard && xcodegen && open KeyboardSpike.xcodeproj`.
5. Target KeyboardSpike → Signing & Capabilities: pick your team. If Xcode says the
   bundle id `dev.tether.spike.keyboard` is taken, change it there (or in
   `project.yml`). Each `xcodegen` run resets the team unless you set
   `DEVELOPMENT_TEAM` in `project.yml`.
6. Plug in the phone (or pair it over Wi-Fi), pick it as the run destination, and ⌘R.
7. First install only: on the phone, Settings → General → VPN & Device Management →
   trust your developer certificate, then ⌘R again.

The spike compiles against the real iPhoneOS SDK with Xcode 27.1. A signed device build
is blocked because Xcode has no Apple account configured. On the `tether-keyboard-p6`
iOS 26.3.1 Simulator, the app launches and remains running; keyboard and accessory
behavior are not verified. No real-device results are available yet.

## What's on screen

```text
◀ S3 · Tap tab1, tab2, tab3, several times  ▶ Pass Fail ⚙   step; Pass/Fail record it
✓ Keyboard stays up; typing goes…  [A/on pass]               pass condition; answers so far
55×36 · kb:up · guard:on · geo:A · fr:term · mode:terminal · flood:0 · hides:0
Static text for S7 …                                        web page from here down
tab1 ▸ hello⟨Enter⟩                                          what the active tab received
$ terminal (xterm.js)
(tab1)(tab2)(tab3) (flood 0) (sheet) (edit) (⌨)              web tab bar
esc tab ctrl ⇧tab ← ↑ ↓ → cmp [paste] ⌨︎↓                     native key row
```

- **Status line:** terminal size, keyboard (`up`, `down`, `hw` with a hardware keyboard),
  guard, geometry mode, the real first responder (`term` is the terminal input),
  the focus state the spike wants, flood rate, and **hides**: keyboard hides that
  neither the spike nor an app switch caused. Bench progress and Keychain results
  appear here too.
- **⚙ menu:** Guard on/off, Geometry A/B, Native sheet (S5), Native prompt (S10),
  Kill web process (S14), Bench (M1–M4), Keychain B1 and B2/B3, Add note, Export
  results.json.
- **Tab bar:** `flood` cycles 0 → 100K → 1M bytes/s. `⌨` asks for the keyboard. `sheet`
  and `edit` open the web sheet and the editor stand-in.
- **Key row:** `cmp` toggles the compose field (with `send`); `ctrl` applies to the
  next key; `⌨︎↓` hides the keyboard.

The app starts with the keyboard hidden: tap `⌨` or the terminal to open it.

## Run the checklist

Follow "Steps for Jimmy" in the spec. The strip shows each step; do it, then tap Pass
or Fail.

- **Fail** asks what surprised you; that note goes into the results.
- **Pass** on a step that records a value (T1, T5, T6, F1, F2, B1–B3) asks for it.
- Answers are stored with the current guard and geometry, so repeating a section in
  geometry B or with the guard off needs no extra bookkeeping.
- **Add note** in ⚙ attaches a free note to the current step.

## Measure and the Keychain check

- **⚙ → Bench** takes about 90 s. Unpair any hardware keyboard first, keep the phone
  still, and don't touch it until the status line says "Bench done". It switches
  geometry modes and opens and closes the keyboard by itself.
- **Keychain:** move the strip to B1 and use ⚙ → Keychain B1; move to B2 and use ⚙ →
  Keychain B2/B3; for B3, move to B3 first and run the same item. The status line
  shows each operation's `OSStatus` and duration (a read over ~500 ms means Face ID
  prompted).

## Hand back the results

⚙ → Export results.json → AirDrop to the Mac, then attach it in the chat with the
agent coordinating tether. If AirDrop fails, the file is also in the Files app under
On My iPhone → KB Spike.

## If something looks wrong

- **The page is blank or a red banner shows:** in Safari on the Mac, Develop →
  (the iPhone) → `spike-app://ui/index.html` opens the Web Inspector.
- **The terminal reports `renderer: dom`** in `results.json` (event `termSize`):
  WebGL failed and xterm.js fell back to its DOM renderer. The spike still runs; note
  it, since M2 then measures a heavier renderer than the real app's.
- `results.json` records every keyboard notification, first-responder change, focus
  change, refused resign (`resignAsked`), and the bridge origin WebKit reports for
  the custom scheme (`bridgeOrigin`).

## Files

| File | Holds |
|---|---|
| `project.yml` | XcodeGen spec; `KeyboardSpike.xcodeproj` is generated and gitignored |
| `Spike/AppDelegate.swift` | App and scene delegates |
| `Spike/SpikeViewController.swift` | Screen, strip, ⚙ menu, geometry modes, keyboard notifications, native sheet and prompt |
| `Spike/TerminalInputView.swift` | `UIKeyInput` responder: traits, guard, hidden-keyboard swap, hardware keys and repeat, paste |
| `Spike/Accessory.swift` | Key row, compose field, `UIPasteControl`, haptics |
| `Spike/FocusController.swift` | The only code that moves first responder |
| `Spike/Bridge.swift` | `tether` message handler with reply; coalesced `callAsyncJavaScript` sender |
| `Spike/Bench.swift` | M1–M4 |
| `Spike/Recorder.swift` | Checklist steps, event log, measurements, `results.json` |
| `Spike/KeychainCheck.swift` | Part B |
| `Spike/SchemeHandler.swift` | Serves `web/` at `spike-app://ui/` with the app's CSP |
| `web/index.html`, `web/spike.js` | The page |
| `web/xterm.mjs`, `xterm.css`, `addon-fit.mjs`, `addon-webgl.mjs` | Vendored from npm: `@xterm/xterm` 6.0.0, `@xterm/addon-fit` 0.11.0, `@xterm/addon-webgl` 0.19.0 (MIT, `xterm-LICENSE.txt`) |
