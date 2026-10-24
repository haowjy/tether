# Touch, clipboard, and the line field: evidence-led direction

Status: research/design, not production implementation. This supplements browser-behaviors.md and supersedes any inference that a mockup proves real touch/clipboard behavior. Evidence: terminal-interaction-sources.md, terminal-interaction-probe.md, and the pinned-source study terminal-selection-source-research.md (completed pinned xterm 6.0.0 source study and isolated headless probe).

## Decisions supported now

### One gesture owner, not separate competing click handlers

A short tap becomes a remote mouse click only when the application has requested a supported mouse-reporting mode. Alternate-screen status alone is insufficient. With no app mouse mode, a terminal tap does nothing: it never focuses an input, never raises or lowers the keyboard, and never moves focus out of the line field. On a prompt's OSC 133 input row, the tap may move the cursor, only while the terminal input already owns the keyboard. On touch the dock's keyboard toggle is the one control that opens and closes the on-screen keyboard (below). Desktop click-to-focus is unchanged.

A long-press fires with a haptic. Held and dragged, it is an arrow pad: the drag's direction sends arrows, repeating while held. Released without moving, it selects the word under the finger and enters local selection, whose handles extend it. Drag far enough to extend past the word and the selection follows the finger; tether's edit menu offers Copy and Paste (Paste alone when released over a blank cell); Paste sends the clipboard to the terminal as one paste without Enter. Movement before the long-press fires is scrolling; pointercancel cancels pending input. (Jimmy, 2026-10-24: "long press -> release -> highlight word -> can drag it further", and Termius's hold, vibration, arrow motion pad.) There is no spacebar-trackpad mapping. Do not send remote mouse-down on initial touch: it would already affect the TUI before a later long-press is recognized. Send tap press/release only after the gesture resolves as a tap. Selection consumes its gestures; copying must never click the application or paste back into it.

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

On touch, the bottom of Terminal is a dock, always visible with the keyboard up or down and riding on top of the keyboard when it is up. At rest it is one row: the tab chip (which opens the session switcher), the line field and the keyboard toggle. While the keyboard is up, the key row sits above that row. The web draws it in the phone browser, the PWA and the native app; one implementation. Layout and sizes: [browser-behaviors.md](browser-behaviors.md#phone-dock).

**Two inputs own the keyboard, one at a time.** The *terminal input* sends each keystroke as typed, with autocorrect, capitalization and predictions off (the owned input in a browser, native's responder in the app). The *line field* is an ordinary one-line text field with the platform's editing: autocorrect, dictation, IME, replacement and its own paste menu. Auto-capitalization is off, since most lines are commands; dictation still capitalizes sentences on its own. Nothing typed in the line field reaches tmux until Return.

| Action | Keyboard down | Terminal input owns it | Line field owns it |
| --- | --- | --- | --- |
| Keyboard toggle | terminal input takes it; keyboard up | keyboard down | keyboard down |
| Tap the line field | line field takes it; keyboard up | line field takes it; keyboard stays up | caret moves (the field's own editing) |
| Tap the terminal | nothing to focus | nothing to focus | nothing to focus |
| Key-row control key (esc, ↑, ↓, ^R, ^C, tab) | key row hidden | sent to the terminal | sent to the terminal |
| Key-row character key (`\| ~ / -`) | key row hidden | sent to the terminal | inserted at the caret |

The toggle never switches between the two inputs: from the line field it lowers the keyboard, and the next toggle raises it for the terminal input. A tap on the line field is the field's own editing, not a second keyboard control.

**Focus cues** show which input has the keyboard. Terminal input: the terminal cursor is a solid block, the line field shows its placeholder, and the keyboard's Return key is the plain one. Line field: the caret is in the field, the terminal cursor is drawn as a hollow outline, and Return is the blue send key (`enterkeyhint="send"`). The key row is the same in both.

**Return** in the line field sends its text to the active tab and then Enter, and clears the field; the field keeps the keyboard for the next line. The text goes as one `paste` with `enter` (so a pane that asked for bracketed paste sees it delimited, with the Enter outside it); the daemon runs the Enter in the same tmux command group right after the paste, and tmux skips it if the paste fails. The daemon answers that paste exactly once, `pasted` or a refusal naming its `req` ([daemon-core.md](../daemon-core.md#53-json-messages)). A refusal puts the line back into that tab's draft, ahead of anything typed since, with the reason ("Not sent: …"); so does a socket drop before the answer, marked "May not have been sent". There is no client-side timeout: while the socket lives the daemon always answers, and a silent link ends in the socket's own idle close. A line is never resent automatically. Return with an empty field sends Enter alone. With the active tab not live, Return keeps the text and says "Not connected"; nothing is queued. Return captures the tab when pressed and never retargets.

**One line only.** A paste into the line field that holds a line break is not inserted: it goes to the terminal as one paste, without Enter, with a short notice. Multiline text therefore takes the same route as any terminal paste.

**Ctrl and alt** in the key row arm a modifier for the next key, from the key row, the terminal input or the line field; tapping it again disarms it. The armed modifier applies to the next single character typed outside IME composition, or the next key-row key, and sends the chord (`C-c`, `M-b`) to the terminal, from the line field too, instead of inserting. A composition starting, or a multi-character insert (swipe typing, a prediction), disarms it and goes through unmodified. Locking is not built.

**The unsent line is a draft.** Each tab key has its own draft, so switching tabs swaps the field's text and Return can only send a line to the tab it was written for. The draft survives keyboard hide, blur, navigation and reload on the same device. Persistence is per stable target identity, bounded, and local only; no sync or upload before Return. Saving text is not encryption: browser-origin script can read it and browser storage can be cleared, evicted or unavailable. Show storage failure rather than silently promise persistence. Clear local data removes drafts. A closed tab's draft is kept and returns when that window is opened again. At most 32 drafts: past that, the least recently edited draft of a window with no open tab goes, and if every one belongs to an open tab a new draft is refused.

**The toggle's state** comes from focus, not geometry: in the browser, from `focusin` and `focusout` on the two inputs, so Safari's Done or ⌃ ⌄ keep it right; if the keyboard geometry drops while an input still holds focus, the input is blurred and the state is "down". It therefore still works with a hardware keyboard attached, which never raises the on-screen keyboard. In the browser, hardware keys reach the terminal only while an input is focused; the toggle focuses it.

**Keyboard visibility** is not focus alone: hardware keyboards and Safari chrome or zoom complicate `visualViewport` height. Use `visualViewport` resize and scroll with focus, exclude zoom changes, and verify on real iOS. Native reports keyboard geometry from the keyboard lifecycle. No guessed fixed keyboard height and no polling.

## Options and rejected shortcuts

- Rely on xterm's default desktop selection on iPhone: upstream issues and pinned implementation do not justify it.
- Simply add user-select:text to a WebGL canvas: doesn't create semantic text or native selectable ranges.
- Reconstruct wrap by row length: confuses full-width hard breaks with soft wraps; fails with Unicode/padding.
- Call clipboard.readText on every tap: conflicts with platform activation/permission model and user intent.
- Route line-field input events straight to the terminal while composing: breaks IME replacement, and the line field exists to edit before sending.
- A multiline draft editor with an Insert button that sends without Enter: replaced by the line field (Jimmy, 2026-10-24).
- Tapping the terminal to raise the keyboard: a tap meant to scroll, select or click would also open the keyboard; Termius keeps a single toggle.
- Resize tmux on every keyboard frame: violates existing no-resize-on-keyboard contract, causes redraws and copy instability.

## Probe gates before implementation choice is final

| Question | Concrete checks |
| --- | --- |
| Logical copy | Long soft-wrapped command; exact-column hard break; multiple paragraphs; blank lines; indentation; CJK/emoji/combining cells; partial selection; tabs; ANSI/OSC text. Repeat after reconnect/snapshot, tab switch, resize, and history fetch. Compare clipboard plain text, not screenshot. |
| Selection vs click | Tap in mouse-aware app; tap in ordinary shell; press→hold→release (word selected); press→hold→drag (arrow pad, repeats, stops on release); press→scroll; pointer cancellation; long-press while output streams. No mouse event from a long-press, in mouse-mode apps too. |
| Paste | LF/CRLF and trailing newline, bracketed mode on/off, Unicode, control sequences, receiver app behavior; paste into the line field (single line, and with a line break) versus direct terminal. No duplicate wrapping; Enter only from Return. |
| Line field | Hide/show, background/foreground, reload, tab switch, storage denial/full, IME, dictation, replacement, multiline paste, Return into Claude Code, Codex, zsh and bash (the line arrives once and submits), captured target disappears, uncertain send acknowledgement. |
| Keyboard layout | iPhone Safari plus installed browser mode if used; portrait/landscape, address-bar changes, zoom, keyboard dismissal, hardware keyboard, native WKWebView. The dock riding on the keyboard, Safari's form accessory bar above it, and cursor pan without tmux resize. |
| Clipboard permissions | Real Copy/Paste menu, keyboard shortcuts and paste-control gesture; denied permission; image clipboard; copy after selection data fetch. |

Linux probes and desktop source reading cannot close the iPhone gates. Research is useful now because it narrows the architecture and identifies the wrap-data prerequisite before frontend code is built.
