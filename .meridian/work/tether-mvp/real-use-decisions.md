# Jimmy's decisions from first real use (2026-10-25)

Not yet in docs/design/; the design pass folds each into the spec and decisions.md.

1. **Sessions, not windows.** Screenshot of Home: every session expanded to "0: python /
   open / + New window". Jimmy: "I don't think u should be listing the windows... default
   just list the session, and then optionally, if there are multiple windows, THEN u can
   have some kind of ui for opening individual windows but by default it should just load
   the whole thing (especially if there is only 1 window)."
   Chosen (AskUserQuestion): **Follow the session** — like `tmux attach`: one tab per
   session showing its active window; switching windows (in tmux or a small switcher in
   tether, only when 2+ windows) changes what the tab shows; lists show sessions only.
   Rejected: open the active window as a fixed tab (today's model, one tap shorter).
2. **Size ownership indicator.** Jimmy: "there should be some kind of way to SEE if we have
   the focus or not". Chosen: **band only when another terminal holds the size** (current
   design: "Sized for another terminal" + Fit). Rejected: an always-visible marker. The
   band never showed in real use: bug under investigation (p216).
3. **Files: finding a folder.** Jimmy: "/#/files needs a ui rework... there should be a
   search for a folder... maybe like vscode, prediction match the next folder... it should
   be mobile first". Chosen: **path field with completion** (type a path; predicts the
   next existing folder; Tab/tap accepts; list below narrows). Rejected: fuzzy search over
   all folders (needs a server index); both modes in one field.
4. **App shell fill.** "we should have 1 main shell that fills the window, and any banners
   etc should be inside it" ("Update ready" banner made the page scroll). Bug fix, p221.
5. **Removed note** "Another terminal is attached..." (done, 9a987e0/4ef3b5f).

## Answers to the design's open questions (p222), 2026-10-25

6. Choosing a window in tether moves an attached laptop too (like prefix-n): **accepted**.
   Rejected: hidden grouped sessions per tab.
7. Files' path field **replaces** the 10-23 "Add folder" dialog.
8. Desktop windows button **shows on one-window sessions** (only way to create a window).
9. Tab label **shows the window name** even with one window.
10. Window sizing (p216 + p225): typing, pasting or Fit in tether should take the window
    to tether's size, and laptop typing takes it back. Mechanism found by p225:
    `switch-client -c <owner> -t <same session>` before the input makes tether tmux's
    `latest` client on 3.4/3.7b/3.8 with no key injection and no `manual` window-size.
    Rejected: `resize-window` (flips window-size to manual; a crash leaves it), `send-keys
    -K` (goes through key bindings; on 3.4 drops ASCII and Enter).
