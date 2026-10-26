# Control-client mismatch: round-two live verification

Date: 2026-10-26. Verified on Pop-OS with private tmux socket `tether-p297` only.
The server was `/usr/bin/tmux` 3.4 (instance `851424-1793055713`); the mismatched
configured client was `/usr/local/bin/tmux` 3.7b. No default tmux socket, Jimmy's
sessions, or `tether setup` in session f3 were used.

The current checkout (HEAD plus the uncommitted diff) was copied to `/tmp/tether-p297`
and built there. A separate `tether serve` used an isolated XDG runtime and state under
that directory, an isolated `tether device add`, and an explicit temporary login allow
for a WebSocket probe over its private local socket. It did not modify Tailscale Serve
or the existing daemon.

## Mismatch path

The session listing succeeded and reported server version 3.4. Watching `$0` produced:

```text
watchEnded {"watch":1,"reason":"error","message":"tmux 3.7b (/usr/local/bin/tmux) can't attach to the running tmux 3.4 server; set tmux.program to that server's tmux"}
elapsed_seconds 21.009
```

The private daemon log had one `tmux client version differs from server version` warning
and exactly two `tmux didn't answer for 10 s` warnings for control clients 1 and 2, then
their two end records: one retry, then the mismatch error after the second startup
failure. This exercises the normal timeout, not a mismatch-only short deadline.

## Matching path and cleanup

With the same private server and `/usr/bin/tmux` configured, the listing loaded, the
watch bound (`watching`), and detaching the real private control client produced
`watchEnded {"watch":1,"reason":"detached"}` in 0.012 s. The matching daemon emitted no
version-mismatch warning.

A temporary test fed `%exit` to a fresh sans-IO `Session` and confirmed the event is
`Fatal(StartupExit)` before `Ready`; the scratch test file was deleted immediately.

Both temporary daemons were stopped; `/usr/bin/tmux -L tether-p297 kill-server` stopped
only the private server. Confirmed no process remained, that `-L tether-p297` had no
server, and `/tmp/tether-p297` was removed. The default socket was not queried.
