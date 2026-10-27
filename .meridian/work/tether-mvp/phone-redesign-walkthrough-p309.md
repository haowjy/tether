# Report

# The tether redesign mockups, walked through as Jimmy

I read every board's source (`canvas.json`, all `*.dc.html` files, with the props applied), `phone-ux-pass.md` and `phone-redesign-brief.md`, then did the eight tasks as Jimmy. I edited no files. The list is ordered by how badly each problem would hurt in daily use.

## Blocking: I'd hit these in the first five minutes

**1. Once the keyboard is up, I can't tell which session my keys go to, and I can't switch.**
- **Boards:** App · keyboard up, typing to tmux; App · keyboard up, composing a line; Dark · keyboard up; Safari · keyboard up (form bar).
- **What I tried:** answer agent b1's question, then switch to a1 and answer there.
- **What went wrong:** the brief hides the tab strip when the keyboard is up. Nothing on screen names the session I'm typing into. With ten Claude sessions that all look alike, the cursor shows which part of the screen gets my keys (terminal or box), but not which session. Switching means dropping the keyboard, tapping a tab, and raising the keyboard again.
- **Expected:** the active tab's name somewhere in the compose row or key row. Ideally also a way to switch sessions without dropping the keyboard, such as swiping the key row or a compact tab pill.

**2. While I'm composing, I don't know where the key row's keys go. One wrong guess interrupts my agent.**
- **Boards:** App · keyboard up, composing a line.
- **What I tried:** dictated a long line into the box, then hit `esc` to back out of the box (as you would in most text fields) and `←` to fix a word.
- **What went wrong:** the key row (esc ← ↑ ↓ → ^R ^C tab ctrl alt) is identical in both modes. If `esc` or `^C` go to tmux while the box has focus, I've just interrupted Claude mid-run. If they go to the box, how do I send esc to tmux?
- **Expected:** say what each key does per mode. Either the key row always goes to tmux and the box loses focus first (visible), or arrows edit the box and esc/^C are greyed or retargeted.
- Also unanswered:
  - After Send, does focus stay in the box or go back to tmux?
  - Can a composed line contain a newline? Claude Code accepts multi-line input.
  - If I dictate while typing goes straight to tmux, iOS revises dictated text as it goes. Does tmux get those corrections as backspace noise?

**3. Nothing on any phone board says whether I'm connected, or which agent needs me.**
- **Boards:** every terminal board (App, Dark, Safari), App · sessions sheet (list), App · Home, two servers.
- **What I tried:** opened the app cold after a day away to get back to the agent I was watching. Also took the train.
- **What went wrong:**
  - **Connection:** no reconnecting, stale, or offline state appears on any terminal board. On a weak link, that is the main thing I need to know before typing.
  - **Attention:** tabs, sheet rows and Home cards show only name, command and window count. Every agent's command is `claude`, so nothing says "b1 is waiting on you" or "a3 has new output since you looked".
  - **Tasks 1 and 3:** both depend on this, and the launch rule ("reopen the last tab") isn't shown on any board.
- **Expected:**
  - A small connection indicator on the terminal. It can be invisible while live.
  - An activity or bell dot on tabs and session rows.
  - A board for "cold open → reconnecting → last tab".

**4. The tab strip's gestures contradict each other.**
- **Boards:** App · terminal, keyboard down; App · sessions sheet (list); App · active tab tapped: its windows.
- **What went wrong:**
  - The brief says the strip scrolls sideways (next tab peeks) and also that "swipe sideways switches". A swipe can't do both: does it scroll the strip or change the terminal?
  - Tapping the active tab opens the sheet (Main's aria-label). The same tap inside the sheet opens the windows list (Sheet's aria-label). So one gesture does two things depending on hidden state.
  - The × sits against the active tab's label, and the active tab is the one I tap most. One mis-tap closes it.
  - Nothing tells me whether × closes the tab or kills the tmux session. I'd hesitate every time.
- **Expected:**
  - Pick one meaning for a horizontal swipe on the strip.
  - Give the windows list its own target, or a long-press.
  - Spell out "Close tab (session keeps running)", or move close into the sheet.

## Contradictions between boards, and between boards and the brief

**5. The Mermaid diagram contradicts Round 4.** Files · Markdown preview captions its diagram "Mermaid diagram: planned for v2, not built yet". Round 4 moved Mermaid into this redesign's scope. Task 5 (read a doc with a diagram) is exactly this case. Also missing: can I pinch or pan a wide diagram, and do relative links like `docs/setup.md` open in the preview?

**6. "All 9 sessions" from Home brings back the tab strip that Round 3 removed.** From Home · All 9 sessions (full height) renders the Sheet base unchanged:
- a terminal and scrim behind it, even though I came from Home;
- the bottom tab strip with a1 active, which Round 3 removed from Home because it duplicated the open-tabs rows;
- a Home button at the top, even though I'm already coming from Home.

What does Home do there: is it Back? Expected: a full-height list with a back control and no strip, or say plainly that it's the same sheet.

**7. Home in Safari is identical to Home in the app.** `Home.dc.html` never reads `surface`, so Safari · Home renders the app's Home:
- no Safari toolbar, unlike Safari · terminal;
- no "Add to Home Screen". The brief promises it on Safari Home; it now sits only in an unboarded Safari variant of Settings.

The Safari row has no Settings, sheet or Files board. The row is titled "Safari / PWA", but every board shows browser Safari; installed PWA mode (no toolbar, possibly no form bar) never appears.

**8. In Safari, the key row isn't seated on the keyboard, which reintroduces issue 7.** Safari · keyboard up puts the 44pt ⌃ ⌄ Done form bar between the key row and the keyboard. That is the gap I complained about in issue 7. With the keyboard down, the tab strip (~86pt) sits above Safari's toolbar (84pt), so about 170pt of chrome at the bottom. Could ⌃ ⌄ be what swaps focus between box and terminal? If so, say it; if not, what do they do?

**9. Desktop disagrees with the phone and with the brief.**
- **Windows:** no board shows a session's windows or New window on desktop. On the phone they're a second tap on the active tab.
- **Going up a folder:** a ‹ button in the path bar, while the phone uses a "‹ parent" row (Round 4).
- **Home's title:** "Servers" on desktop, "tether" on the phone.
- **Server indicator:** the top-row "pop-os live" is a single label. With tabs from two servers, which one does it describe?
- **Missing boards:** no desktop file preview, so no desktop Mermaid either.
- **Stale brief:** it says "Desktop Home still the old settings-style column", but Desktop · Home: your servers already shows server cards. The brief's board counts are also stale (app light is 13 boards, not 9).

## Missing flows

**10. "+" and "New session" stop halfway.**
- From the terminal's bottom bar, does + open the sheet or the small menu? App · + : new session or files only shows it over the sheet.
- No board shows the New session form. What do I name it? Which server, with two? Which starting folder?
- Browse files: which server, which folder?
- Tapping a session that isn't open (App · sessions sheet (list)): does it add a tab, replace the current one, or close the sheet? Issue 8 said the sheet stays open when switching tabs; rows aren't covered.

**11. With two servers, I can't tell their tabs apart.**
- Tabs only show "a1 python". If both servers have a session called `dev`, they're indistinguishable.
- The files tab shows only "tether", with no server.
- App · sessions from two servers shows pop-os as "9 sessions · 3 open" but lists only 4 rows, with no "show all".
- Task 6 is unboarded: what does a tab on an offline server look like? What does the sheet's group for an offline server look like?

**12. Nowhere to manage servers.** Issue 12 said Home manages servers (add, pair, remove). Neither Home nor Settings has remove, rename or re-pair, so a server I retired would sit on Home as "offline" forever.

**13. Fresh install leaves gaps.** App · Home, no servers yet says "enter the code here", but there's no code field, only an "Add server" button. No board shows the next screen, or enrolment from Safari or the desktop.

**14. Getting back from Home is unclear.**
- Home has no back control. I return by tapping an open-tab row, and nothing marks which tab I came from.
- "Open in tabs" lists only terminal tabs. If a Files tab is open, does it appear?

## Costs space or clarity

**15. The idle "Compose a line…" box takes a whole 60pt row while I'm typing straight into tmux** (App · keyboard up, typing to tmux). About 110pt sits above a 300pt keyboard. Could the idle box shrink to a button in the key row?

**16. The key row doesn't fit.** Ten keys at min 40px plus gaps and padding is about 474px on a 390px screen, so `alt` is clipped with no hint that the row scrolls. Missing keys I'd use with Claude Code: shift-tab (permission mode) and Enter. ctrl and alt need a visible latched state.

**17. Files needs a few more pieces for task 5.**
- No search or recent files, so finding a design doc means browsing `docs/` → `design/`.
- The preview's tab bar has no × and no + (Files · Markdown preview), unlike every other bar.
- If I go to a terminal and come back, does the Files tab reopen the file or the folder?
- "Open this folder" from a terminal tab (Round 4) isn't on any board.

**18. Face ID "Never" isn't never.** App · Settings says "Never: Face ID once each time the app starts." That's "only at launch"; label it that. Reaching it takes four taps from the terminal (tab → Home → gear → Face ID). That's fine for a rare setting, but say so.

**19. The dark row is thin.** Only terminal, keyboard up, sheet and Home are drawn dark; Files, preview and Settings aren't. The cursor in dark is the blue accent; a "classic terminal" cursor is usually white or grey.

**20. One icon means two things.** The ">_" icon means "type in the terminal" in the compose row and "New session…" in the + menu.

**21. Catching up after being away isn't covered.** Getting back to an agent means reading what it did while I was away. No board shows scrollback or copy, though this may be out of this pass's scope.

## What the brief promises and no board shows
- Mermaid rendering (the preview contradicts it).
- Add to Home Screen on Safari, Safari Settings, and the PWA surface.
- Removing or re-pairing a server.
- The launch rule (reopen last tab).
- "Open this folder" from a terminal.
- Swipe back in Files.
- The sheet's server grouping when one server is offline.
