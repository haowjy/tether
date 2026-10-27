# One keyboard: native owns typing, the box draws the line

Status: **decided 2026-10-26** — see [One keyboard: native owns line editing, web mirrors it](../decisions.md#one-keyboard-native-owns-line-editing-web-mirrors-it).
The current rule is folded into [ios-shell.md](../ios-shell.md#focus-one-controller-native),
[plan.md](../plan.md#autocorrect-and-text-input) and client-architecture §6.5 and §7.4.

## Recommendation

In the app, one native responder owns the keyboard on Terminal, always. It is a hidden
`UITextField` subclass with every prediction trait off, and it has two **targets**: the
terminal (keys go to tmux as typed) and the line (keys edit a one-line buffer). The dock's
box stops being an `<input>`: the web draws the buffer's text, caret and composition, and
mirrors what native reports. Tapping the box switches the target to the line; it never
moves first responder.

This is the "native owns both" candidate, with a `UITextField` where the brief assumed a
bare `UIKeyInput`. That swap is what makes it affordable: `UITextField` brings marked text
(CJK and other IMEs), dictation, the spacebar caret trackpad and undo, through public API
only.

What it fixes, by construction:

- **Predictions.** The line's keyboard is a native field with
  autocorrection, capitalization, spelling, smart punctuation, smart editing and inline
  prediction traits set to `.no`; `keyboardType = .default` retains locale IMEs and
  dictation. No WebKit swizzle.
- **Two taps.** There is no hand-off between responders, so there is no guard to drop and
  nothing for WebKit to refuse. One tap on the box raises the keyboard into the line.
- **Two keyboards.** Toggle and box raise the same keyboard, same type, same traits. What
  differs is only where the characters go, and the cursor cues already show that: a solid
  block in the terminal, or a caret in the box with a hollow terminal cursor.

What it costs: the box loses WebKit's in-field editing UI (loupe, selection handles, the
field's own Paste menu), which the web replaces with tap-to-place-caret and a small menu;
a new bridge contract for the mirrored line; and the dock has two editing presentations,
one per platform. Both boxes wrap visually to five lines before scrolling, but remain one
logical line.

It keeps Jimmy's 2026-10-24 call, "two keyboard openers, one closer": toggle → terminal,
box → line, toggle closes either.

## Modes after the change

`FocusController.Mode` becomes `hidden | terminal | line | webText | select`. Only
`webText` and `select` hand first responder to WebKit, and neither happens on Terminal's
resting dock.

| Mode | First responder | Keyboard | Typing does | Toggle does | Tap on the box does |
|---|---|---|---|---|---|
| `hidden` | native input, empty `inputView` | down | hardware keys go to the terminal | → `terminal` | → `line` |
| `terminal` | native input | up | each key to tmux (`text`, `BSpace`, `Enter`) | → `hidden` | → `line`, keyboard stays up |
| `line` | native input (same object) | up, Return labelled Send | edits the buffer; the box mirrors it; Return sends line + Enter | → `hidden` | places the caret at the tapped character |
| `webText` | WebKit content view | WebKit's | a sheet's or Files' own field | (dock not shown) | (dock not shown) |
| `select` | WebKit content view | down | — | unchanged from today | unchanged from today |

- Switching `terminal` ↔ `line` changes a flag and `returnKeyType`, then calls
  `reloadInputViews()` on the same responder. The keyboard does not go down.
- Restore after an interruption brings `line` back as `line`. Today it comes back as
  `terminal`, because WebKit focuses a field only on a tap; native needs no tap.
- Hardware keys in `line`: printable keys, ←/→, Backspace and ⌘V edit the buffer; Return
  sends; Esc, Tab, ↑/↓ and Ctrl chords go to the terminal, as the key row's control keys
  already do.
- Armed ctrl/alt stay the web's. The web tells native when a modifier is armed; in `line`,
  native then sends the next single character to the terminal input path, which applies
  the chord and disarms, instead of inserting it.

## What happens to each piece

| Piece | Fate |
|---|---|
| `LineFieldLender` | **Deleted**, with its passive recognizer, pending-touch flag and 0.5 s timer. |
| `lineField { rect }` bridge message, `input.setLineFieldRect` | **Deleted.** |
| `FocusController` | Keeps the guard against WebKit taking the responder on Terminal. Loses `allowLineFieldTouch`, `lineFieldConfirmed`, `lineFieldLent` and the "webText from the line comes back as terminal" rule. Gains `line`. |
| `TerminalInputView` | **Replaced** by one `KeyboardInput: UITextField`, hidden like today (alpha 0.01, no interaction). Its hardware-key mapping and key repeat move over unchanged. In `terminal` it forwards each committed edit and keeps itself empty; Backspace on empty sends `BSpace`. |
| `WebKitAccessoryBar` | **Deleted.** Its trait half is no longer needed; its accessory-bar half today does nothing anyway (it runs before the content view exists). Sheet fields off Terminal get WebKit's usual chrome; see decision 4. |
| `LineInput` (web primitive) | **Kept for the browser and the PWA**, where there is no native responder. It is a textarea so the one-line buffer can wrap and grow to five visual lines. |
| New `LineMirror` (web) | The app's box: a non-editable element that draws the text, the caret, a selection and an underlined composition, scrolls to keep the caret in view, maps a tap to a character index, and offers Paste / Select all / Clear on long-press. `LineField` picks `LineInput` or `LineMirror` from the existing `directInput` capability; `Platform` intentionally exposes no environment-name switch. |
| Draft store (`lineDrafts`) | **Unchanged as the owner**: per-tab text, notes, pending sends, persistence through `draftGet/draftPut`. Native holds only the editing copy while in `line`. The `echo` workaround in `LineField` goes: native consumes Return itself, so no late edit follows a send. |
| Key row → line | `insertIntoLine` (`setRangeText` on the DOM input) becomes a bridge call. |

### Bridge contract

| Direction | Message | Meaning |
|---|---|---|
| web → native | `focus line` | Take the keyboard into the line (mode table above). |
| web → native | `lineSet { gen, text, caret, tab }` | Load a tab's draft into the buffer: on entering `line`, on a tab switch while in `line`, after a send clears it, after the store refuses an edit. A new `gen` replaces the buffer; a same-generation Return acknowledgement preserves typing that arrived after native cleared the submitted line. |
| native → web | `lineEdit { gen, text, tab, selection, marked }` | Every buffer change. The web ignores a stale generation for that tab, applies a valid edit to that tab's draft, and answers a refused edit with `lineSet` only while it still owns the target. |
| native → web | `lineReturn { gen, text, tab }` | Return with no composition open. Native captures its text and tab at the key press and clears into the next generation immediately; the web sends that exact line (or `Enter` if empty), not a later edit or newly active tab. |
| web → native | `lineCaret { index }`, `lineInsert { text }`, `lineSelectAll {}` | A tap in the box; a key-row character or a one-line paste from the box's menu; or Select all from the menu. |
| web → native | `modifiers { armed }` | So native can route the next character as a chord. |

The web stays the owner of what Return means and of the draft; native owns only editing.
That keeps the send path, its error notes and the per-tab draft rules exactly where they
are. `lineSelectAll {}` extends the listed bridge messages: the proposal's `lineCaret` and
`lineSet` cannot express selection of the native editing copy, which the settled menu
requires. `lineSet` also carries `tab` beyond the proposal: native's `activeTab` arrives
separately, and a restart between a tab switch and buffer load must not label the old edit
as belonging to the new tab. Capturing `text` and `tab` on `lineReturn` extends the proposed
`gen`-only event: a Return buffered across Boot must send the line present at the key press,
not whatever the user types before the page replays it. `lineEdit` also carries `tab`: the
last edit can arrive after a focus or tab transition, so its generation is checked against
the generation last loaded for that tab and a valid edit still updates that tab's draft.
A same-generation `lineSet`
acknowledgement cannot replace text typed into the already-advanced native buffer.
Native retains up to 16 Return edges / 256 KiB while WebKit's page loads or restarts,
retries after the page calls `ready` once its receiver is installed, and keeps an edge if
the JavaScript call fails. At the bound it leaves the current line in the field and warns.
The native adapter then buffers delivery until the app controller and dock subscribe.
`Boot.focusMode`, the tab-bound `lineSnapshot` and route-fragment preservation carry the target and live
text/caret/composition through a WKWebView content-process
restart. `lineDrafts` reconciles the snapshot after storage lists; native line events received
before the dock or draft list is ready are buffered, so the old draft cannot overwrite a
newer native edit and Return is not dropped.

The dock's async Paste callback also keeps `Pastes`' captured tab/window. If focus leaves
native `line` while the system clipboard prompt is open, one-line text falls back to that
captured terminal paste instead of editing a different tab's current buffer. Browser
`LineInput` intercepts line-break input as Send and refuses stray inserted newlines, while
still excluding a composing candidate Return.

## What changes for the user

| Area | Today (app) | After |
|---|---|---|
| Predictions on the line | shown (swizzle fails) | gone, through public traits |
| Opening the line | sometimes two taps | one tap |
| CJK / IME | line only, via WebKit | line via `UITextField`; the terminal target can also compose, sending the committed text |
| Dictation | line, via WebKit | line, native; terminal target receives the result as typed text |
| Caret inside the line | WebKit's caret, loupe, handles | tap to place, spacebar trackpad; no handles or loupe |
| Selecting part of the line | handles | Select all only (decision 2) |
| Paste into the line | the field's menu | the box's long-press menu: one line inserted; text with a line break goes to the terminal as one paste, as today |
| Copy from the terminal, `select` | unchanged | unchanged |
| vim, `less`, password prompts, `y/n` | toggle → terminal | unchanged: the terminal target is today's raw typing |
| Hardware keyboard | terminal; line via WebKit | terminal; line via the same responder, with the routing above |
| Mobile browser, PWA | editable `<textarea>` with WebKit's keyboard | unchanged; Safari offers no way to drop its system prediction strip |

## Settled decisions

1. **Two targets, one responder:** toggle → `terminal`, box → `line`, toggle closes either. The box remains a second opener so raw typing still reaches vim, `less`, password prompts and single-key `y/n` menus.
2. **Line selection:** tap-to-place caret, spacebar trackpad, long-press Paste / Select all / Clear; no handles.
3. **Return label:** Send in `line`, plain Return in `terminal`.
4. **Sheet fields:** switcher search, rename and Files keep WebKit's keyboard, including its prediction strip and form bar. The private predictions swizzle is removed.

## What needs the phone

These checks are the real-phone acceptance gate; Jimmy will exercise them in the real
app, not in a throwaway spike.

| Question | Why it matters |
|---|---|
| Does a hidden `UITextField` with the three traits `.no` show no predictive strip on his iOS version? | The whole recommendation rests on it. The toggle's `UIKeyInput` shows none today, which is evidence, not proof, for a text field. |
| Does dictation work into a hidden field (mic key, streaming text, where iOS draws its indicator)? | Dictation is a stated requirement of the line. |
| Do Chinese and Korean composition and candidates work in the hidden field, and does Return confirm a candidate without firing `lineReturn`? | IME correctness. |
| Does `reloadInputViews()` on a target switch flicker the keyboard or reset its page (numbers, emoji)? | Decision 3, and whether the switch feels instant. |
| Does the spacebar trackpad move the hidden caret, and does the mirror keep up? | The only fine caret control left. |
| Bridge latency of `lineEdit` per keystroke, held Backspace included | The box must not lag the keyboard. |
| Hardware keyboard routing in `line` | The split of keys between buffer and terminal. |

## Rejected

- **WebKit owns the keyboard in both targets.** Raw typing through a hidden textarea is
  the xterm.js path that [ios-web.md](ios-web.md) found broken on iOS (duplicate commits,
  IME and dictation issues). Predictions would still need the private content-view swizzle
  for both targets, and WebKit raises the keyboard only inside a user gesture, so restore
  after a sheet or the background would need a tap. It reverses
  [Keyboard: native Swift shell first](../decisions.md#keyboard-native-swift-shell-first).
- **Keep both responders, fix the two bugs.** Cheapest: move the swizzle after the content
  view exists and fix the first-touch guard. But the toggle's and the box's keyboards stay
  different objects with different traits, every switch moves first responder through the
  lender, and the private swizzle stays load-bearing for the strip. It fixes the symptoms
  and keeps the split Jimmy is objecting to.
- **Native line with a bare `UIKeyInput` buffer** (the brief's candidate 2 as written).
  No marked text, so CJK in the line breaks, and caret, selection and undo all become
  ours. A full custom `UITextInput` would fix that at several hundred lines of position,
  range and tokenizer code that `UITextField` already is.
- **A visible native `UITextField` laid over the web dock.** Rejected on 2026-10-24
  ([The dock is web](../decisions.md#the-dock-is-web-in-every-touch-client)): its frame
  would track web layout through scroll, rotation and the keyboard animation. Here the
  field is hidden and the web still draws the whole dock, so that objection does not
  apply.

## Where this contradicts the current spec

- **ios-shell.md, "Focus: one controller, native":** the `webText` row's "a touch in the
  line field's rect while on Terminal", the guard's line-field exception, the restore rule
  for a lent line field, and "Native removes WebKit's form accessory bar" all go. `line`
  joins the table.
- **plan.md, "Autocorrect and text input":** "In the app it is a bare `UIKeyInput`"
  becomes a hidden `UITextField`; "Dictation, CJK input and IME belong to the dock's line
  field" stays true, now natively in the app.
- **decisions.md:** supersedes "Native lends the line field to WebKit by touch location"
  and the mechanism of "No predictions on the line field". Refines "The dock is web, in
  every touch client": the web still draws everything, but in the app native edits the
  line's text.
- **client-architecture §6.5:** the `line` owner is held by native's responder in the
  app; the resting-mode rule "comes back as the terminal input" goes. **§7.4:** the line
  field is `LineMirror` in the app and `LineInput` elsewhere; `setLineFieldRect` goes.
  (client-architecture.md lives in the work directory, not `docs/design/client/`.)

## Settled implementation choices

- The browser `LineInput` is a `<textarea>`, not the proposal's assumed `<input>`: a text
  input cannot visually wrap into the specified five-line box. It remains a browser-owned
  editor and still sends on Return without inserting a newline.
- The menu's Select all needs a separate `lineSelectAll {}` bridge request. The listed
  `lineCaret` and `lineSet` messages alone cannot select the native text field's contents.
- Both browser and app keep the five-line ceiling and inner scrolling; neither platform
  gets a different logical-line or paste rule.

## Sources

- `ios/Tether/Input/{TerminalInputView,FocusController,LineFieldLender}.swift`,
  `ios/Tether/Web/WebKitAccessoryBar.swift`, `WebShellController.swift:204–292`
- `web/screens/terminal/dock/{Dock,LineField}.tsx`, `web/ui/primitives/LineInput.tsx`,
  `web/platform/native/bridge.ts`
- decisions.md, 2026-10-24 "Phone input follows Termius" section and 2026-10-26 "No
  predictions on the line field"; the work item's `phone-input-decisions.md`
