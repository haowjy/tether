# Review: window size follows the client that acted last (design docs, uncommitted)

Reviewed: the uncommitted working tree on top of `HEAD` of `main`, these paths only:
`docs/design/daemon-core.md`, `docs/design/research/probe-latest-activity.md`,
`docs/design/decisions.md`, `docs/design/plan.md`, `docs/design/complete.md`,
`docs/design/ios-shell.md`, `docs/design/client/browser-behaviors.md`,
`.meridian/work/tether-mvp/design/client-architecture.md`,
`.meridian/work/tether-mvp/build-plan.md`. Checked against tmux source at tags 3.4 and
3.7b (`/tmp/tether-meridian-501/tmuxsrc/src`), the current hub (`src/hub/reconcile.rs`,
`src/hub/requests.rs`) and web (`web/term/size.ts`, `web/term/xterm.ts`), and xterm's
WebGL addon in `web/node_modules`.

## Verdict: approve with notes

The mechanism is sound. The claim/yield rule matches what tmux does: the vote caps the
window, and clearing it hands the window back to `latest`. The subscription format sees
every act that makes a client `latest`, and the docs agree with each other almost
everywhere. Checked against source:

- `resize.c` `clients_calculate_size` (3.4 and 3.7b): in the first loop, a per-window
  size replaces the size of the `latest` client. The second "clamp" loop then caps every
  dimension by every client's per-window size. So a claimed window is never larger than
  the vote, and a cleared vote falls back to `latest`. Both match §3.6 and the band rule
  in client-architecture §5.4.
- `server_client_update_latest` is called from the key callback's `out:` label for every
  key except `KEYC_FOCUS_OUT`, from `MSG_RESIZE` for clients that aren't control
  clients, and from `server_client_set_session`; `select-window`, `new-window`,
  `break-pane` and `spawn` set `latest` directly. `activity_time` is set in the same key
  callback, and also on `MSG_WAKEUP`/`MSG_UNLOCK` and at creation. The §3.6 list of acts
  is right.
- `format_cb_window_active_clients_list` walks every client in every session. So a
  laptop on another session that has W linked and current shows up, as it should,
  because `latest` belongs to the window. `format_loop_clients` passes the outer
  `ft->wl`, which is why the membership trick works.
- `control_check_subs_window` keeps one last value per winlink. A window linked twice in
  the owner's session, or moved to a new index, re-sends the same value. `Session`
  compares values, not indexes, so it sees no false act. That holds up.
- §4.4's derivation ("claimed bound windows C owns") makes moving a claim between two
  watches a plain `Vote` with the new size. A yield is a `ClearVote` that deletes the
  applied record, so the next claim sends `Vote` again. I found no conflict with how
  reconcile orders its ops.

Two medium findings. A reconnect claims the window, which breaks the doc's own "propped
phone" promise. And the phone's render cost now grows with the laptop's terminal size.
The rest are low: edge cases, wording and naming.

## Medium

### M1. A reconnect claims the window, which breaks "a tab that stays on screen never takes it back"

- **Where:** daemon-core §3.6, the claim bullet ("Bringing the tab on screen claims
  (… a reconnect)") and the accepted cost "A reconnect re-sends `watch`, which claims";
  decisions.md "'Acts' means input or bringing the tab on screen", which lists the
  reconnect and gives as its *Why* "A phone propped on the desk with the tab open sends
  nothing, so it never takes the window back while he types on the laptop";
  browser-behaviors.md ("A tab that just stays on screen never takes it back"); §3.6
  ("so a phone propped on the desk never takes the window back while the laptop is in
  use").
- **Failing scenario:** The phone sits on the desk with the tab open and the screen on.
  Jimmy types on the laptop, which has the window at 200×50. The tailnet path blips:
  Wi-Fi roam, a DERP switch, or the 4002/idle-timeout paths in §7. The client
  reconnects on its own and re-sends `watch`. The window shrinks to the phone's 56×40
  in the middle of a laptop command. The laptop's next key, up to about 1–2 s later,
  gives it back. Each blip costs two reflows of the laptop's screen and two snapshots
  (§4.3). On "spotty, barely-there connections" (AGENTS.md) blips are routine, and
  nobody touched the phone. The docs promise this can't happen, then list it as a cost
  in the same section. The two statements contradict each other, and the cost isn't
  small.
- **Check:** Read the bullets quoted above side by side. §5.5 of client-architecture
  ("Visible and unlocked: reconnect at once and rewatch the tab on screen") confirms the
  automatic re-watch.
- **Fix direction:** Claim only after a user act, never after an automatic re-watch.
  Give `watch` a `claim: bool`, true when the tab came on screen through the user
  (opening, switching to it, returning from Home or Files, unlocking into it). The
  client sets it false when re-watching after a reconnect or a daemon restart, unless
  this tab held the size when the socket dropped. The client can tell from the band rule
  it already computes: the pane was not wider or taller than the tab. This is a flag on
  a message the client already sends, not the rejected separate `claim` message. Update
  the §3.6 cost list, the decisions entry (its list of claiming acts and its *Cost*),
  browser-behaviors.md, the §5.3 `watch` row, and the §8 hub tests. Instance or class:
  one case of a broader class, a protocol message that does double duty (automatic
  resume and user intent). The flag ends that class for `watch`.

### M2. The phone's render cost now grows with the laptop's terminal, not the phone's screen

- **Where:** client-architecture §5.4, "The pane keeps tmux's size, whatever the box"
  (the larger case: anchored left, clipped right, the terminal element at the pane's
  height).
- **Failing scenario:** Before this change, a claimed window was always at most the
  tab's size, so xterm's WebGL canvas was bounded by the phone's screen. Now the laptop
  holds the window most of the time, and xterm is resized to the laptop's pane. The
  addon sizes its canvas as `cols × cell.width` by `rows × cell.height` in device pixels
  (`web/node_modules/@xterm/addon-webgl`: `device.canvas.width=this._terminal.cols*this.dimensions.device.cell.width`).
  Take a 250×70 laptop pane at a phone font of about 7.2×15 CSS px and DPR 3. That
  gives roughly 5400×3150 device px, about 17 M pixels, or about 68 MB per drawing
  buffer. That is above WebKit's 16.7 M-pixel (4096²) canvas area limit, and the extra
  GPU memory lands in a WKWebView that jetsam can kill. Most of those pixels are drawn
  and then clipped. This is a cost that grows with someone else's state, the kind
  `/dev-principles` "efficiency by construction" calls out, on the device where memory
  is tightest.
- **Check:** The scaling is verified in the addon source above. I could not check
  whether iOS WebKit refuses or downscales a WebGL drawing buffer that size (see
  Hypotheses).
- **Fix direction:** Add a real-iPhone gate to PS-web: a 250×70 and a 300×80 pane at the
  phone font, checking that the canvas renders and measuring Web Content memory. In
  §5.4, state a bound: above N device pixels, the larger case either switches that tab
  to xterm's DOM renderer, or shows the band with Fit over a dimmed last frame instead
  of rendering the full pane. Record the choice in decisions.md under "A window sized
  for another terminal is clipped, not scaled".

## Low

### L1. Some entry changes aren't acts: focus-out, and clients tmux doesn't size by

- **Where:** daemon-core §3.7 `<acts>`, and the §3.6 sentence "tmux then sizes the
  window by `latest`, which that act just made the other client".
- **Failing scenarios:**
  1. With `focus-events on`, the laptop's terminal losing focus (Cmd-Tab away) updates
     `activity_time` without making it `latest`: `out:` skips `KEYC_FOCUS_OUT`. That
     yields the phone's claim just as Jimmy leaves the laptop. §3.6 lists this as a
     cost, but it can be fixed: `tty-keys.c` clears `CLIENT_FOCUSED` on focus-out, and
     `#{client_flags}` shows `focused` (3.4 `server_client_get_flags`).
  2. A client attached with `-f ignore-size`, or a read-only viewer, makes an entry.
     Its act yields, but `ignore_client_size` leaves it out of sizing, so the window
     falls to some other client's size.
  3. Arriving without acting: a `kill-window` or a `select-window` from a script that
     moves the laptop's session onto W adds an entry. None of those paths sets `latest`
     (only `select-window` with a client, `new-window`, `break-pane`, `spawn`,
     `set_session` and `update_latest` do), so the sentence above is false there. The
     harm is small: the cleared window goes to whoever is `latest`.
- **Check:** The tmux source cited above, on both tags.
- **Fix direction:** Put `#{?#{m:*focused*,#{client_flags}},f,u}` in each entry. In
  `Session`, don't count an entry as an act when the client went from focused to
  unfocused at an unchanged size. Leave out clients whose flags include `ignore-size`.
  Soften the §3.6 sentence to "which is usually that client". Add the focus-out case to
  the §8 real-tmux sizing test.

### L2. The claim's fate across an owner change isn't stated, and the baseline drops acts made during the gap

- **Where:** daemon-core §4.2 ("A moved window keeps its tab: new owner, fresh
  snapshot") and §4.5 (crash and respawn). Neither mentions the claim.
- **Scenario:** The owner crashes and is respawned 1 s later, or the window moves to a
  session with another control client. The hub's `windows` entry, claim included,
  survives. The new owner votes it, and its new subscription's first value is only a
  baseline. If the laptop typed in W during the gap, that act is folded into the
  baseline. The phone keeps a size it should have lost, until the laptop's next key
  that lands in a new second. It heals itself, but the docs never say whether a claim
  survives a rebind at all, so the implementer has to guess.
- **Fix direction:** One sentence in §4.2/§4.5: "a window keeps its claim when it
  rebinds; the new owner votes it; an act during the gap is seen at the other client's
  next act". Add a hub test: claim, owner crash, respawn, `Vote` re-sent on the new
  client.

### L3. "The first value after `Subscribe`" should be anchored to the Subscribe's reply

- **Where:** daemon-core §3.7, the `Acted` bullet.
- **Scenario:** A watch ends and another starts on the same window within a second (a
  quick tab switch, or `DropConn` followed by a reconnect). The hub sends `Unsubscribe`
  then `Subscribe`. If `Session` starts the baseline when it *sends* `Subscribe`, a
  `%subscription-changed` that tmux queued before running the unsubscribe can become
  the baseline. The new subscription's first value then differs, because the laptop
  typed before the new claim, and that yields the claim the re-watch just made.
- **Fix direction:** Specify that the baseline is the first value after the
  `Subscribe`'s reply block. tmux runs commands and its subscription timer on one loop,
  so nothing from the old subscription can follow the `Unsubscribe`'s reply. Drop
  values for that name between the two replies. Add this to the §8 Session tests.

### L4. The band flashes during normal transitions

- **Where:** client-architecture §5.4, "The band shows exactly while the pane is wider
  or taller than the tab's own size".
- **Scenarios:** (a) Opening a tab while the laptop is `latest`: the first snapshot can
  arrive at the laptop's size before the vote's `%layout-change` (§9 risk 8), so the
  band shows briefly and then disappears. (b) Rotating landscape to portrait: the
  sizer's `current` shrinks at once, but the `resize` goes out 150 ms later, so the
  band shows during the debounce and the round trip. (c) Fit and every claim after a
  yield: the band stays up for one round trip.
- **Fix direction:** Compare against the size this tab last *sent*
  (`TerminalSizer.applied`), not `current`. Hide the band while a claim this tab sent
  is waiting on its first `Layout` or snapshot. Add both to the PS-web Playwright gate.

### L5. "Smaller: no band, Fit can't help" is wrong when another tether watch holds the claim

- **Where:** client-architecture §5.4, the Smaller bullet.
- **Scenario:** A phone in portrait (45 columns) holds the claim. The iPad, or the
  desktop browser, shows the same window at 45 columns with no band, although Fit would
  give it 120. "Two phones aren't designed for", so this is low, but the rule as
  written gives the wrong reason.
- **Fix direction:** Reword the reason ("the window is at most the size of the client
  that holds it") and say that with two tether watches, the smaller one wins until the
  other acts. Or accept it explicitly as a cost.

### L6. A taller pane hides its top rows from scrollback as well

- **Where:** client-architecture §5.4, Larger, and §7.6 (scroll, normal screen).
- **Scenario:** `cursorPan` (`web/term/size.ts`) slides by `cursorY` whether or not the
  buffer is scrolled up. With a 50-row pane in a 30-row box, the top 20 rows of xterm's
  viewport stay hidden while scrolling. At `viewportY = 0`, the 20 oldest buffer lines
  are never shown before the DOM history view takes over. This already happens with the
  keyboard up; with this change it happens whenever the laptop holds the window.
- **Fix direction:** While scrolled up, pan from the top (`pan = 0`) and go back to the
  cursor pan at the bottom. Or check that the DOM history view starts at xterm's top
  line plus the hidden rows. Add a P3b check with a pane taller than the tab.

### L7. Naming: "claim" already means something else in the web, and "cwd subscription" is left over

- `web/term/size.ts` `TerminalSizer.claim()`, used by `screens/terminal/terminals.ts:192`
  and in `screens/terminal/.context/CONTEXT.md:16`, already means "take the current
  size for a watch". Once claim is a daemon concept the client mirrors (Fit "claims"),
  the same word names two things in the web layer. Fix: rename the sizer method
  (`take()` or `forWatch()`) in PS-web and in `.context`.
- decisions.md's new entry "The other client's act is seen through the window
  subscription" says "the `w<W>` cwd subscription", and its *Changes* line names only
  "Sizing: client size at attach…". It should also name "The cwd subscription's shape",
  whose `@W:#{pane_current_path}` value it replaces, and use the new name.
- `src/hub/reconcile.rs:199`'s doc comment ("A cwd subscription and a size vote on every
  window the client owns") and `withdraw()`, which clears votes only for windows the
  client no longer owns, both need to change in PS-daemon. Desired votes are now
  "claimed bound windows". Worth naming in the build-plan's PS-daemon line, so a vote
  on an owned but unclaimed window isn't left standing.
- No other text still states the old cap rule: I grepped docs/, the work design docs
  and src/ for "can't grow", "size wins", "cwd subscription" and `37-cwd`. The anchors
  `#37-window-subscription` and `#36-sizing` resolve. `Release` (pane pause) and
  claim/yield don't collide.

### L8. The probe doesn't cover two arrivals the format depends on

- **Where:** probe-latest-activity.md. A second pty attaching was seen only with the
  rejected session-level variant (p117), not the final per-window format. The
  linked-window case (laptop on another session with W current) wasn't run.
- **Fix direction:** Add both to the §8 real-tmux sizing test on 3.4 and 3.7b: a second
  pty attaching onto W, and a pty in a second session linking W. The source says both
  report, but the tests are where a rename would be caught (§9 risk 2).

## Unaffected

- §6 resource limits: still one subscription per watched window. The value grows by
  about 40 bytes per tmux client on that window, and a line arrives at most once a
  second per watched window. Inside tmux, the `L:` loop builds a format tree per client
  per second per watched window, which is negligible next to the existing check. No
  limit or budget changes.
- The hot paths touched: per keystroke `input` now sets the claim and runs the vote
  comparison in reconcile. That is O(1) work, with no op when the vote is already
  applied. Per subscription line, the entry diff is O(clients). Nothing grows with
  history.
- The sizing invariant holds: `terminalSize` reads only the viewport, chrome and cell.
  `cellSize` divides the measured screen by `term.cols`/`term.rows`, so a pane larger
  than the box doesn't feed the sizer. Taps and `cellAt` map through the measured rect,
  pan included.

## Hypotheses (not verified)

- **iOS WebGL at laptop size (M2):** whether WKWebView on a current iPhone refuses,
  downscales or keeps a 17 M-pixel WebGL drawing buffer, and what it does to Web Content
  memory. Blocked: needs the physical iPhone, which is in use elsewhere (build-plan P4).
- **Jimmy's dev-box `focus-events` setting (L1):** there's no `~/.tmux.conf` on this
  Mac, and the server's config isn't reachable from here. If it's off, L1.1 is moot on
  the server.
- **Late-reported act versus a claim:** source-confirmed and accepted in decisions.md.
  I didn't time how often it happens in practice. A 1 s window from typing on the
  laptop to opening the app is unlikely, so I left it out of the findings.
