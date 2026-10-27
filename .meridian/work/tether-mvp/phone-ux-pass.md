# Phone UI/UX pass (2026-10-27)

Jimmy goes through the installed app (build f4b4b6d) and reports issues; once the list is in,
the lead proposes one cohesive design rather than point fixes.

## Issues (verbatim, then the lead's reading)

### 1. Dark mode

> "i kinda want dark mode lol... (we should have a light and dark mode), dark mode would be
> classic terminal I htink"

Reading: both themes already exist, but tether only follows the iPhone's system appearance
(ios WebShellController.swift:542 sends `traitCollection.userInterfaceStyle`; tokens use
`light-dark()` in web/ui/tokens/semantic.css). No in-app choice. Today's dark terminal is
blue-tinted (`--color-bg-sunken` dark = oklch(0.15 0.012 266)), not "classic terminal".
Wants: (a) an in-app choice, presumably System / Light / Dark; (b) dark should look like a
classic terminal (near-black, neutral, probably the chrome too, not only the terminal pane).
Open: is his phone in light mode (so he's never seen dark)? Does "classic" mean pure black /
green-on-black, or just a neutral near-black like iTerm/Terminal.app defaults?

### 2. Bottom bar misaligned (screenshot A: 9:16, keyboard down)

> "the bottom bar is a bit misaligned..."

Reading (guess, asked): keyboard down, the dock row (chip, field, keyboard icon) floats with a
~45pt blank band under it above the home indicator, so it looks lifted rather than seated.
Could also mean the three controls' heights/baselines differ (chip vs field vs icon).
The grey "<" tab top-right is a system video-player control, not tether: ignore.

### 3. Quick way to Home / files

> "we should have a button to go back "home" right hwere quickly to access the files... or
> maybe there should be a "swap to files..."?"

Reading: from the terminal, one tap to Home (where the file browser lives), or a direct
terminal<->files swap for the same folder. Today Home is reached through the chip's switcher.

### 4. The box always shows a blinking caret

> "the "Type or dicate" - this one ALWAYS has a cursor flashing..."

Reading: the box draws a caret even when typing goes to the terminal, so you can't tell
where your keys go. In 02-dock-keyboard-up.png the box shows a caret AND the terminal shows
a block cursor at the same time. Two cursors = focus is not legible.

### 5. Can't leave the box without closing the keyboard

> "if i type in the box / swap focus to the box, can't escape that focus unless I close the
> keyboard... i should be able to escape the focus of the textbox to go the "regular"
> keyboard mode"

Reading: with the keyboard up, there must be a way to move typing from the box back to the
terminal without dropping the keyboard.

### 6. Tapping the terminal's input should take focus (screenshot B: 9:19, keyboard up)

> "tapping in the terminal's claude box should change focus to THAT."

Reading: with the keyboard up and the box focused, a tap on the terminal's prompt (Claude
Code's `>` input) switches typing to the terminal. Today the near-cursor tap only *opens*
the keyboard when it's down; with it up, taps do nothing to the target. 5 and 6 are the same
need: the terminal must be tappable as a focus target.

### 7. Blank gap between dock and keyboard; key row placement

> "there's still a random blank space gap for the keyboard and eveything... (tbh,
> thatswhere the esc etc stuff to go, we should swap that ath teh type dictate I think...?"

Reading: in screenshot B there's a ~45pt empty band between the dock and the top
of the keyboard (same size as the band under the dock in screenshot A, so
likely the same cause: a reserved bottom inset counted twice, e.g. safe-area bottom or an
accessory height). He wants the gap gone and the key row seated directly on the keyboard,
with the chip/box row above it (swap the two rows), so the keys are nearest the thumbs.

### 8. Sessions sheet: Jimmy's proposal (phone-ux-pass/08-sessions-sheet-today.png, 10-sessions-proposal-sketch.png)

> "tabs should be on the bottom, and should probably be bigger and scroll more easily. they
> should not ALL show the x button, only the currently focused one should show it, and
> swapping, just swaps them in the background (and u can see that because the thing is
> halfway). it should not close once u select seomething) ... the + add tab... I guess that
> one can open up the bigger one...? idk, i put the list of all session in this mockup as
> well in the same screen... honestly idk..."

Today (08): full-height sheet; tab pills at the top, each with ×; "Windows in a1 / New window";
host session list as full-width rows; search + New session pinned at the bottom; picking
anything closes the sheet.

Sketch (10), lead's reading:
- Sheet is half height, so the terminal stays visible above it.
- Tabs move to the bottom edge of the sheet (thumb zone): large, horizontally scrolling, the
  next tab peeking. Only the active tab shows ×. A `+` sits at the right end.
- Tapping a tab switches the terminal behind the sheet live; the sheet stays open.
- Left frame adds, above the tabs: grab handle, Home button + "Find a session" search, and the
  host's sessions as a 2-column grid of tiles.
- Unsettled in his own words: what `+` does (new session, or expand to the bigger list), and
  whether the session list belongs in the same sheet.
Not in the sketch: windows of the current session ("Windows in a1", New window).

Answers (round 1 on issue 8):
1. Left and right frames are the same sheet; the right one is just drawn empty. So one
   half-height sheet: handle, Home + search, session list, tab strip at the bottom with `+`.
2. Windows behind a second tap on the active tab: "yeah, i think thats fine." On the grid:
   "idk about the 2 column thing..." -> open; compare grid vs list in mockups.
3. "yeah, replace that dock chip i think" -> the dock's chip becomes the tab strip
   (Safari-style bottom bar: swipe sideways to switch). The sheet is then for find/create.
   Shape to be settled in the cohesive design.

### 9. Home's session list vs the sheet

> "the main sessions list should probably also look like this (from home...?) or maybe it
> should be completely different...?"

Today: Home (web/screens/home/Home.tsx) = header (tether + host), OpenTabs, "Find a session",
HostSessionLists (the same SessionList component the switcher uses), Settings row, and a
phone bottom nav Sessions | Files. So the list is already shared; the surfaces around it differ.
Lead's proposal put to Jimmy: one surface with detents. The sessions sheet at half height is
the switcher; dragged to full height it IS Home (sessions + files), terminal behind. With no
tab open, it sits at full height. Alternative: Home stays its own screen, sharing only the
row/search components. Open.

### 10. Files: "speaks a different version" (FIXED dd22280 [was e3bc335 before rebase], installed on the iPhone)

Cause: the app's file proxy only opened for a server after `/auth/info` went through it,
which never happened in the app (native checks only at enrolment; the web's token lane
skips it). pop-os reports protocol 2-2 and the app speaks 2: no real mismatch. Fix: native
checks `/auth/info` on a host's first proxied request. Spec + decision amended. Also
explains any dead suggestion strip in the app. Device-unverified until Jimmy opens Files.

### 11. Home: complete rework

> "home definitely needs a complete rework... maybe it should be [all sessions - mark the
> ones that are open] [open terminals] [files] [settings] ? or maybe... we have "file
> viewer as just one of the "tabs" that can get opened...? (and stay open, make sure to
> save which one is open locally, also reminder we aren't WATCHING anything, we just
> refresh when we need to" ... "or maybe periodic refresh is fine"

Two shapes on the table:
A. Home = sections: all sessions (open ones marked), open terminals, files, settings.
B. Files is a tab like a terminal tab: opens from +, stays open, which folder is open is
   saved locally. Then Home shrinks to: sessions (open marked) + settings.
Refresh: today only the on-screen tab is watched; listings refetch on open/pull and on the
daemon's small `sessionsChanged` push. Jimmy is fine with periodic refresh; the lead
prefers keeping the push (fewer bytes than polling on a weak link). To confirm.

### 12. Home = servers + settings; Face ID optional

> "maybe "home" is a place to "manage servers"? + other settings (like theme color etc) and
> "use face id; face id is annoying...)"

Reading: sessions leave Home entirely (they live in the sessions sheet / tab strip); Home
becomes the app's own place: servers (status, add, pair, remove), appearance, Face ID, local
data. Settings as a separate screen disappears.
Face ID today (auth.md ~978-1026): tokens sit in a Keychain item with `.biometryCurrentSet`;
the app relocks after >5 min in the background. Making it optional changes the threat model
(auth.md:51: someone holding the unlocked phone). Options put to Jimmy: off (phone passcode
only), or keep it but relock less often (1 h, or only after restart). Turning it off means
re-saving the tokens without biometry (one last Face ID read). Security call: Jimmy's.

Answer: "3" -> SETTLED (Jimmy, 2026-10-27): Face ID stays; a Home setting picks when the app
relocks after time in the background: 5 min / 1 h / never; default 1 h (lead's proposal,
accepted with the option). "Never" = unlock once per launch. Needs auth.md + decisions.md
update when built (today: fixed 5 min).

