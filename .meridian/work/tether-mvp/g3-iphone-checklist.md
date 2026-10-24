# G3 real-iPhone checklist: phone dock (P3a)

Run in Safari and again in the installed PWA, on the dev box's tether over Tailscale. Use a
scratch tmux session with two windows, not your own. Portrait first, then landscape.

1. **Toggle.** Dock at rest shows one row: chip, line field, keyboard icon; no key row. Tap the
   icon: keyboard rises on the first tap, key row appears, icon becomes "hide". Tap it again: keyboard
   drops. Tap the line field: keyboard rises for the field. Tap the icon: it drops.
2. **Terminal taps.** With the keyboard up (either input) and down, tap the terminal: nothing
   changes. Key-row taps never lower the keyboard.
3. **Focus cues.** Terminal input: solid block cursor, plain Return key. Line field: hollow cursor,
   blue send key.
4. **Safari's Done and arrows.** Done lowers the keyboard and the icon follows; one icon tap
   raises it again. The form bar's up/down arrows never land in a hidden input.
5. **Dock position.** Dock sits directly on Safari's form bar: no gap, no overlap, follows the
   animation, stays put while Safari's toolbars collapse. The prompt row stays visible above the key row.
   `tmux display -p '#{window_height}'` is unchanged with the keyboard up and down.
6. **Rotate with the keyboard up.** Rows unchanged, dock still on the bar, cursor row visible.
7. **Hardware keyboard.** Attach one: the resting row sits above iOS's short shortcut bar; Ctrl+C
   reaches tmux as ^C; no doubled characters.
8. **Typing into the terminal (owned input).** English with autocorrect on, double-space period,
   Backspace held, Backspace with nothing typed, emoji, Chinese and Korean IMEs, dictation.
9. **Line field.** Dictate a line, press the blue Return: `echo hi` runs once. Autocapitalization
   off. Zoom: focusing it does not zoom the page. Paste a multi-line text: it goes to the terminal
   unsent with a notice.
10. **Return into agents.** In Claude Code and Codex, send a line from the field: it submits once.
11. **Drafts.** Type in the field, switch tab, type another; switch back (draft returns); reload
    (draft returns); airplane mode: Return says "Not connected" and keeps the text.
12. **Key row.** Each key reaches tmux (esc, arrows repeat while held, ^R, ^C, tab, ctrl then a
    letter, alt then a letter, | ~ / -). Character keys insert at the caret when the field has the keyboard.
13. **Switcher.** Chip opens the sheet without raising the keyboard; the keyboard that was up
    returns when a pill, a window row, the close icon or the backdrop is tapped, and stays down after the
    back gesture. Pills switch and close; windows say "here"/"open"; search at the bottom stays above the
    keyboard (also in landscape); New session creates and opens it; Home returns Home with tabs kept.
14. **Keyboard vs. Safari scroll and zoom.** With the line field focused and the keyboard up, make
    Safari scroll the page (focus the field near the bottom, drag the page): the keyboard stays up.
    Pinch-zoom on the dock with the keyboard up: note whether the keyboard drops, and that it
    behaves after zooming back.
15. **Autocorrect before Return.** In the line field type a misspelling that autocorrects, press
    Return, and check the sent text is the corrected one (or at least matches what the field showed).
16. **A laptop-sized window on the phone.** Attach a 250×70 laptop terminal to a session, open it
    on the phone, then type in the laptop. The phone draws the pane at its own font from the left
    edge (right side cut off, no horizontal pan), the cursor row stays in view above the dock and
    the keyboard (a command that fills the pane puts the cursor on its last row), and scrolling into
    history shows the top rows. Repeat with 120×200 (very tall). It renders without a blank or a
    white canvas, and Safari does not reload the page: note Web Content memory (Safari Web
    Inspector > Timelines > Memory, or Settings > Analytics Data for `WebContent`) before and
    during.
17. **Fit and the band.** One second after the laptop types the band reads "Sized for another
    terminal" with Fit. Tap Fit: `tmux display -p '#{window_width}x#{window_height}'` is the phone's
    size, the band goes, and the laptop shows the smaller window. Typing on the phone, pasting and
    rotating also take the window. Lock the phone and unlock it on that tab: it claims again. Airplane
    mode off/on while the laptop holds the window: the window stays at the laptop's size and the
    band stays.

# G3 real-iPhone checklist: touch gestures (P3b)

Safari and the installed PWA, then the app. A scratch session with `cat -vt` (shows every byte
the pane gets), `less` on a long file, `vim -c 'set mouse=a'`, and a shell with a few hundred lines
of output (`seq 1 500`). Playwright covers the logic with injected touches; these are the
things only a finger shows.

18. **Haptic.** Press and hold on the terminal: a firm tap-like buzz as the ring appears, about
    a third of a second in, and not before. Scrolling or a quick tap never buzzes.
19. **Arrow pad feel.** In `cat -vt`, hold, then drag: the first arrow comes the moment the
    finger leaves the ring's centre, repeats faster the further out you push, changes direction at
    once when you swing across, and stops the instant you lift. In a shell prompt it moves the
    cursor along the line; in `vim` it moves vim's. No mouse bytes (`^[[<`) ever appear. Compare it
    with Termius's motion pad: say what feels slower, faster or sticky.
20. **Release selects a word.** Hold and lift without moving: the word under the finger is
    highlighted, the system's selection handles appear on it (they must; if only the highlight
    shows, native handles don't work on a programmatic selection and the design needs its own
    handles), and tether's menu shows Copy and Paste above (below, near the top edge). Drag a
    handle past the word, across a soft-wrapped line and above the screen: the highlight follows,
    the menu follows or hides, and the snapshot scrolls near an edge. iOS's own Copy / Look Up
    callout must not appear on top of tether's menu: note if it does.
21. **Copy keeps logical lines.** Select a long command that wraps, tap Copy, paste into Notes:
    one line, no breaks at the wrap. Select across a hard break and a blank line: breaks kept.
    The toast says "Copied". Paste (menu) into `cat -vt`: one paste, no Enter. A long-press on a
    blank cell: Paste alone, no highlight.
22. **Selection while output streams.** Run `yes | head -n 100000`-style output, long-press a word:
    the snapshot stays put under the handles while the terminal changes beneath.
23. **Mouse-mode apps.** In `vim` with the mouse on, a tap moves the cursor to that cell; a hold-
    and-release selects text and sends no click; a hold-and-drag sends arrows, no mouse. In a shell,
    a tap does nothing and never raises or lowers the keyboard (with it up or down).
24. **Momentum.** In the shell with 500 lines, flick: the output keeps coasting after the finger
    lifts, slows smoothly and stops without a jerk; a touch while it coasts stops it and does not
    count as a tap or a click. A slow drag follows the finger one-to-one. Scroll past what the phone
    holds (a session opened after the output): older rows appear as you go, with at most a short
    pause at the top of what was loaded, in colour, and Jump to latest returns.
25. **Full-screen scroll.** `less` on a long file: a swipe scrolls it with momentum, ↑/↓ sent;
    with mouse reporting (Claude Code, `htop`) it sends wheel events. Check it is not too fast or too slow.
26. **System back gesture.** A horizontal swipe from the left edge on the terminal goes back as
    usual and sends nothing (look at `cat -vt`); a horizontal swipe inside the terminal does nothing.
    A vertical scroll that drifts sideways keeps scrolling.
27. **Cancel.** Start a hold and pull the notification shade or switch app mid-hold: nothing is
    sent, no menu is left behind, the ring is gone on return.
28. **Keyboard untouched.** With the keyboard up, none of the above lowers it (except tapping in
    the snapshot to dismiss, which may); with it down, none raises it.
29. **Pan.** With the keyboard up (terminal panned to the cursor), a long-press selects the word
    under the finger, not one a pan's distance away; the same in history, and with a window sized for
    another terminal (wider and taller than the phone).

