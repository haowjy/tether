# Lane C: throwaway keyboard spike app for Jimmy's iPhone

Build a **throwaway** iOS app that answers, on Jimmy's real iPhone, whether the proposed
"one keyboard" design works. Read `docs/design/research/one-keyboard.md` (the proposal; its
"What needs the phone" table is the question list) and `.meridian/work/tether-mvp/one-keyboard-answers.md`
(decisions since: the box **wraps and grows from 1 to 5 lines then scrolls**, Return sends,
no typed newlines; Return labelled Send in the line, Return in the terminal; sheet fields
are out of scope).

## What the app is

- Separate app, **bundle id `com.jimmyyao.keyboard-spike`**, display name "KB Spike", so
  it never replaces tether (`com.jimmyyao.tether`). Lives entirely under
  `/private/tmp/claude-501/-Users-jimmyyao-repos-tether/0f093dfa-b412-4340-af00-995b96abd8e2/scratchpad/kb-spike/`;
  nothing in the repo.
- A full-screen `WKWebView` drawing: a fake terminal area (monospace lines; typed terminal
  keys append to it), a dock with a **keyboard toggle** button and a **box** that is a
  plain non-editable element (the mirror): it draws the buffer text, a caret, an underlined
  marked-text range, wraps and grows 1→5 lines then scrolls.
- One hidden native responder owns the keyboard (alpha 0.01, no interaction, like tether's
  `ios/Tether/Input/TerminalInputView.swift`), with `autocorrectionType`,
  `spellCheckingType`, `inlinePredictionType`, `smartQuotesType`, `smartDashesType`,
  `smartInsertDeleteType` = `.no`, `autocapitalizationType = .none`. Make it switchable at
  runtime between a hidden **`UITextField`** and a hidden **`UITextView`** (segmented
  control in a small native debug bar) so both are tested.
- Two targets: toggle → **terminal** (each committed character/backspace/return is sent to
  the web as a key and the field stays empty; Return labelled Return); tap on the box →
  **line** (keys edit the buffer; native sends `{text, selection, marked}` on every change;
  Return with no marked text = "send": the web appends the line to the fake terminal and
  clears; Return labelled Send). Switching target changes `returnKeyType` and calls
  `reloadInputViews()` on the same responder; it must never resign first responder. Tap
  on the box places the caret at the tapped character (web maps tap → index, native sets
  `selectedTextRange`).
- On-screen log in the web page: each edit's native timestamp and the web's receive time
  (latency in ms, rolling p50/p95), marked-text state, target switches, keyboard frame
  changes. Plus a "Copy report" button that puts a text summary on the clipboard so Jimmy
  can paste it back.
- A checklist screen (or section) with the questions in plain words for Jimmy, each with
  Yes/No/notes buttons recorded into the report: no prediction strip in terminal / in box
  (both field kinds); one tap opens the keyboard into the box; toggle and box raise the same
  keyboard (no flicker, keyboard page — numbers/emoji — kept on switch); dictation into the
  box; Chinese pinyin and Korean composition, and Return confirms a candidate without
  sending; spacebar-trackpad moves the box caret and the mirror follows; held Backspace
  keeps up; hardware keyboard if he has one.

## Build and install

Device `00008150-000254DC02A3C01C` (iPhone 17 Pro, "Hao do you do?"), team `D4K9ZT557F`;
the account has a wildcard development profile. XcodeGen 2.46 and Xcode 27.1 are installed;
see `ios/AGENTS.md` and `/tmp/lead-ios-device.sh` for the exact build/sign/install commands
tether uses (`xcodebuild … DEVELOPMENT_TEAM=…`, `xcrun devicectl device install app`). If
signing fails with `errSecInternalComponent` the Mac is locked: report that, don't retry
in a loop. Before the device, run it in the iOS Simulator and check it builds, raises the
keyboard from the toggle and the box, mirrors edits, and logs latency; report what the
Simulator showed (it can't answer the prediction-strip question reliably).

Edit nothing in the repo. Report: where the spike lives, that it is installed (devicectl
output), what the Simulator showed, and the exact steps Jimmy should follow on the phone.
