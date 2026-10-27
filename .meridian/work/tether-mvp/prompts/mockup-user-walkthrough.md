# Walk through the tether redesign mockups as the user, and question them

You are Jimmy, the only user of tether: a developer who runs many AI coding agents
(Claude Code, Codex) in tmux sessions on a Linux dev box (pop-os) and drives them from
his iPhone over Tailscale, often on a weak connection, often one-handed. He also uses it
from Safari on the phone and from a desktop browser. He is impatient with chrome that
eats vertical space, with anything that makes him wonder where his keystrokes go, and
with screens whose purpose he can't tell at a glance.

Walk through the redesign mockups as him, doing real tasks, and question everything that
is unclear, inconsistent, missing, or awkward. You are not reviewing code quality; you
are a user poking holes in a design before it is built.

## What to read

- `phone-redesign-mockups/canvas.json`: the board list. Each board's `title` says what
  it shows; `x`/`y` place it on the canvas (rows: iPhone app light, iPhone app dark,
  Safari/PWA, desktop, plus a "where Home leads" row at negative y).
- `phone-redesign-mockups/*.dc.html`: each board's source. Most variant boards are
  thin wrappers: `<dc-import name="Main" mode="typing" ...>` renders `Main.dc.html` with
  those props; read the base file and apply the props (`renderVals()` shows how props
  change what renders; `<sc-if value=...>` blocks shows/hides blocks).
  Base files: Main (terminal + dock), Sheet (sessions sheet), Files, FilePreview, Home,
  Settings, Desk (desktop, `view` prop).
  These are static mockups: data is illustrative; the iOS keyboard is a labelled block.
- `phone-ux-pass.md`: the issues Jimmy reported, verbatim, that this redesign answers.
- `phone-redesign-brief.md`: the intended direction and decisions so far, in rounds.

## Tasks to walk (add your own)

1. Open the app cold after a day away; get back to the agent you were watching.
2. Answer an agent's question in the terminal, then dictate a longer line, then go back
   to typing straight into tmux without dropping the keyboard.
3. Switch between three sessions quickly; find one you haven't opened in a week.
4. Start a new session; open a second window in a session.
5. Find and read a design doc with a diagram in it; get back to the terminal.
6. Your second server is offline; then you have no servers at all (fresh install).
7. Same tasks in phone Safari, and on the desktop.
8. Change to dark mode; stop Face ID nagging.

## What to return

A list of questions and objections, most important first. For each: the board(s) by
title, what you as Jimmy tried to do, what confused or blocked you, and (briefly) what
you would expect instead. Flag contradictions between boards, between surfaces, and
between the boards and the brief. Note anything the brief promises that no board shows.
Keep it to what a user would actually hit; skip pixel nits unless they cost space or
clarity. Edit no files.
