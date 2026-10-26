# Round 2 on the control-client %exit / version-mismatch change

Apply these to the uncommitted change you made (review: p296's report, in this spawn's
--from context). Do not commit.

1. **Delete the mismatch-only 2 s startup deadline** (tech-lead decision). Remove
   `VERSION_MISMATCH_STARTUP_TIMEOUT`, `Due::Timeout(Duration)` back to `Due::Timeout`, and
   the `has_startup_version_mismatch` branch in `time.rs`. Startup failures use the normal
   10 s reply timeout; the second failure within CRASH_WINDOW ends the watch with the
   mismatch message (~21 s). Keep the owners.rs `Checking` -> `Locating { owner }` change
   and the reconcile orphan filter: the review confirmed they are the actual loop fix.
2. **Shrink endpoint state to one field:** `server_version: Option<TmuxVersion>`, set when
   the server instance is learned, cleared next to `live = None` in `server_gone`. Warn
   once when it is first learned for an instance and differs from the program's version
   (no `mismatch_warned`, no `live` re-check). Pass `program_version` as a `State::new`
   parameter instead of poking it in after construction.
3. **Make `detached` explicit:** replace `client_exited`'s `killed: bool` plus
   `Client.moved` plus the `exit_seen` read with one `detached: bool` argument
   (`Event::Exit` and `owner_moved` pass true; Fatal, timeout, pump exit pass false).
   Delete `Session::exit_seen()` and the field if nothing else needs them; move its test
   callers (tests/tmux_real.rs, tests/tmux_session.rs) to assert on `Event::Exit`. Keep
   `startup_failure` for message selection.
4. `program_version`: log one `warn!` when `-V` fails or doesn't parse (it usually means
   tmux.program is broken).
5. Docs: fix daemon-core.md §4.2 view phases and diagram (`Checking` = the session is being
   checked; `Locating { owner }` = owner starting or Ready; spawned -> Locating). State in
   §3.1 that the program's version is read once at startup and is stale until restart.
   Add the rule "an orphan's Locate belongs to its exit check" to src/hub/AGENTS.md's rule
   list. decisions.md entry: "Decided: 2026-10-26, tech lead" (not Jimmy); rejected:
   auto-selecting the server binary, refusing to attach on mismatch (a newer client can
   work with an older server), a mismatch-only short startup deadline (a mode for a
   once-fixed misconfiguration), one startup deadline for every client (unprobed on a busy
   host). CHANGELOG bullet: a tab whose tmux client can't start no longer sits on
   "Connecting...": after one retry it ends with an error naming the cause (and the
   version mismatch when there is one).
6. Re-verify on pop-os exactly as before (private `-L` socket only; never the default
   socket or Jimmy's `tether setup` in f3): mismatch path ends with the mismatch message
   after one respawn (record the time), warn once; matching path watches and a real detach
   ends `Detached`. Clean up afterwards. Gates: `scripts/preflight.sh full`,
   `cargo +1.85 check --locked --all-targets`. No new permanent tests.
