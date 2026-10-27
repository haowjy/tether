# Build: one keyboard in the iOS app (native owns typing, the box mirrors the line)

Jimmy's symptoms on his iPhone, verbatim: "I still get predictions on the iphone app, and
swapping between if i used the button or if i used the box is still really wonky (they do
different things still)"; "I have to press the box twice to open the keyboard sometimes";
"it should just act like a text box / not be a text box / a local text box / and then also
the predictions should go away".

**The design is `docs/design/research/one-keyboard.md` — read all of it first.** Jimmy's
answers to its four decisions and later changes: `.meridian/work/tether-mvp/one-keyboard-answers.md`
(rounds 1-6). Settled:

1. Two openers, one keyboard: the dock's keyboard toggle → target `terminal` (keys to tmux
   as typed); a tap on the box → target `line` (keys edit the buffer). Toggle closes either.
   A tap on the terminal's cursor row ±1 opens `terminal` (already built, commit 95f8a97).
2. Inside the box: tap places the caret, spacebar trackpad, long-press menu Paste / Select
   all / Clear. No handles.
3. Return is labelled **Send** in `line`, **Return** in `terminal`.
4. Sheet fields (switcher search, rename, Files) keep WebKit's keyboard; the
   predictions swizzle goes.
5. **The box wraps and grows from 1 to 5 lines, then scrolls inside**; it is still one
   logical line: Return sends, no typed newlines; a paste with line breaks goes to the
   terminal as one paste, as today.
6. Native responder: one hidden **`UITextField`** subclass (all prediction/smart traits
   `.no`, `autocapitalizationType = .none`), replacing `TerminalInputView`. No spike: Jimmy
   tests on the real app.

Implement the proposal's mode table, "What happens to each piece" and "Bridge contract"
(`focus line`, `lineSet {gen,text,caret}`, `lineEdit {gen,text,selection,marked}`,
`lineReturn {gen}`, `lineCaret {index}`, `lineInsert {text}`, `modifiers {armed}`).
Delete `LineFieldLender`, the `lineField {rect}` message and `input.setLineFieldRect`,
`WebKitAccessoryBar`, the line-field-lent rules in `FocusController`, and the `echo`
workaround in `LineField`. Keep `LineInput` for the browser/PWA; add `LineMirror` for the
app; `LineField` picks by `app.platform`. The draft store (`lineDrafts`) stays the owner.
Hardware keys in `line` per the proposal. Restore after interruption brings `line` back.

Where the proposal leaves a choice to the implementer, decide and say why in the report.
If something in it turns out wrong against the code, follow the code's reality, record the
divergence in the report and in the spec.

## Specs in the same change

Fold the proposal into the current-truth docs it lists under "Where this contradicts the
current spec": `docs/design/ios-shell.md` (Focus, the mode table, bridge table),
`docs/design/plan.md` ("Autocorrect and text input", the dock/line field),
`.meridian/work/tether-mvp/design/client-architecture.md` §6.5 and §7.4, plus the box's
growth rule in `docs/design/client/browser-behaviors.md` (Phone dock). Add a dated
2026-10-26 `docs/design/decisions.md` entry quoting Jimmy, superseding by title "Native
lends the line field to WebKit by touch location" and the mechanism of "No predictions on
the line field". Mark `docs/design/research/one-keyboard.md` Status: decided, pointing at
the entry. CHANGELOG `[Unreleased]` bullet. `ios/AGENTS.md` / `.context/` notes if they
describe the deleted pieces.

## Constraints

- Swift: `ios/` conventions in `ios/AGENTS.md`; one native focus controller (plan.md "Code
  structure and standards"). Web: `web/AGENTS.md` React rules, pnpm only.
- Bridge messages are typed on both sides (`web/platform/native/bridge.ts`, its Swift
  counterpart); keep them in step.
- No new permanent tests (Jimmy's standing instruction); update/delete existing ones that
  pin deleted behaviour. Delete scratch tests.
- Gates: `pnpm --dir web run check`, `./ios/scripts/check.sh` (includes `swift test`),
  `scripts/preflight.sh full`. Do not commit; do not install on the phone (the lead does).

## Verify

What you can without the phone: the iOS Simulator app (the dev shim / fixture host if no
daemon; better, a local daemon on a private tmux socket `-L` with a session) — build,
launch, and drive what the environment allows; the web side against a fake native bridge
in Playwright (mirror draws text/caret/marked range, grows to 5 lines then scrolls, tap →
`lineCaret` index, `lineEdit` stale `gen` ignored, `lineReturn` sends via the draft store,
`lineSet` after send clears). Say exactly what was and wasn't exercised; list the phone
checks Jimmy must do (the proposal's "What needs the phone" table).
