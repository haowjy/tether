# Probe: can tether see a terminal bell in a tmux session cheaply?

## Why

The phone redesign adds an attention dot on a tab or session row when that session rang
the terminal bell (BEL, `\a`), e.g. Claude Code or Codex waiting for input. Jimmy: "the
terminal bell (if we can find it)". Before it's designed we need to know, from real tmux,
how the tether daemon can learn that a bell happened, for sessions it is and isn't
streaming, and what it costs. tether's principles: tmux is the source of truth, every byte
on the network costs (phone on a weak link), light on a busy host.

## What tether does today (read to ground the probe)

- `docs/design/daemon-core.md`: tmux control mode (`tmux -C`), one control client per
  session with a watched tab; only the tab on screen is watched. `sessionsChanged` refetch.
- `src/` (the Rust daemon), `docs/design/plan.md` "Tabs and the session sheet".
- Real tmux versions: this Mac has Homebrew tmux 3.8 (`/opt/homebrew/bin/tmux`);
  pop-os (`ssh pop-os`, user jimyao) runs Jimmy's server on `/usr/bin/tmux` 3.4 and also
  has `/usr/local/bin/tmux` 3.7b. tether must work on 3.4 and 3.7b.

## Questions to answer with evidence

1. A bell in a window that is the session's current window, with no client attached to
   that session: is `window_bell_flag` / `session_alerts` / `window_activity_flag` set?
   (tmux's alerts code reportedly flags only non-current windows; check what really happens,
   and whether `monitor-bell`, `bell-action`, `visual-bell` change it.)
2. Same, with a tether-style control client (`tmux -C attach -t <s>`) attached: does
   control mode report the bell (a `%` notification, or only the `\a` byte in `%output`)?
3. Do the `alert-bell` / `alert-activity` hooks fire for a current window in an unattached
   session? Could a hook set a user option (e.g. `@tether-bell`) or run a command the
   daemon reads? Does that work without touching Jimmy's own config permanently (session
   or server option set by tether at runtime vs `.tmux.conf`)?
4. Can one control client learn about bells in *other* sessions without streaming them:
   `refresh-client -B` format subscriptions (3.2+), `%subscription-changed`, a periodic
   `list-sessions -F` with a flag, or hooks? Cost of each: bytes per bell and at idle,
   wakeups, CPU.
5. How is the flag cleared (when a client views the window? `kill`? manually), and could
   tether clear it when the phone shows that tab without changing what Jimmy's laptop sees?
6. Claude Code / Codex: do they ring BEL when waiting for input by default, or only with a
   setting (Claude Code's notification channel `terminal_bell`)? Cite docs or observe.

## Constraints

- Never touch Jimmy's running tmux server or its sessions. Use an isolated socket
  (`tmux -L probe-bell-<your spawn id> ...`) on this Mac (3.8) AND on pop-os for 3.4 and
  3.7b (`ssh pop-os`; `/usr/bin/tmux -L ...` and `/usr/local/bin/tmux -L ...`). Kill your
  sockets' servers when done. Don't change any config file.
- No tether source edits. Throwaway scripts go in your scratch area, not the repo.

## Return

Per question: the answer per tmux version (3.4, 3.7b, 3.8), the exact commands run and the
output excerpt that shows it. Then a recommendation: the cheapest reliable way for the
daemon to know "session X rang the bell since you last looked", what it costs at idle and
per bell, and what can't be done (with the version that blocks it). Write the findings to
`.meridian/work/tether-mvp/probe-bell.md` (the excerpts, not raw dumps).
