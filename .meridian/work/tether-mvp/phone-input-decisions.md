# Phone input decisions (2026-10-24, from Jimmy running the keyboard spike on his iPhone)

Settled by Jimmy:
- A tap on the terminal never opens the keyboard; only the keyboard button does ("like termius").
- One place opens and closes the keyboard: a single toggle. (Coder p109 is applying this to the
  specs and spike, with the toggle in the web toolbar and the key row's hide key removed.)
- The text box ("edit") is a single-line editor, not the multiline draft in
  terminal-interaction-design.md / client-architecture.md (P3a).

Context: Jimmy's Termius reference screenshot shows, bottom-up: keyboard; key row
(esc tab ctrl alt / | ~ -) with the keyboard toggle at its right; an always-visible one-line
"Use voice typing here..." field with Paste and AI chips; a host bar (back, host pill, +, grid);
full-bleed terminal above.

Answered 2026-10-24 (all recommended options):
- Return in the single-line box sends the text + Enter, and clears the box.
- Layout A: a Termius-style dock always at the bottom: tabs bar, one-line box, key row
  (esc tab ctrl alt ...) with the keyboard toggle at its right; rides on the keyboard when up.
  The toggle therefore lives in the key row, not the toolbar (supersedes p109's placement).
- Phone browser/PWA gets the same dock and key row (reverses "no custom browser keyboard strip").
- Next: build P3a/P3b against real tmux; the spike checklist waits until the native app needs it.
- Jimmy: "basically, a shit ton of ui issues" (about the spike). UI quality is the bar for P3.

Tech-lead lean, to settle in the spec: the web owns the dock on both platforms (one
implementation; the browser needs it anyway). Native drops its inputAccessoryView key row and
compose UITextView, and only reports keyboard geometry.

Spike limits Jimmy hit, all expected (spike is a keyboard-ownership rig, not a terminal):
backspace shows as a ⟨BSpace⟩ label (no shell), no terminal selection (P3b), no touch scrolling
code (P3b), harness chrome is throwaway.

## Dock variations (mockup https://claude.ai/artifact/HqphCamD9rj2CbBnAS4sGJ)
Jimmy: smaller buttons and tabs; "i don't think we should EXACTLY copy termius". Four variations
drawn: 1 compact dock (30px tabs, 32px keys), 2 one row at rest (tab chip + box + toggle; keys
only with keyboard up), 3 smart keys (key row follows the pane's program: shell vs vim),
4 tabs on top.
- Rejected 4 (tabs on top): "hard to reach". Navigation stays in the bottom dock.
- Open: choice among 1/2/3 (tech-lead recommendation: 2 + 3).
- Jimmy leans to 2 ("seems interesting") and wants other tmux sessions easy to reach whether
  or not they are open as tabs. Drawn (Switcher.dc.html): the tab chip opens one bottom sheet:
  open tabs as pills (one tap to switch), then every session on the host with its windows
  (here/open labels, no dots), search + new session at the bottom in thumb reach. Replaces the
  tabs row and +; would merge with the existing open-session picker (browser-behaviors.md).
- Arrow keys come off the key row (Jimmy: "i don't think the arrow buttons should be needed").
  Long-press on the terminal fires with a haptic; then: keep holding and drag = arrow pad (Termius
  "motion" joystick: direction sends arrows, repeating while held); release without moving =
  select the word under the finger, with handles to drag the selection further (Jimmy: "long
  press -> release -> highlight word -> can drag it further"). Interpretation confirmed with
  Jimmy in chat pending. Applies the same in mouse-mode apps (no mouse event on long-press).
- Arrows settled (tech lead, after Jimmy: spacebar trackpad "kinda works, but not that well";
  unsure what he uses arrows for): long-press hold-and-drag arrow pad is the one arrow input;
  vertical swipe in alternate-screen apps keeps sending ↑/↓ (already in spec). No arrow keys in
  the key row, no spacebar-trackpad mapping. Box command history deferred (FUTURE), revisit if
  arrow use turns out to be mostly history recall.
- Arrow use is "probably mostly recalling commands" (Jimmy). Recall is the shell's job (↑, ^R
  use the shell's real history, including desktop commands); no tether-side box history.
- Key row: ONE FIXED row for P3a, most-used first: esc ↑ ↓ ^R ^C tab ctrl alt | ~ / -
  (scrolls), keyboard toggle fixed at its right. Smart keys (row follows the pane's program via
  tmux pane_current_command subscription) deferred to FUTURE: Jimmy "do we need to know whats
  running... although i guess that would be helpful"; tech lead chose fixed for fewer moving parts
  (daemon watch + protocol + client) with smart keys as a later refinement.
- Tab-chip swipe (prev/next tab) deferred to FUTURE; easy to add later.
- Two keyboard openers, one closer (option A; Jimmy's Termius screenshots show the same model):
  ⌨ opens live typing to the terminal; tapping the box opens line typing into the box; ⌨ closes
  either; terminal taps never open/close; the key row always sends to the terminal.
  Rejected: box as the only opener (loses live keys: Tab completion, ^R, vim, y/n prompts) and
  live mode toggled inside the box (extra tap, same two modes).
- Focus cues, copied from Termius (Jimmy: "note the difference when the focus is different"):
  terminal focused = solid block cursor, box shows placeholder, keyboard Return key is plain ⏎;
  box focused = caret in the box, terminal cursor becomes a hollow outline, Return key becomes the
  blue send key (returnKeyType send / enterkeyhint="send"). Same key row in both.
- Jimmy confirmed (2026-10-24): variant 2 (one row at rest) is the arrangement. Line field
  auto-capitalization off; Jimmy: dictation's own capitalization can't be controlled, so accept it.
