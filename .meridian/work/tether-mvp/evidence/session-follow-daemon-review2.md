# Session-follow daemon: round-2 correctness/alignment review (after p243)

Reviewed: uncommitted tree on 3821927 (design base 18ae3f2). No source edits; scratch
repros ran in an rsync copy at /tmp/rev2-sf (deleted afterwards).

## Prior blockers (p237)
- #1 resize/watch during select claims the old window: FIXED (p237 repro on current
  source: no vote on @0, no ClearVote @1, @1 gets 90x28).
- #2 mixed `watching` between CurrentWindow and Locate: FIXED for window/pane/size
  (Layout before Locate sends nothing; Locate sends window1/pane 1). Cwd still mixes (F2).
- #5 pre-bind claim lost on CurrentWindow: FIXED for one notification only; see F1.
- #6 dead code: removed (SelectWindow vote Option, leaving check, View.session_name,
  NewWindow event_seen, duplicate session check).
- #7 wording: fixed (`ViewPhase::Locating` in hub AGENTS.md); state.rs header still says
  "the watched sessions with their windows" (fine).
- #3 Swift: separate lane. #8 CHANGELOG: shorter but still omits protocol-2
  incompatibility / dropped saved workspace (low, notes).

## F1 (Low-Medium, spec drift) pre-bind claim dropped by a second CurrentWindow
`View::target()` falls through to `next` before `shown` exists. Pre-bind: CW @1 sets
next (previous None, claim survives); CW @2 retargets @1 -> @2 and `retarget` drops the
claim. Spec §3.6: "Before the view binds, the target is absent and a claim waits for the
first Locate answer." Repro (fake hub): watch $0, hold owner's Locate, feed
`%session-window-changed $0 @1` then `@2`, settle -> lines: take+vote `@1:80x24`, then
`refresh-client -C '@1:'`, no vote on @2; watching shows window2. Also shows the
pre-bind take going to a window never located/shown.
Reachable: two current-window changes within the first Locate round trip (flash-past
foreground window, script, rapid prefix-n) or a swap seen via `c` plus one notification.
Consequence: newly opened tab doesn't take its window (band until next act); owner left
`latest` on an intermediate window.
Fix (validated in scratch, hub_state 33/33 still pass): make target ignore `next` until
shown exists:
  `.or_else(|| self.shown.as_ref().map(|shown| self.next.unwrap_or(shown.id)))`
Repro then: single take+vote on @2 after the Locate. Subscriptions already list `next`
separately, so nothing else changes.

## F2 (Low, latent) `watching.cwd` belongs to the old window after a window change
View.cwd is per view, not per window; `found()` installs the new window/pane and
`tell()` sends the previous window's cwd. Cwd events for a window that is only target
are dropped by `owned()`, and Session only re-emits on path change.
Repro: bound @0 with cwd /old; CW @1; settle -> watching {window1, pane 1, cwd "/old"};
cwd corrects only when w1's first value arrives (<=1 s). If w1's first value lands
before the Locate answer (scratch: hold Locate, feed w1 value) cwd stays "/old"
indefinitely. Web does not read watching.cwd today (only generated types), so no
user-visible effect yet; becomes real when Files/completion use it.
Fix: drop View.cwd; read the shown window's path from Session's per-subscription
`path` when building `watching` (Cwd event just triggers `tell` when window == shown).

## Note (Low) silent first `c::` value can miss a swap
Session sets current_window from the first `c` value silently when none is known. A
swap-window between the first Locate and that value (<=1 s after attach/respawn) is
never reported. Emitting it is safe: hub `window_reported` ignores a window equal to
shown with nothing pending (and with F1's fix, pre-bind next doesn't target).

## Dismissed after checking
- Event-before-reply select failures: failed select clears selecting and claim; vote
  record cleared by withdraw; mismatched CW before reply keeps selection target until
  Locate corrects. Only unhandled case needs switch-client to fail after select-window
  succeeded in the same group, not reachable.
- Rapid selects / stale earlier notification: guarded; ordering on one client.
- newWindow created-before/after CurrentWindow: both orders claim @new; flash-past
  drops claim per spec.
- Acted during pending Locate: matches target; old-window acts after a switch are
  ignored (claim already moved); new-window baseline is taken after the change.
- Layout/ActivePane/WindowRenamed during pending Locate update shown window only.
- Output/snapshots: owned_pane keeps old stream until Locate; break forgets inflight.
- Input: goes to client-named window; claims only on target; take group precedes input,
  separate group, refused atomically on busy.
- Resources: per view <=3 subscribed windows, votes cleared when unclaimed, selecting
  always settled by reply/settle/Locate.
