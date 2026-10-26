# Fix: a control client tmux refuses must fail fast and say why

## The defect, as found on Jimmy's dev box (pop-os)

The daemon ran `tmux` from PATH, which was `/usr/local/bin/tmux` **3.7b**; Jimmy's tmux
server is `/usr/bin/tmux` **3.4**. Against that server, the daemon's exact attach
(`tmux -u -N -S <sock> -C attach-session -t '$S' -f pause-after=3`) from the 3.7b binary
prints `%exit` immediately and then **stays alive without answering anything** until
killed. One-shots (`display-message`, `list-windows`) work across the mismatch, so the
session list loaded fine. Result: every watch hung; the hub logged
`tmux didn't answer for 10 s` (src/hub/time.rs:72), killed and respawned the client, and
the iOS app showed "Connecting to pop-os..." forever with no reason. Evidence:
`.meridian/work/tether-mvp/pop-os-connecting-forever.md`.

Jimmy's live machine is already worked around (`tmux.program = "/usr/bin/tmux"`). This
change makes tether itself handle it.

## Target behaviour

1. **`%exit` ends the control client at once.** Today `Session` only records `exit_seen`
   (src/tmux/session.rs ~line 420) and the hub waits for the process to exit or for the
   10 s reply timeout. After `%exit` tmux will send nothing more that matters, so the hub
   should close the client then (drop its line sender: the pump closes stdin, waits 1 s,
   kills — the existing close path), and run the usual exit handling.
2. **`%exit` before the client is Ready is a startup failure, not a detach.** Today
   `client_exited` (src/hub/owners.rs ~line 353) counts `exit_seen` as `detached`, which
   would end the watch as `Detached` — the wrong story here. An `%exit` that arrives
   before the startup reply must take the failure path, counted like a crash so the
   existing `CRASH_WINDOW` rule applies (respawn once, then a second failure within 60 s
   ends the watches with `WatchEndReason::Error` and a message). `%exit` after Ready
   keeps today's meaning (detached, or its session or server ended). Decide how this is
   best modelled in the sans-IO core (e.g. a `SessionError` variant via `fatal`, which
   already exists for startup failures); the core stays sans-IO.
3. **Name a version mismatch.** The daemon learns the server's version from the listing
   (`#{version}` is expanded by the server; it already shows `3.4` while the client is
   3.7b) and the client's from the startup line. Learn `tmux.program`'s own version once
   (`<program> -V` at daemon start, or whatever the code already has that's equivalent —
   check before adding). When they differ:
   - log one `warn!` per server instance naming both versions and the program path;
   - when watches end because control clients for that server keep failing at startup,
     the `watchEnded` message says so plainly, e.g.
     `tmux 3.7b (/usr/local/bin/tmux) can't attach to the running tmux 3.4 server; set tmux.program to that server's tmux`.
     Messages go through the existing `cut`. Keep the generic message when the versions
     match.
   Do not auto-select the server's binary (it is often a deleted file after a package
   upgrade, which is exactly when mismatches happen); just name it.

Check where the web shows `watchEnded { reason: "error", message }` on a tab and make sure
the message reaches the user there instead of "Connecting...". If the client already shows
it, say so; if it doesn't, fix that minimally.

## Constraints

- Read `docs/design/daemon-core.md` §3.1 (startup, versions), §3.3, the hub's Exit and
  Reply timeout rules (~lines 1250-1290), §6 limits, and `src/hub/AGENTS.md` /
  `src/tmux/AGENTS.md` if present before editing. Follow "Code structure and standards" in
  `docs/design/plan.md`: sans-IO cores, thin I/O.
- Update `docs/design/daemon-core.md` (the rules as they now are, no history) and add a
  dated 2026-10-26 entry to `docs/design/decisions.md` with what was rejected
  (auto-selecting the server binary; waiting for the reply timeout). Add a bullet to
  `CHANGELOG.md` `[Unreleased]`. Add a short `docs/running.md` troubleshooting row for the
  mismatch and `tmux.program`.
- No new permanent tests (standing instruction from Jimmy). Existing tests must pass; if
  an existing test pins the old `%exit`-means-detached-before-Ready behaviour, update it.
  Delete any scratch test you write.
- MSRV 1.85: no let chains. Gates: `scripts/preflight.sh full` and
  `cargo +1.85 check --locked --all-targets`; `pnpm --dir web run check` if you touch web.
- Do not commit; the lead commits.

## Verify on the real thing

Reproduce the mismatch against real binaries on a **private socket only** — never the
default socket, never Jimmy's sessions:

- pop-os (`ssh jimyao@pop-os`, works with BatchMode) has `/usr/bin/tmux` 3.4 and
  `/usr/local/bin/tmux` 3.7b. Start a 3.4 server with `/usr/bin/tmux -L tether-p<spawn> new -d -s t`,
  and run a locally built daemon there (or build on pop-os from a copy of this tree in
  `/tmp`, not `~/gitrepos`) with `tmux.program` = 3.7b and `socket_name` = that socket,
  on a non-default port/front so it can't collide with the `tether setup` Jimmy has
  running in session f3. Do not stop or restart Jimmy's daemon. If a separate front is
  impractical there, find 3.4 and 3.7b builds on this Mac (the repo's tests target both;
  look for how the e2e stack finds them) and reproduce locally.
- Show: before, the watch hangs; after, the first `%exit` closes the client at once, one
  respawn happens, and the watch ends within a few seconds with the mismatch message; the
  warn line appears once. Also show the matching-version path is unchanged (watch works,
  a real detach still ends as `Detached`).
- Kill the private server and remove anything you created afterwards.

Report: what changed (files), the failure modes you exercised and their observed output,
gate results.
