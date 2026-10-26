# pop-os: the app sits on "Connecting to pop-os..." (2026-10-26 ~21:50Z)

Symptom (Jimmy): the iOS app shows "Connecting to pop-os..." forever. pop-os daemon log:
`21:50:37Z WARN tmux didn't answer for 10 s client=24` (src/hub/time.rs:72: a control client
with groups in flight completed none for REPLY_TIMEOUT; the hub kills it and respawns).

## Evidence from this Mac (an enrolled node on pop-os), raw WebSocket probe

- pop-os serves the 7eaba6e bundle (`index-CaRCvVLe.js`, same hash as local web/dist):
  daemon is current and restarted.
- `/auth/info` 200, `/auth/node/session` 200 `{deviceName:"device"}`.
- `/ws` + hello{kind:"web"} -> `welcome` in ~5 ms; `listSessions` -> 23 sessions on
  `main:3973548-1793047496`, tmux 3.4, in ~9 ms. So auth, the daemon and tmux's listing work.
- `watch` (claim:false, 55x40) on a1, a2, then singly on a3 ($2) and d1 ($7): **no `watching`,
  no `watchEnded`, no binary frame in 14-25 s.** Every session watch hangs.
- Watches beyond the second on one connection: `watchEnded error "too many tabs open at once (2)"`.
  Separate question; not the hang.

## Reading

Every control-mode attach on pop-os goes unanswered; listing (a different path) works. That
fits the log: the hub's control client for a watched session gets no tmux reply, times out at
10 s, respawns, and the tab never leaves "connecting". Whether tmux 3.4 itself stopped answering
control clients, or the daemon's watch pipeline is stuck, is not yet known: needs a direct
`tmux -C` test on pop-os (no ssh from here).

## Cause (confirmed on pop-os over ssh as jimyao, 2026-10-26 ~22:05Z)

- The daemon is a foreground `tether setup` in session f3 (pid 324458, started 17:51), not
  the systemd unit (none installed). No `~/.config/tether/config.toml`, so `tmux.program`
  defaulted to `tmux` on PATH = **/usr/local/bin/tmux 3.7b**. The server Jimmy's sessions run
  in is **/usr/bin/tmux 3.4** (`display -p '#{version}'` -> 3.4).
- Daemon's exact control attach against f2: 3.7b client prints `%exit` immediately and then
  sits until killed (exit 124); 3.4 client attaches and answers `hello`. One-shots
  (listing, display-message) work with 3.7b, which is why the session list loads.
- No leaked control clients in `tmux list-clients`.

## Fix applied

`~/.config/tether/config.toml` on pop-os: `[tmux] program = "/usr/bin/tmux"`. Takes effect
when Jimmy restarts the `tether setup` in f3 (tether only; tmux untouched).

## Tether defects this exposed (not fixed yet)

1. A control client that prints `%exit` and stays alive is reported as "tmux didn't answer
   for 10 s" and respawned forever; the tab shows "Connecting..." with no reason. `%exit`
   should end the client at once, and the watch should end with a reason the user can read.
2. The daemon never checks that its tmux binary's version matches the server's
   (`#{version}` is already in the listing). A mismatch should be named at startup and in
   the watch error: "tether runs tmux 3.7b; the server is 3.4; set tmux.program".
3. "too many tabs open at once (2)" on one connection: check the cap against plan.md.

## Landed

`db6fe31` (pushed): first owner's view is `Locating { owner }` so a startup failure counts
as a crash (one respawn, then `watchEnded error`); `%exit` closes at once; the mismatch is
warned and named. Live on pop-os private socket: mismatch -> error at 21.0 s with both
versions; matching -> watch works, detach ends `Detached`. Item 3 (2 tabs per connection)
is by design: decisions.md "Caps sized for the memory ceiling", and the client unwatches
covered tabs. pop-os still runs the 17:51 `tether setup` in f3; needs Jimmy to restart it
(config `tmux.program = "/usr/bin/tmux"` is in place) and, for this fix, rebuild.
