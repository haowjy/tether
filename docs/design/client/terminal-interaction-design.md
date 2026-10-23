# Touch, clipboard, and local compose: evidence-led direction

Status: research/design, not production implementation. This supplements browser-behaviors.md and supersedes any inference that a mockup proves real touch/clipboard behavior. Evidence: terminal-interaction-sources.md, terminal-interaction-probe.md, and the pinned-source study terminal-selection-source-research.md (completed pinned xterm 6.0.0 source study and isolated headless probe).

## Decisions supported now

### One gesture owner, not separate competing click handlers

A short tap may become a remote mouse click only when the application has requested a supported mouse-reporting mode. Alternate-screen status alone is insufficient. With no app mouse mode, tapping can focus input; it must not pretend arbitrary output is a text editor. Existing prompt-only cursor placement is a separate, narrowly validated action.

Long-press enters local selection; movement crosses into scrolling or selection-handle drag; pointercancel cancels pending input. Do not send remote mouse-down on initial touch: it would already affect the TUI before a later long-press is recognized. Send tap press/release only after the gesture resolves as a tap. Selection consumes its gestures; copying must never click the application or paste back into it.

The browser adapter must declare pan ownership with touch-action before gestures and handle pointer cancellation, not fight the browser with blanket preventDefault. Coordinate conversion uses actual terminal-cell metrics, visual viewport offsets, panning transform, buffer position, and pane identity. Do not derive cell coordinates from guessed font size. Native/web adapters feed the same semantic interaction intents, with one focus owner per environment.

Provisional gesture arbitration needs a device prototype: long-press priority and native selection initiation cannot be validated from desktop synthetic mouse events. Avoid promising double-tap word selection on the live TUI until it is proven not to send an unwanted first click. Word/line gestures inside selection mode are safer to evaluate first.

### Copy logical terminal text, not screen-shaped HTML

Soft wraps are not line breaks. Explicit hard breaks and blank lines remain; partial selections include only their endpoints. Indentation must survive. Terminal grid copy is not a byte-for-byte reconstruction of the program's original file (tabs may already have been expanded by terminal rendering).

Use supported xterm selection/text APIs when their underlying wrap metadata is authoritative. For mobile native handles, prototype an on-demand selectable DOM/text representation backed by a bounded immutable selection snapshot, using the same logical-line serialization. Do not scrape canvas pixels, insert BR at every displayed row, or use an unrelated innerText serializer. Render untrusted terminal content as text, not HTML.

New output continues while local selection stays anchored to its snapshot. Snapshot memory exists only while selecting, with a cap; dismiss frees it. This must not create a second always-running terminal emulator or retain unbounded history for inactive panes.

**Wrap prerequisite resolved by L3:** the daemon now pairs physical `-N -T` rows with `-J` logical rows in the same command group, then replays only unambiguous continuations into xterm's `isWrapped` state. History chunks carry a separate bitmap and the history driver joins those rows for copy. This fixes the data boundary after reconnect, snapshot, and history fetch; it does not implement the mobile selection UI or prove real-device clipboard behavior. Full-width rows are not evidence of wrapping: a hard newline can occur at the exact same column.

### Paste uses one path and the receiving app's mode

Clipboard text and compose insertion use the existing paste request → private temp file → tmux load-buffer/paste-buffer -p route. Do not convert each newline into an independent key event and do not add a trailing Enter. Avoid double-wrapping bracketed paste in both browser and tmux. Pane-side mode is authoritative; reconstructed frontend mode may be incomplete after snapshot.

Observed on tmux 3.4: LF becomes CR inside the terminal paste stream; bracketed markers are present only when the pane app enabled them. Clipboard trailing newline remains a trailing newline. Consequently, embedded newlines can execute commands when bracketed paste is absent or mishandled; “no extra Enter” is not a safety guarantee.

Use real user paste/copy events and text/plain. A user-driven Copy action may call clipboard write within the gesture, with explicit failure feedback; do not await a slow server read and assume Safari will retain activation. Have bounded selection data ready before Copy. Synthetic ClipboardEvents do not establish clipboard permissions or actual paste behavior. Image paste stays the existing upload/path route, separate from plain text.

### Local multiline compose field, while software keyboard is open

This is a normal local editor, not a custom keyboard. Browser uses textarea native editing; app uses native multiline text input. Let the platform perform selection, replacement, autocorrect, dictation, IME, and paste in the draft. Handle settled input/composition events, not just keydown. Enter in the draft creates a newline; nothing reaches tmux until Insert is explicitly tapped.

Use one explicit focus owner: terminal input, local draft, selection UI, or hidden. Focusing draft must stop routing its input to the terminal. Direct terminal input remains separate. Insert captures the target host/server/window and text revision; sends one paste, without Enter; must not retarget after a tab switch/reconnect. UI should not claim insertion succeeded until accepted; never retry uncertain delivery automatically.

Draft survives keyboard hide, blur, navigation, and reload on the same device. Persistence is per stable target identity, bounded, and local only; no sync/upload before Insert. Saving text is not encryption: browser-origin script can read it and browser storage can be cleared/evicted or unavailable. Show storage failure rather than silently promise persistence. Sensitive drafts must be clearable. A closed tab's draft is kept and returns when that window is opened again, at most 32 drafts, oldest evicted first.

Keep the draft after insertion unless user clears it; this preserves the requested local text and allows correction, but insertion must be deliberate to avoid accidental duplicate submission. This retain-after-insert choice is a proposal to confirm with the compose mockup.

Hide the compose surface when the on-screen keyboard closes without deleting draft. Browser focus alone does not prove keyboard visibility; hardware keyboards and Safari chrome/zoom complicate visualViewport height. Use visualViewport resize/scroll and focus together, exclude zoom changes, and verify on real iOS. Native uses UIKeyboardLayoutGuide/keyboard lifecycle. No guessed fixed keyboard height and no polling.

## Options and rejected shortcuts

- Rely on xterm's default desktop selection on iPhone: upstream issues and pinned implementation do not justify it.
- Simply add user-select:text to a WebGL canvas: doesn't create semantic text or native selectable ranges.
- Reconstruct wrap by row length: confuses full-width hard breaks with soft wraps; fails with Unicode/padding.
- Call clipboard.readText on every tap: conflicts with platform activation/permission model and user intent.
- Route textarea input events straight to terminal while composing: violates local draft semantics and IME replacement.
- Resize tmux on every keyboard frame: violates existing no-resize-on-keyboard contract, causes redraws and copy instability.

## Probe gates before implementation choice is final

| Question | Concrete checks |
| --- | --- |
| Logical copy | Long soft-wrapped command; exact-column hard break; multiple paragraphs; blank lines; indentation; CJK/emoji/combining cells; partial selection; tabs; ANSI/OSC text. Repeat after reconnect/snapshot, tab switch, resize, and history fetch. Compare clipboard plain text, not screenshot. |
| Selection vs click | Tap in mouse-aware app; tap in ordinary shell; press→hold; press→scroll; pointer cancellation; long-press while output streams. No unintended mouse events while selecting. |
| Paste | LF/CRLF and trailing newline, bracketed mode on/off, Unicode, control sequences, receiver app behavior; type/paste into draft versus direct terminal. No duplicate wrapping or auto-Enter. |
| Local draft | Hide/show, background/foreground, reload, tab switch, storage denial/full, IME, dictation, replacement, multiline paste, captured target disappears, uncertain send acknowledgement. |
| Keyboard layout | iPhone Safari plus installed browser mode if used; portrait/landscape, address-bar changes, zoom, keyboard dismissal, hardware keyboard, native WKWebView. Actual compose visibility and cursor pan without tmux resize. |
| Clipboard permissions | Real Copy/Paste menu, keyboard shortcuts and paste-control gesture; denied permission; image clipboard; copy after selection data fetch. |

Linux probes and desktop source reading cannot close the iPhone gates. Research is useful now because it narrows the architecture and identifies the wrap-data prerequisite before frontend code is built.
