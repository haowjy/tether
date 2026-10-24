# Update the repo mockup to the chosen phone dock (one row at rest) and the switcher sheet

Edit `docs/design/client/mockups/index.html` in place (a single self-contained file, minified-style
CSS/JS; keep that style). This is a design mockup, not production code: fictional data, no network.
Edit nothing else. Do not commit. Do not touch `web/`.

## What it shows today
The phone (mobile / iPhone) Terminal ends in a three-row dock: a tab row (back, tab pills, +),
a line-field row (`#line` input + Paste chip), and a key row (esc ↑ ↓ ^R ^C tab ctrl alt | ~ / -,
scrolling) with the keyboard toggle pinned right; a mock "keyboard" placeholder appears when the
toggle is on. Functions of interest: `tools`, `dock`, `keyboard`, `setKeyboard`, `sendLine`,
`bindDock`, `openSheet`, `sessionList`, `rows`, `homeSessions`. The desktop layout must not change.

## What it must show (Jimmy's settled choice, "variant 2: one row at rest")
1. **Keyboard down:** ONE dock row: tab chip · line field · keyboard toggle.
   - Tab chip: the active tab's name (window name, truncating) plus a small count of open tabs
     (e.g. `agent  3`). No middle dots anywhere (repo copy rule). Tapping it opens the switcher sheet.
   - Line field: placeholder "Type or dictate a line", font-size 16px (Safari zooms below 16),
     `enterkeyhint="send"`, `autocapitalize="off"`, autocorrect/spellcheck on.
   - Keyboard toggle at the right: label/aria "Show keyboard" / "Hide keyboard".
   - No back arrow, no tab pills, no + and no Paste button in the dock.
   - The dock adds the bottom safe area only while the keyboard is down.
2. **Keyboard up:** the fixed key row (esc ↑ ↓ ^R ^C tab ctrl alt | ~ / -, horizontally scrolling)
   appears ABOVE that same bottom row; the toggle stays at the right end of the bottom row. Then the
   placeholder keyboard below.
3. **Sizes:** row items 34px tall, keys 32px tall, small controls ~30px-class; compact, not
   Termius copies. Keep 2px focus rings.
4. **Two openers, one closer, with focus cues:**
   - Toggle with keyboard down → keyboard up for the TERMINAL: terminal shows a SOLID block cursor,
     the line field shows its placeholder, the mock keyboard's return key is plain "return".
   - Tap the line field → keyboard up for the FIELD: caret in the field, the terminal cursor becomes
     a HOLLOW outline block, and the mock keyboard's return key becomes a blue "send" key.
   - Toggle while either has the keyboard → keyboard down. Terminal taps change nothing.
   - Key-row control keys (esc ↑ ↓ ^R ^C tab) always go to the terminal (append a visible echo like
     today); `| ~ / -` insert into the field when the field has focus, else go to the terminal;
     ctrl/alt arm (shown pressed) for the next key. A key tap must not move focus
     (preventDefault on pointerdown/mousedown).
   - Return in the field "sends" the line to the active tab (echo it in the mock terminal), clears
     the field, keeps the keyboard. Drafts stay per tab as today.
5. **Switcher sheet** (replaces the tab row, + and the old phone picker sheet; desktop's centred
   picker modal stays as it is). A tall rounded bottom sheet over the terminal, theme raised surface:
   - Header: title "Sessions" with a Home button (house icon + "Home", returns to Home and keeps tabs)
     and a close icon.
   - Top: open tabs as pills (scrolling/wrapping), the active one marked; one tap switches to that
     tab and closes the sheet; each pill has a small close (×) that closes only that tether tab.
   - Then every tmux session on the host as Home's accordion groups ("N windows"), windows
     indented as "index: name", trailing text labels "here" (the active tab's window) and "open"
     (open in another tab). No dots. Tapping a window opens or activates its tab and closes the
     sheet. The session holding the active tab starts expanded; others collapsed.
   - BOTTOM of the sheet, in thumb reach: a search field ("Find a session", NOT auto-focused,
     filters sessions/windows like Home's search) and a "+ New session" button beside it that opens
     the existing create dialog.
   - Opening the sheet lowers the mock keyboard.
6. Landscape is the same model; if the mockup has no landscape mode, don't add one.
7. Update the annotation text that describes the dock to match the above.

## Done looks like
Open the file in headless WebKit or Chromium (agent-browser skill, or playwright via
`pnpm --dir web exec playwright` if available; TMPDIR=/tmp/tether-meridian-501), switch to the
phone/iPhone preview, and verify with screenshots: keyboard down (one row), keyboard up for terminal
(solid cursor, plain return), keyboard up for field (hollow cursor, blue send), ctrl armed, the
switcher sheet (pills on top, sessions, search + New session at bottom), switching a tab via a pill,
and the desktop view unchanged. Zero console errors. Save screenshots under
/tmp/tether-meridian-501/mockshot-v2/ and list them in your report with what each shows.
