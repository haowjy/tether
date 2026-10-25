# Design: tabs follow a session; Files finds folders by path completion

Two independent spec changes from Jimmy's first real use (real-use-decisions.md items 1
and 3), written into `docs/design/` uncommitted. Each can land on its own.

## 1. Tabs follow a session

**A tab is a tmux session, like `tmux attach`.** The daemon follows the session's
current window itself: the control client attached to the session gets
`%session-window-changed`, the hub asks that client which window and pane are now
current, and sends the tab one `watching` and one snapshot. The client never re-watches,
so a window change costs the network only the snapshot it needs anyway.

Evidence: `docs/design/research/probe-session-follow.md` (p223), tmux 3.4 and 3.7b built
from tags: the notification arrives for every trigger (laptop prefix-n, control
`select-window -t '$S:@W'`, foreground `new-window`, shell exit, `move-window`), before
the new window's layout; it is broadcast to every control client, so the daemon filters
by its own session id; `select-window` by a control client makes no client `latest`;
vote-then-select reflows once; with `detach-on-destroy off` tmux moves the control
client to another session (`%session-changed`) instead of `%exit`.

Decisions (all in `decisions.md` § "Tabs follow a session"):

| Question | Decision |
|---|---|
| Tab identity, restore | `SessionRef { server instance, $N }`; restore validated by listings as before; a v1 saved workspace (window tabs) is dropped whole |
| What the daemon watches | one *view* per watched session; owner = that session's control client (no Locate needed to find it); `Locate { session }` replaces `Locate { window }` + `LocateSession`; window phases, `windowClosed`, `windowRenamed` deleted |
| Claims when the window changes | claim = (watch, window), always on the current window or the one `selectWindow` is `selecting`; any change of current window drops it unless it's the claim's own; `selectWindow` votes then selects in one group; `newWindow` with a watch claims the created window; a change tether didn't make: old window's vote clears, new keeps its size until the tab acts |
| Changes tmux doesn't announce | `swap-window` sends no `%session-window-changed`; each owner subscribes to its session's current window id (`refresh-client -B 'c::#{window_id}'`), a change becomes `CurrentWindow` (≤ 1 s lag) |
| Scrollback | `historyChunk` names its pane; the client drops chunks for another pane |
| Input/paste/insert target | `input` and `paste` carry the window the tab showed; daemon sends `-t @W`; image paste and Files insert capture the window with the tab |
| Window switcher, phone | "Windows in <session>" block in the session switcher sheet: window rows when 2+, then "+ New window"; rows labelled "shown" in words |
| Window switcher, desktop | windows button (chevron) in the active pill opens a menu: rows, then "New window". tmux prefix keys do NOT work from tether (send-keys skips key tables), so the menu is the desktop's only switcher |
| "+ New window" | only in the window switcher; Home loses it; creates and selects (no `-d`), like prefix-c |
| Lists | sessions only, no accordions, search by session name |
| Label | session name, then current window name (window truncates first) |
| Protocol / bridge | protocol 2 (min 2); bridge 3 (`TabKey` names a session) |
| `%session-changed` | hub closes the client and reports `sessionClosed` |

## 2. Files: path field with completion

**One field at the top of Files.** At rest it shows the current path; typed into, it
lists the matching subfolders of the typed parent and ghosts the first match. Phone
accept: tap a row, or type `/` after a partial name ("rep/" → "repos/"); hardware: Tab
or →. Go (Return) opens; with an empty last segment nothing is highlighted, so Go right
after an accept opens the accepted folder. Ordinary text keyboard (the URL keyboard has
no space bar).

| Question | Decision |
|---|---|
| Where | top of Files, replaces the path context; Cancel beside it while editing |
| Cost per keystroke | zero requests; one listing per folder entered (250 ms settle), cached per host (32 folders, shared with browsing); no daemon change |
| Roots and `~` | inside a root: `/fs/list`; under `$HOME` outside roots: `/fs/dirs`, rows "not added"; above roots elsewhere: completes root paths client-side |
| Hidden folders | only when the segment starts with `.` or the hidden toggle is on |
| Selecting | Go opens the folder (history entry); outside-root folders show subfolders with "Add this folder" |
| Browsing by tap | unchanged at rest |
| Add folder dialog | deleted; "Add folder…" starts the field at `~/` (pending Jimmy) |

## Jimmy's answers (2026-10-25, real-use-decisions.md 6-10)

All four recommendations accepted: choosing a window moves an attached laptop too; the
path field replaces the Add folder dialog (the "pending" marker is gone); the desktop
windows button shows on one-window sessions; the tab label always shows the window name,
set apart by spacing (no dot or separator). Item 10 (sizing) is round 2 below.

## Round 2 (p229): tether takes tmux's `latest`

**Typing, pasting, Fit or opening a tab sizes the window to exactly tether's size, larger
or smaller than the laptop; the laptop's next key takes it back.** When the owner starts
voting a window it first *takes* `latest`: `switch-client -c '<own client>' -t '$S' ;
refresh-client -C '@W:CxR'`. The vote after the switch is what makes 3.4 recalculate.
`selectWindow` is `select-window ; <take>` (one reflow; a vote ahead of the select
reflowed twice). Evidence: research/probe-latest-client.md (p225) and
research/probe-session-follow.md §8-16 (p231, p232), tmux 3.4 and 3.7b.

| Question | Decision |
|---|---|
| When to take | with every vote on a window the client has no applied vote on (new claim, after a yield, after a window change, first vote on a respawned client), and every Fit; not per keystroke |
| Order | a claiming `input`/`paste` writes its take-and-vote group just before its own group; separate groups so a failed take never drops keys |
| Owner name | `#{client_name}` added to the startup line (`client-<pid>`) |
| `%session-changed` | own session (attach, every take) dropped; another session = `SessionChanged`; `%client-session-changed` dropped |
| Side effects accepted | hook `client-session-changed` once per take; session activity / last-attached advance; control client key table resets; no focus event, laptop's acts entry unchanged |
| Claim ends without a yield | owner stays `latest`: window takes the owner's client size until a terminal acts there or the owner detaches after linger |
| Band | `ShownWindow.size` (window, not pane), re-sent in `watching`; band after 1 s of window size != sent size, either direction |
| Swap check | `c::#{window_id}` confirmed on 3.4/3.7b: 0.2-0.7 s per swap, silent otherwise |

Rejected: `resize-window` (flips `window-size` to manual; a crash leaves it), `send-keys
-K` (key tables; 3.4 drops ASCII and Enter), keeping the cap, a take per keystroke, the
switch without a re-vote (3.4), the take inside the input's group.

## Implementation plan (after round 2)

| Lane | Touches | After | Verify |
|---|---|---|---|
| **1a tmux bridge** | `src/tmux/`: `Session::new(session)`; startup line adds `#{client_name}`; `%session-window-changed` (own session → `CurrentWindow`); `%session-changed` own session dropped, another → `SessionChanged`; `%client-session-changed` dropped; `Layout` carries the window size; `Locate { session }` with window size; `Vote { take }` (`switch-client -c ; refresh-client -C`); `SelectWindow` = select then take; `WatchCurrent` (`c::#{window_id}`); `NewWindow` without `-d` | — | fixtures on 3.4 (pop-os) and 3.7b (Mac): the round-1 set plus a take with the pty smaller and larger, `swap-window` each way, `detach-on-destroy` on/off |
| **1b protocol 2** | `src/hub`: views, claims, take-due rule (no applied vote / size moved off a standing vote / Fit; no repeat of a futile take), take-before-input ordering, `selecting` rules (input to the window being left, `Acted` window check, Locate on select reply, failed select drops the claim); `src/proto` + generated TS (`ShownWindow.size`); web: tabs, workspace v2, lists, switcher, pill menu, labels (spacing, window name always), band rule in `tabs/driver.ts` (any size difference, wait = max(1 s, RTT + 0.5 s), restarted per claiming send); iOS bridge 3, `DaemonProtocol.version` | 1a | `tests/hub_state.rs` cases in daemon-core §8; `tests/tmux_real.rs` sizing with a watch larger than the pty (274×53 vs 80×24) and smaller, on 3.4 and 3.7b; `hub_real` `watching` re-sent with window size; `web/e2e/terminal/terminal.real.ts`: a 2000×970 browser against an 80×24 pty ends at 274×53 after typing, the band shows after the pty types (window smaller), Fit takes it back, on both versions; real iPhone: same, plus laptop prefix-n follow |
| **Gate** | probe the 3.4/3.7b `control_notify_session_window_changed` NULL-deref path (daemon-core §9 risk 4) | 1a | prober, before daily use |
| **2 Files path field** | unchanged from round 1 | — | unchanged |

Order: 2 and 1a in parallel, 1b after 1a (1a needs the hub change to compile: land together or bridge). Swap and take probes are done (p231, p232).

## Review record

- p226 (correctness, opus): request changes → fixed: claim lifetime across window
  changes, `selectWindow` vote cleared by reconcile, swap-window, pre-bind claim,
  history pane, Files Go off-by-one, Swift protocol constant, stale docs, parser
  simplifications, state diagram, tmux 3.4 NULL-deref risk.
- p227 (alignment): approve with notes → fixed: desktop prefix keys can't work,
  Files Go, inserted-path failure path, switcher loading states, stale docs and
  superseded notes, dock mockup, old drafts.
- p228 (second cycle): close; fixed the remaining medium (`#{window_active}` in `w<W>` fires every second for a window linked twice → replaced by a per-owner `c::#{window_id}` session subscription) and lows (`selecting` cleared only by the owner's first `CurrentWindow`/Locate after the group's reply; §7 rows; paste claim condition; draft migration wording; `Changed` notes on 9 older decisions; tests for swap and both selection orders). Converged at minor refinements; no third cycle run.
- p233 (round 2, alignment + correctness, opus): approve with notes → fixed: M1 take
  only when no vote stood missed an unreported laptop act (now: take when the window's
  size moved off a standing vote, once per vote); M2 `selecting` lost to input aimed at
  the window being left and to a late `Acted` (now kept / window-checked); lows: what
  the window gets when tether stops holding it (browser-behaviors, plan), Locate on a
  select's reply, `Layout` in §4.2, band wait vs RTT, linked window with two owners as
  an accepted cost, failed select drops the claim. Not re-reviewed: last design round.
