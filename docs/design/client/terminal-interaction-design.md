# Touch, clipboard, and the line field: evidence-led direction

Status: current interaction contract; device-specific touch and clipboard gates remain. The 2026-10-26 app keyboard rule is in [one-keyboard.md](../research/one-keyboard.md). This supplements browser-behaviors.md and supersedes any inference that a mockup proves real touch/clipboard behavior. Evidence: terminal-interaction-sources.md, terminal-interaction-probe.md, and the pinned-source study terminal-selection-source-research.md (completed pinned xterm 6.0.0 source study and isolated headless probe).

## Decisions supported now

### One gesture owner, not separate competing click handlers

A short tap becomes a remote mouse click only when the application has requested a supported mouse-reporting mode. Alternate-screen status alone is insufficient. With the keyboard up and the line field owning typing, tapping the terminal only moves typing to the terminal without lowering the keyboard: no click and no cursor move, so the tap cannot act on vim or htop mid-line, and the next tap acts as usual (`tapAction` in `touchControl.ts` resolves every tap to one action). With the keyboard down, a tap on the cursor's row or the row directly above or below it raises terminal input (not while scrolled back into history). In app mouse mode the tap is still sent as a click. With no mouse mode, a keyboard-down tap elsewhere does nothing. On a prompt's OSC 133 input row, the tap may move the cursor, only while terminal input already owns the keyboard. Desktop click-to-focus is unchanged.

A long-press fires with a haptic and highlights the word under the finger at once, entering local selection. Dragging while still held extends the selection to follow the finger, by cell and across rows; releasing shows the handles, which extend it further, and tether's edit menu, which offers Copy and Paste (Paste alone when released over a blank cell); Paste sends the clipboard to the terminal as one paste without Enter. Movement before the long-press fires is scrolling; pointercancel cancels pending input. (Jimmy, 2026-10-24: "long press -> release -> highlight word -> can drag it further"; 2026-10-26: no arrow pad, the long-press highlights at once and a drag extends it, as in Termius.) This terminal-selection gesture has no spacebar-trackpad mapping; the native line `UITextField` separately provides iOS's spacebar caret trackpad. Do not send remote mouse-down on initial touch: it would already affect the TUI before a later long-press is recognized. Send tap press/release only after the gesture resolves as a tap. Selection consumes its gestures; copying must never click the application or paste back into it.

The browser adapter must declare pan ownership with touch-action before gestures and handle pointer cancellation, not fight the browser with blanket preventDefault. Coordinate conversion uses actual terminal-cell metrics, visual viewport offsets, panning transform, buffer position, and pane identity. Do not derive cell coordinates from guessed font size. Native/web adapters feed the same semantic interaction intents, with one focus owner per environment.

Provisional gesture arbitration needs a device prototype: long-press priority and native selection initiation cannot be validated from desktop synthetic mouse events. Avoid promising double-tap word selection on the live TUI until it is proven not to send an unwanted first click. Word/line gestures inside selection mode are safer to evaluate first.

### Copy logical terminal text, not screen-shaped HTML

Soft wraps are not line breaks. Explicit hard breaks and blank lines remain; partial selections include only their endpoints. Indentation must survive. Terminal grid copy is not a byte-for-byte reconstruction of the program's original file (tabs may already have been expanded by terminal rendering).

Use supported xterm selection/text APIs when their underlying wrap metadata is authoritative. For mobile native handles, prototype an on-demand selectable DOM/text representation backed by a bounded immutable selection snapshot, using the same logical-line serialization. Do not scrape canvas pixels, insert BR at every displayed row, or use an unrelated innerText serializer. Render untrusted terminal content as text, not HTML.

New output continues while local selection stays anchored to its snapshot. Snapshot memory exists only while selecting, with a cap; dismiss frees it. This must not create a second always-running terminal emulator or retain unbounded history for inactive panes.

**Wrap prerequisite resolved by L3:** the daemon now pairs physical `-N -T` rows with `-J` logical rows in the same command group, then replays only unambiguous continuations into xterm's `isWrapped` state. History chunks carry a separate bitmap and the history driver joins those rows for copy. This fixes the data boundary after reconnect, snapshot, and history fetch; it does not implement the mobile selection UI or prove real-device clipboard behavior. Full-width rows are not evidence of wrapping: a hard newline can occur at the exact same column.

### Paste uses one path and the receiving app's mode

Clipboard text and the line field's Return use the existing paste request → private temp file → tmux load-buffer/paste-buffer -p route. Do not convert each newline into an independent key event and do not add a trailing Enter to a clipboard paste (the line field's Return adds exactly one Enter after its paste). Avoid double-wrapping bracketed paste in both browser and tmux. Pane-side mode is authoritative; reconstructed frontend mode may be incomplete after snapshot.

Observed on tmux 3.4: LF becomes CR inside the terminal paste stream; bracketed markers are present only when the pane app enabled them. Clipboard trailing newline remains a trailing newline. Consequently, embedded newlines can execute commands when bracketed paste is absent or mishandled; “no extra Enter” is not a safety guarantee.

Use real user paste/copy events and text/plain. A user-driven Copy action may call clipboard write within the gesture, with explicit failure feedback; do not await a slow server read and assume Safari will retain activation. Have bounded selection data ready before Copy. Synthetic ClipboardEvents do not establish clipboard permissions or actual paste behavior. Image paste stays the existing upload/path route, separate from plain text.

### The dock: line field, key row and one keyboard toggle

On touch, Terminal ends in a dock shared by the phone browser, PWA and native app. With the keyboard down, the bar holds Home, the current-tab button, which opens the picker sheet, and Show keyboard. With it up, the bar is hidden and the compose box is always visible above the text-only key row, which includes Hide keyboard. The web draws the controls; layout and sizes are in [browser-behaviors.md](browser-behaviors.md#phone-dock).

**Two targets share one keyboard in the app.** The *terminal* target sends each keystroke as typed. In the browser/PWA the *line field* is an editable textarea; in the app a single hidden native `UITextField` edits the line and the web draws a non-editable mirror. Native app traits disable autocorrection, capitalization, spell checking, smart punctuation and inline prediction; WebKit-owned sheet fields keep WebKit's ordinary editor. The app mirror supports tap-to-place-caret, marked composition, the spacebar caret trackpad and Paste / Select all / Clear without handles. Auto-capitalization is off for the browser field too, since most lines are commands; dictation may capitalize on its own. Nothing typed in the line target reaches tmux until Return.

| Action | Keyboard down | Terminal input owns it | Line field owns it |
| --- | --- | --- | --- |
| Keyboard toggle | terminal target takes it; keyboard up | keyboard down | keyboard down |
| Tap the line field | not shown | line target takes it; keyboard stays up | caret moves in the existing editor |
| Tap the terminal | near the cursor, terminal target takes it; keyboard up | terminal stays selected | terminal target takes it; keyboard stays up |
| Key-row unmodified ← / → | key row hidden | sent to the terminal | move the line caret |
| Key-row unmodified esc | key row hidden | sent to the terminal | terminal target takes focus; keyboard stays up |
| Key-row ↑, ↓, ^R, ^C, tab and other terminal controls | key row hidden | sent to the terminal | sent to the terminal |
| Key-row character key (`\| ~ / -`) | key row hidden | sent to the terminal | inserted at the caret |

Where a key-row key goes is one rule, `routeKey(key, owner, armed)` in `web/touch/keyRoute.ts`, shared by the browser textarea and the native line; the key row marks the keys it sends to the box. A caret step is the editor's own: the browser textarea steps by grapheme, and the app asks native (`lineCaretStep`), which steps with UIKit's positions and drops the step while the keyboard composes. An armed ctrl or alt turns even ← and → into the chord for tmux.

In the app, the toggle, box tap, terminal tap and esc switch targets on the same responder: Show keyboard opens `terminal`, box tap opens `line`, and Hide keyboard closes either. After closing `line`, Show keyboard opens `terminal`. In browser/PWA the DOM line editor remains the target for the box tap. The box's terminal control also returns to terminal typing without hiding the keyboard.

**Focus cues** show which target owns the keyboard. Terminal: the terminal cursor is a solid block; the idle box has no caret and shows its draft or placeholder; Return is labelled Return. Line: the box has a ring, caret and Send, the terminal cursor is a hollow outline, and Return is labelled Send (`enterkeyhint="send"` in browser/PWA; native `returnKeyType = .send`). The key row visually distinguishes keys that act on the box from keys that still go to tmux. There is one active typing cursor.

**Return** in the line field sends its text to the active tab and then Enter, and clears the field; the field keeps the keyboard for the next line. The text goes as one `paste` with `enter` (so a pane that asked for bracketed paste sees it delimited, with the Enter outside it); the daemon runs the Enter in the same tmux command group right after the paste, and tmux skips it if the paste fails. The daemon answers that paste exactly once, `pasted` or a refusal naming its `req` ([daemon-core.md](../daemon-core.md#53-json-messages)). A refusal puts the line back into that tab's draft, ahead of anything typed since, with the reason ("Not sent: …"); so does a socket drop before the answer, marked "May not have been sent". There is no client-side timeout: while the socket lives the daemon always answers, and a silent link ends in the socket's own idle close. A line is never resent automatically. Return with an empty field sends Enter alone. With the active tab not live, Return keeps the text and says "Not connected"; nothing is queued. Return captures the tab when pressed and never retargets.

**One line only.** A paste into the line field that holds a line break is not inserted: it goes to the terminal as one paste, without Enter, with a short notice. Multiline text therefore takes the same route as any terminal paste.

**Ctrl and alt** in the key row arm a modifier for the next key, from the key row, the terminal input or the line field; tapping it again disarms it. The armed modifier applies to the next single character typed outside IME composition, or the next key-row key, and sends the chord (`C-c`, `M-b`) to the terminal, from the line field too, instead of inserting. A composition starting, or a multi-character insert (swipe typing, a prediction), disarms it and goes through unmodified. Locking is not built.

**The unsent line is a draft.** Each tab key has its own draft, so switching tabs swaps the field's text and Return can only send a line to the tab it was written for. The draft survives keyboard hide, blur, navigation and reload on the same device. Persistence is per stable target identity, bounded, and local only; no sync or upload before Return. Saving text is not encryption: browser-origin script can read it and browser storage can be cleared, evicted or unavailable. Show storage failure rather than silently promise persistence. Clear local data removes drafts. A closed tab's draft is kept and returns when that session is opened again. At most 32 drafts: past that, the least recently edited draft of a session with no open tab goes, and if every one belongs to an open tab a new draft is refused.

**The toggle's state** comes from focus, not geometry: in the browser, from `focusin` and `focusout` on the two inputs, so Safari's Done or ⌃ ⌄ keep it right; if the keyboard geometry drops while an input still holds focus, the input is blurred and the state is "down". It therefore still works with a hardware keyboard attached, which never raises the on-screen keyboard. In the browser, hardware keys reach the terminal only while an input is focused; the toggle focuses it.

**Keyboard visibility** is not focus alone: hardware keyboards and Safari chrome or zoom complicate `visualViewport` height. Use `visualViewport` resize and scroll with focus, exclude zoom changes, and verify on real iOS. Native reports keyboard geometry from the keyboard lifecycle. No guessed fixed keyboard height and no polling.

## Options and rejected shortcuts

- Rely on xterm's default desktop selection on iPhone: upstream issues and pinned implementation do not justify it.
- Simply add user-select:text to a WebGL canvas: doesn't create semantic text or native selectable ranges.
- Reconstruct wrap by row length: confuses full-width hard breaks with soft wraps; fails with Unicode/padding.
- Call clipboard.readText on every tap: conflicts with platform activation/permission model and user intent.
- Route line-field input events straight to the terminal while composing: breaks IME replacement, and the line field exists to edit before sending.
- A multiline draft editor with an Insert button that sends without Enter: replaced by the line field (Jimmy, 2026-10-24).
- Resize tmux on every keyboard frame: violates existing no-resize-on-keyboard contract, causes redraws and copy instability.

## Probe gates before implementation choice is final

| Question | Concrete checks |
| --- | --- |
| Logical copy | Long soft-wrapped command; exact-column hard break; multiple paragraphs; blank lines; indentation; CJK/emoji/combining cells; partial selection; tabs; ANSI/OSC text. Repeat after reconnect/snapshot, tab switch, resize, and history fetch. Compare clipboard plain text, not screenshot. |
| Selection vs click | Tap in mouse-aware app; tap in ordinary shell; press→hold (word highlighted before release)→release (handles and menu); press→hold→drag (selection extends); tap on and beside the cursor row with the keyboard down, and far from it; tap the terminal from the focused line with the keyboard up; press→scroll; pointer cancellation; long-press while output streams. No mouse event from a long-press, in mouse-mode apps too. |
| Paste | LF/CRLF and trailing newline, bracketed mode on/off, Unicode, control sequences, receiver app behavior; paste into the line field (single line, and with a line break) versus direct terminal. No duplicate wrapping; Enter only from Return. |
| Line field | Hide/show, background/foreground, reload, tab switch, storage denial/full, IME, dictation, replacement, multiline paste, Return into Claude Code, Codex, zsh and bash (the line arrives once and submits), captured target disappears, uncertain send acknowledgement. |
| Keyboard layout | iPhone Safari plus installed browser mode if used; portrait/landscape, address-bar changes, zoom, keyboard dismissal, hardware keyboard, native WKWebView. The compose box above the key row, the key row against the keyboard (or Safari's form accessory bar), and cursor pan without tmux resize. |
| Clipboard permissions | Real Copy/Paste menu, keyboard shortcuts and paste-control gesture; denied permission; image clipboard; copy after selection data fetch. |

Linux probes and desktop source reading cannot close the iPhone gates. Research is useful now because it narrows the architecture and identifies the wrap-data prerequisite before frontend code is built.
