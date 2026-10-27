# Probe slice 1 of the client redesign in a real browser

Repo `/Users/jimmyyao/repos/tether`, HEAD `450b454` (local, unpushed). This slice made
Files open as tabs (any number, each remembering its folder or preview), put desktop
navigation in one top row (⌂, tabs, +, server), and made a clean launch open Home.
Behaviour to check against: `docs/design/client/browser-behaviors.md` (Home, Terminal,
Files, Persistence, Keyboard ownership and navigation history).

Run the app against a real daemon and a private tmux, never Jimmy's sessions: follow
`web/README.md` "End to end against a real daemon" (debug build `cargo build`, tmux at
`~/.cache/tether-tmux/3.4/bin/tmux`; the real stack needs `TMPDIR=/tmp` because the macOS
temp path makes the tmux socket path too long). You may write throwaway Playwright
scripts under `/tmp/tether-p-s1/` (never in the repo) using the existing
`web/e2e/shared/stack.ts` stack. Use your own stack; don't touch other running services.
Load `/probe` and `/agent-browser`.

Exercise, in Chromium and WebKit, desktop 1280x800 and phone 390x844, and record what
actually happens:
1. Two Files tabs on one host at different folders plus two terminal tabs; switch among
   all four; each Files tab keeps its folder, each terminal stays live and its output
   continues; typing goes to the shown terminal only.
2. Drill into folders in Files tab A, switch to B, drill, then press browser Back
   repeatedly and Forward: where does each step land? Any request repeated for a folder
   already loaded?
3. Reload on a Files tab and on a terminal tab: lands on Home, both Files tabs listed
   with their folders, each reopens where it was; terminal tabs reconnect.
4. Close the active tab of each kind (neighbour activation; closing the last returns
   Home; closing a terminal tab leaves its tmux session running: check with `tmux ls`).
5. In a Files preview, Insert path: which terminal tab receives it, after a reload too.
6. Network: count requests per folder visit (devtools/network log) to confirm one
   listing per folder and none per keystroke in the path field.

Save at most a few screenshots for anything wrong under
`/Users/jimmyyao/repos/tether/.meridian/work/tether-mvp/redesign/s1-probe/`. Report each
check as pass/fail with the evidence, plus anything else surprising. Clean up your stack,
tmux servers and /tmp files when done.
