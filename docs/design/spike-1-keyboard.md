# Spike 1: keyboard ownership on the iPhone

Can a native first responder keep the keyboard up over a WKWebView terminal through
everything Jimmy does in tether, and how fast does a keystroke cross from native code
into the page? The answer gates [ios-shell.md](ios-shell.md): it decides the focus
guard, the hidden-keyboard trick, the keyboard geometry, and whether the input view
needs `UITextInput`, and checks that the keystroke bridge fits in a frame. Jimmy runs
it from Xcode on his Mac with the iPhone 17 Pro (iOS 26); it takes about 45 minutes,
plus 5 for part B, which checks the Face ID-gated Keychain item that
[auth.md](auth.md) relies on.

The spike is throwaway: it lives in `ios/spikes/keyboard/` and is deleted once its
results are recorded in [research/](research/).

## What the spike app is

One screen: a full-screen WKWebView showing a real xterm.js 6 terminal and a web tab
bar, the native input view and accessory from ios-shell.md cut down to what the tests
need, and a small native control strip at the top that drives the checklist and
records results.

```text
┌──────────────────────────────────────┐
│ ◀ S3 Tap terminal ▶  [Pass][Fail] ⚙  │  native strip (UIButtons, never first responder)
│ 80×24 · kb:up · guard:on · fr:term   │  live status line
│ $ …xterm.js output (flood toggle)…   │  WKWebView
│                                      │
│ (tab1)(tab2)(tab3)  [sheet][edit][⌨] │  web tab bar and test buttons
├──────────────────────────────────────┤
│ esc tab ctrl ⇧tab ← ↑ ↓ → cmp paste ⌨̲ │  native accessory (key row)
│           iOS keyboard               │
└──────────────────────────────────────┘
```

### Files

```text
ios/spikes/keyboard/
  project.yml                 XcodeGen: one iOS app target "KeyboardSpike", iOS 26
  Spike/
    AppDelegate.swift         window + SpikeViewController
    SpikeViewController.swift WKWebView, control strip, geometry modes, native sheet
    TerminalInputView.swift   UIKeyInput + traits; pressesBegan; guard; paste(_:)
    Accessory.swift           key row (UIControls), compose UITextView, UIPasteControl, haptics
    Bridge.swift              message handler with reply; callAsyncJavaScript sender; coalescing
    Recorder.swift            event log + measurements → results.json; share sheet export
    KeychainCheck.swift       part B
    SchemeHandler.swift       serves web/ at spike-app://ui/
    Info.plist                NSFaceIDUsageDescription
    web/
      index.html, spike.js    page: terminal, tabs, sheet, editor stand-in, selection text, bench
      xterm.mjs, xterm.css    vendored from @xterm/xterm 6 (npm pack; no build step on the Mac)
  README.md                   the steps below
```

The page loads through a `WKURLSchemeHandler`, as the real app will, so the spike
also exercises the custom-scheme origin.

### What the code does

**Native.**

- `TerminalInputView` implements the input responder from
  [ios-shell.md](ios-shell.md#the-input-responder): the traits listed there,
  `hasText = true`, and `pressesBegan` for Esc, Tab, arrows, Ctrl and Option combos
  with its own repeat timer. Every input event goes to the page, where it is echoed
  into the terminal ("⟨C-c⟩", "⟨Up⟩", text as typed), so Jimmy sees what arrived.
- The guard: `canResignFirstResponder` returns `false` while "guard" is on and the
  spike's focus code isn't the one moving focus. The ⚙ menu toggles it.
- Hiding the keyboard keeps `TerminalInputView` first responder: hide swaps in an
  empty zero-height `inputView` and a nil accessory and calls `reloadInputViews()`;
  `[⌨]` swaps them back. The status line's `fr:` shows the real first responder.
- Every attempt to take first responder away while the guard was on is logged
  (from `canResignFirstResponder` being asked), with the current step.
- Geometry modes (⚙): **A** resizes the web view's frame to end at the keyboard's
  top, animated with the keyboard curve; **B** leaves the frame full size and sends
  the keyboard height to the page, which pads its bottom.
- Accessory: one row of keys, a compose toggle that shows a `UITextView` above the
  row, a `UIPasteControl`, and hide. Key-down fires a prepared light haptic.
- The ⚙ menu also opens a native sheet (`UISheetPresentationController`, no text
  field) and a native alert with a text field (the `prompt` path).
- ⚙ → Kill web process (Debug spike only) calls WebKit's private
  `_killWebContentProcess` through `perform(_:)`, to rehearse a jetsam kill; the
  spike reloads the page in `webViewWebContentProcessDidTerminate`.
- `Recorder` logs every `keyboardWillShow`/`WillHide`/`DidChangeFrame` with a
  timestamp, the current step, the first responder, and whether the spike's focus
  code caused it. It writes `results.json`.

**Web page.**

- An xterm.js terminal sized once from the web view's height with the keyboard hidden;
  it shows its cols×rows in the status line and must never change them on keyboard
  moves. Its helper textarea is made inert.
- Flood toggle: 0, 100 KB/s or 1 MB/s of coloured output generated in the page.
- Three tab buttons that swap which of three terminals is shown.
- "sheet": a web overlay with buttons, opened and closed by taps.
- "edit": an overlay with a `<textarea>` standing in for the v2 CodeMirror editor. It
  sends `focus webText` on open and `focus terminal` on close, as
  [ios-shell.md](ios-shell.md#focus-one-controller-native) specifies.
- A block of static text to long-press, select and Copy.
- Bench: answers every native `bench` event with an `ack` at once.

## Steps for Jimmy

### Once: set up

1. Mac with Xcode 26 and the iOS 26 SDK; `brew install xcodegen`.
2. On the iPhone: Settings → Privacy & Security → Developer Mode on (it restarts).
3. In Xcode → Settings → Accounts, add your Apple ID (the free Personal Team is
   enough).
4. `cd ios/spikes/keyboard && xcodegen && open KeyboardSpike.xcodeproj`.
5. Target KeyboardSpike → Signing & Capabilities: pick your Personal Team; change
   the bundle id if Xcode says it's taken.
6. Plug in the phone (or pair it over Wi-Fi), pick it as the run destination, ⌘R.
7. First install only: on the phone, Settings → General → VPN & Device Management →
   trust your developer certificate, then ⌘R again.
8. Have a Bluetooth or Magic Keyboard nearby for section 4, unpaired for now.

The spike's Swift was written on the Linux dev box, which has no Xcode, so the first
⌘R may stop on compile errors. Paste them into the chat with the agent that wrote
the spike; expect one or two rounds before it runs.

### Run the checklist

The strip at the top shows the step. Do it, tap Pass or Fail, ▶ to the next step.
Tap Fail when anything surprises you, and say what in the note prompt that follows.
Run sections 1–3 with guard on and geometry A, then repeat sections 1 and 2 with
geometry B.

**1. Keyboard stays up** (open the keyboard with `[⌨]` first, flood at 1 MB/s from S1)

| Step | Do | Pass when |
|---|---|---|
| S1 | Scroll the terminal up and down, fling it | Keyboard stays up |
| S2 | Tap the terminal 5 times in different places | Keyboard stays up |
| S3 | Tap tab1, tab2, tab3, several times | Keyboard stays up; typing goes to the shown tab |
| S4 | Open and close the web sheet; tap buttons inside it | Keyboard stays up |
| S5 | ⚙ → native sheet, then dismiss it | Keyboard is up again afterwards without a tap |
| S6 | Rotate to landscape and back | Keyboard stays up; cols×rows changes only on rotation |
| S7 | Long-press the static text, drag the handles, tap Copy, then tap the terminal | Selection and Copy work. Keyboard stays up, or comes back by itself when selection ends. Paste into Notes later to confirm the copy |
| S8 | Swipe home, wait 10 s, return to the app | Keyboard comes back by itself |
| S9 | Pull down Notification Center, then Control Center, and return | Keyboard stays or comes back by itself |
| S10 | ⚙ → native prompt; type in its field; OK | Keyboard returns to the terminal afterwards |
| S11 | Tap "edit", tap into its text area, type, close it | Text area gets the keyboard (WebKit's ✓ bar may show); after close, terminal input works without a tap |
| S12 | Tap `cmp`, type in compose, tap `cmp` again | Keyboard never drops while switching |
| S13 | Hide the keyboard with the hide key. Tap the tab bar, then the web sheet, then the terminal | While hidden, `fr:` stays the terminal input; the terminal tap brings the keyboard back |
| S14 | With the keyboard up, ⚙ → Kill web process | The page reloads and the keyboard is up again without a tap |

Then turn the guard off (⚙) and repeat S1–S3. This shows what the guard is buying;
failures here are expected.

**2. Typing in the terminal input**

| Step | Do | Record |
|---|---|---|
| T1 | Look above the keyboard | Is there a QuickType / prediction bar? (Yes/No) |
| T2 | Type `hello world. it's "fine" -- ok` | Echo matches exactly: no capitals added, no curly quotes, no em dash, no corrections |
| T3 | Type two spaces quickly | Two spaces, not ". " |
| T4 | Backspace 3 times on an empty line | 3 ⟨BSpace⟩ echoed |
| T5 | Swipe-type a word | Word arrives (note whether a space is added) |
| T6 | Tap the keyboard's mic, if shown, and dictate | Note what happens; any crash is a Fail |
| T7 | In compose: dictate a sentence; type with autocorrect; send | Dictation and autocorrect work there; text arrives as one paste |
| T8 | Tap paste in the key row with text on the clipboard | Pastes with no "Allow Paste" prompt |

**3. Feel**

| Step | Do | Record |
|---|---|---|
| F1 | Tap key-row keys quickly | Haptic on every key? Feels like Termius or better? (1–5) |
| F2 | Open/close the keyboard 5 times with `[⌨]` and the hide key | Smooth? Does the tab bar track the keyboard without a jump? (1–5, per geometry mode) |

**4. Hardware keyboard** (pair it now)

| Step | Do | Pass when the echo shows |
|---|---|---|
| H1 | Esc | ⟨Escape⟩ |
| H2 | Ctrl+C, Ctrl+D, Ctrl+R, Ctrl+A, Ctrl+Z, Ctrl+B | ⟨C-c⟩ ⟨C-d⟩ ⟨C-r⟩ ⟨C-a⟩ ⟨C-z⟩ ⟨C-b⟩, and iOS does nothing else |
| H3 | Hold ← for 2 s, then ↑ | Repeating ⟨Left⟩ while held, stops on release |
| H4 | Tab, Shift+Tab | ⟨Tab⟩ ⟨BTab⟩ |
| H5 | Option+B, Option+Enter | ⟨M-b⟩ ⟨M-Enter⟩ |
| H6 | Type a sentence with Shift and punctuation | Text exactly as typed |
| H7 | Cmd+V with text on the clipboard | Pastes, no prompt |
| H8 | Look at the bottom of the screen | Key row collapsed to the thin strip; no software keyboard |
| H9 | Hide the keyboard with the hide key, then type on the hardware keyboard | Keys still echo (the terminal input kept first responder) |

Unpair the keyboard afterwards and check the software keyboard comes back on `[⌨]`.

### Measure

⚙ → Bench runs each automatically and writes the numbers into `results.json`; keep
the phone still and the app in front.

| Bench | What it does | Recorded |
|---|---|---|
| M1 key RTT, idle | 1000 input events at 60/s, native → page → `ack` → native, timed with `CACurrentMediaTime` | p50, p95, p99, max of the round trip, and half of it as the one-way estimate |
| M2 key RTT, flood | M1 with the page writing 1 MB/s into xterm.js | same |
| M3 web → native | Page posts 1000 `haptic` requests with reply | p50, p99 |
| M4 keyboard timing | 10 rounds of show/hide driven by the spike | `becomeFirstResponder` → `keyboardDidShow` ms; frame-change → page layout settled (page reports after the next animation frame) ms, per geometry mode |

### Part B: Keychain check

⚙ → Keychain check. The item is the one auth.md specifies: a generic password with
access control `.biometryCurrentSet` and `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`.
Each step reports the `OSStatus`; Jimmy counts Face ID prompts.

| Step | Do | Pass when |
|---|---|---|
| B1 | Add the item | No prompt |
| B2 | Read it, then delete it and add it again with new data | One Face ID prompt for the read, none for the delete and add; the read returns the data |
| B3 | Settings → Face ID → Set Up an Alternate Appearance (any face), back to the spike, read; then delete and add again | Record the read's exact `OSStatus` (is it `errSecItemNotFound`?) and whether delete and add still succeed. Afterwards, Reset Face ID in Settings and set it up again. About 3 minutes |

### Hand back the results

⚙ → Export → AirDrop `results.json` to the Mac and attach or paste it into the chat
with the agent coordinating tether. That agent records the results in
`docs/design/research/` and decides from them. The file holds the checklist answers,
notes, the event log and every measurement.

## Pass and fail

**Spike 1 passes**, and the design in ios-shell.md stands, when all of these hold:

| Criterion | Requirement |
|---|---|
| Keyboard stays up | S1–S4 and S12 pass with the guard on, in at least one geometry mode: zero unrequested hides |
| Self-restoring | S5, S7, S8, S9, S10, S11 and S14 pass: the keyboard is back without a tap |
| Hidden keeps input | S13 and H9 pass |
| Terminal size | cols×rows never changes on a keyboard move (S1–S12), only on rotation (S6) |
| Clean input | T2, T3 and T4 pass |
| Hardware keys | H1, H2 (C-c, C-d), H3, H4 and H6 pass |

Recorded, but not pass/fail: QuickType (T1), dictation in the terminal input (T6),
feel (F1, F2), Option keys (H5), and every measurement.

**If it fails:**

| Failure | Next step |
|---|---|
| Taps or scrolls take the keyboard even with the guard (S1–S4) | Put a transparent native touch layer over the terminal in `terminal` mode, translating touches into bridge events, so WebKit never gets them; selection then moves to a mode that removes the layer. Re-run section 1 |
| Selection and Copy don't work with the guard (S7) | Use the `focus select` path in ios-shell.md: drop the guard during selection and restore after. Re-run S7 |
| Text arrives altered (T2–T4) | Switch the input view to `UITextInput` with an empty document that is reset after each insert. Re-run section 2 |
| Esc or Ctrl+C/D never reach `pressesBegan` | Check `UIKeyCommand` with `wantsPriorityOverSystemBehavior` for those keys; failing that, map Cmd+. to Esc as iPad terminals do |
| Geometry A janks and B doesn't (F2, M4) | Adopt B in ios-shell.md |
| The empty `inputView` shows a blank keyboard area, or loses first responder (S13, H9) | Fall back to resigning in `hidden`, with the guard off while hidden, and accept that a tap on the web while hidden may hand WebKit first responder |

## What the numbers decide

| Result | Decision |
|---|---|
| M2 round trip p99 ≤ 16 ms | Input path accepted as designed |
| M2 round trip p99 > 16 ms | Tune input coalescing and the page's output batching, then re-run M2. Moving the socket to native wouldn't help: the echo would cross the bridge instead ([ios-shell.md](ios-shell.md#transport)) |
| B1 or B2 prompts where it shouldn't | Revise auth.md's Keychain use before building auth |
| B3's `OSStatus` | Recorded in auth.md as the Face ID-changed signal ([auth.md](auth.md#recovery)) |

16 ms is one 60 Hz frame. Keystroke-to-echo also includes the network round trip
(spike 3 measures it on cellular); the bridge should be a small share of it. Where
the WebSocket lives is decided by spike 3's reconnect test, not by these numbers.

## Not in this spike

The real daemon, tmux and the network (spikes 2 and 3), the WKWebView WebSocket
after resume (spike 3), video through the native player, and the selection overlay's
alignment (spike 5). Spike 1 needs no server.
