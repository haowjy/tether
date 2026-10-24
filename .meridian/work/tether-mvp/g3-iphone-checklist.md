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
