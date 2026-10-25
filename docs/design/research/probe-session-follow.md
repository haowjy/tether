# Probe: a tab following a tmux session's current window (tmux 3.4 and 3.7b)

**Round-two summary:** On both 3.4 and 3.7b, `refresh-client -B 'c::#{window_id}'` reports the actual current window id, including prefix-n, while ordinary typing/cwd changes do not; swap-window emits no `%session-window-changed`, and every swap that changes the current window, in either direction and with `-d`, sends a `c` value 0.2–0.7 s later (§15). A same-session `switch-client -c C -t '$0'` names the control client via `display-message`, but the resize behavior differs: 3.4 needs a subsequent unchanged `refresh-client -C` to recalculate, while 3.7b resizes on switch; `switch-client ; refresh-client -C` reliably yields the tether vote size on both. Switching has observable session-change/hook/client-session-change and activity/last-attached side effects, but did not change the laptop’s `w<W>` activity entry; the laptop’s real keystroke takes latest back, restores 80×23, and updates that subscription. Clearing the vote restores the control client’s 80×23 or 100×30 client size, then detaching falls back to the laptop’s 80×23. Selection order changes notification order but every ordering ends at 200×50; with the laptop `latest` on both windows, select then switch then vote reflows the selected window once (§16), and plain `send-keys -H 78` still reaches the pane after switching.

**Result: both tmux 3.4 and 3.7b support a session-following tether tab: `select-window -t '$S:@W'` selects the window in the named session, and `%session-window-changed` is broadcast to every control client on the server, not just the one attached to that session. Tether must filter the notification's session id. The event precedes `window-add` for a foreground `new-window`, precedes `layout-change` on a switch, and precedes `window-pane-changed`'s following layout report. The startup display format can return the session's current window and active pane, including session/window ids. A control-client selection does not make that control client or a co-session laptop the window's latest actor; a size vote still caps the existing latest size. When the laptop prefix-switches onto W1, clearing W1's vote restores W1 to the laptop's 120×39 size. With `detach-on-destroy on`, destroying S ends its attached control client; with `off`, the client changes to surviving session T and keeps running.**

## Setup

On macOS arm64, built tmux from upstream tags `3.4` and `3.7b` in `/tmp/probe-p223` (`./configure --disable-utf8proc && make -j4`); Homebrew tmux was 3.8, not used for required results. Each run used a private `-L` socket. Created S with W1 and W2 and T with its own window plus W2 linked in. Control clients were started as `tmux -u -N -L <socket> -C attach-session -t S|T -f pause-after=3` over pipes. The laptop was a real attached pty client (`openpty`, `TIOCSWINSZ`, `TERM=xterm-256color`), set to 120 columns × 40 rows (tmux reports 120×39). Session ids were `$0` for S and `$1` for T; W1=`@0`, W2=`@1`, T's original window=`@2`. Sessions used `window-size latest` for sizing probes. All tmux servers started by this probe were killed.

The notification excerpts below are raw control-mode lines (block ids/timestamps naturally differ). Both versions produced the same event lines and ordering; where an output is shown under both version headings, it was captured independently on each version.

## 1. `%session-window-changed`: recipients, triggers, order

A control client attached to S selecting W2 by the session-and-window-id target succeeded. The control attached to T received the same `$0` event; the notification identifies S's change even on T's control stream:

**3.4**
```text
# S control, `select-window -t 'S:@1'`
%begin 1792944352 294 1
%end 1792944352 294 1
%session-window-changed $0 @1
# T control
%session-window-changed $0 @1
```

**3.7b**
```text
%begin 1792944380 309 1
%end 1792944380 309 1
%session-window-changed $0 @1
# T control
%session-window-changed $0 @1
```

The current window check returned `@1` for S. In a separate linked-window check, selecting `T:@1` made T's current window `@1`; both S and T controls received `%session-window-changed $1 @1`. Thus the notification is server-wide; use its session id to decide whether it changes this tab.

| Trigger | 3.4 raw control lines | 3.7b raw control lines |
|---|---|---|
| (a) Laptop prefix-n from W2 to W1 | S: `%session-window-changed $0 @0` then `%layout-change @0 … *`; T: `%session-window-changed $0 @0` | Same: S and T both got `%session-window-changed $0 @0`, then S's layout line |
| (b) Control `select-window -t 'S:@1'` | Both S and T controls: `%session-window-changed $0 @1` | Both S and T controls: `%session-window-changed $0 @1` |
| (c) One-shot `new-window -t S -n W3 sleep 1000` (no `-d`) | S: `%session-window-changed $0 @3` → `%window-add @3`; T: `%session-window-changed $0 @3` → `%unlinked-window-add @3` | Same order and lines |
| (d) Foreground window whose shell exits (`new-window -t S -n EXIT sh -c 'exit 0'`) | S: `%session-window-changed $0 @3` → `%window-add @3` → `%session-window-changed $0 @0` → `%unlinked-window-close @3`. T saw the corresponding `$0 @3`, `%unlinked-window-add @3`, `$0 @0`, `%unlinked-window-close @3`. | Same order and lines |
| (e) `move-window -s S -t T` moving S's current W1 (`@0`, after the exiting W3 closed) | Both clients saw `%session-window-changed $1 @0` and `%session-window-changed $0 @1`; S also saw `%unlinked-window-add @0` / `%unlinked-window-close @0`, while T saw `%window-add @0` / `%window-close @0`. | Same session-change ids; same linked/unlinked add/close notifications |
| (f) Select linked W2 in T | Both controls: `%session-window-changed $1 @1` | Both controls: `%session-window-changed $1 @1` |

The move-window excerpt on 3.4 included this exact ordering at the S control:
```text
%unlinked-window-add @0
%session-window-changed $1 @0
%session-window-changed $0 @1
%unlinked-window-close @0
```
3.7b had the same ordering. (At that point the moved window id was `@0`; window ids depend on setup order.) The 3.4 prefix-n excerpt was:
```text
%session-window-changed $0 @0
%layout-change @0 ccfd,120x39,0,0,0 ccfd,120x39,0,0,0 *
%subscription-changed w2 $0 @1 1 - : |/Users/jimmyyao/repos/tether
```
3.7b produced the same sequence. Thus the session change precedes layout and subscription updates. Creating an immediately exiting window also demonstrated that the intermediate foreground selection is observable before the window closes.

`%window-pane-changed` for a split of linked W2 was likewise delivered to both controls, including the control attached to the other session. Raw lines:
```text
%window-pane-changed @1 %4
%layout-change @1 526d,60x30,0,0[60x15,0,0,1,60x14,0,16,4] 526d,60x30,0,0[60x15,0,0,1,60x14,0,16,4] *
```
Same on 3.4 and 3.7b; `window-pane-changed` preceded the layout line.

## 2. Id targets and linked windows

`select-window -t 'S:@1'` returned a successful `%begin`/`%end` and made S current window `@1`; this is a valid id target, not only a window-index target. The target's session component addressed S, not the other session's current-window state. When the same linked `@1` was selected as `T:@1`, `display-message -p -t T '#{window_id}'` returned `@1`, while both controls received the session-specific event `$1 @1`. The session component of the target disambiguates a linked window correctly.

## 3. `window-size latest`, votes, and subscription baseline

With `window-size latest`, the control client set `refresh-client -C '@1:60x30' ; select-window -t 'S:@1'`. W2 became 60×30 both when no laptop was attached and when the laptop was attached at 120×40. The control client's `select-window` did not make the control client or laptop latest for W2: in a discriminating run, W2 began at 90×28, control-client size was 80×24, and the laptop had attached/resized W1 to 120×39 but had never acted on W2. After the control client voted 60×30 and selected W2, clearing the vote restored W2 to 90×28 (not control 80×24 or laptop 120×39). So selection did not install either client as W2's latest actor; the preexisting W2 size remained.

**3.4, no laptop, vote then select**
```text
%begin 1792944353 300 1
%end 1792944353 300 1
%begin 1792944353 301 1
%end 1792944353 301 1
%layout-change @1 a3de,60x30,0,0,1 a3de,60x30,0,0,1 *
%session-window-changed $0 @1
# one-shot display-message -p -t @1 '#{window_width}x#{window_height}'
60x30
```
**3.7b, same no-laptop sequence:** identical layout and session-change lines; one-shot returned `60x30`.

For the laptop-attached case, the selected W2 was 60×30 on both versions. A `w2` subscription was created after the switch using daemon-core §3.7's `<acts>` expression. Its first value included the laptop, with its activity timestamp from attach (`1792944488` on 3.4; `1792944504` on 3.7b), and a subsequent control-client select did not advance that timestamp or emit a laptop-act update. Once the baseline was taken after the switch, the subscription stayed quiet until the laptop itself prefix-switched away; that act changed the value to empty. The format was:
```text
refresh-client -B 'w2:@1:#{L:#{?client_height,#{?client_control_mode,,#{?#{m:*#,#{client_name}#,*,#,#{window_active_clients_list}#,},#{client_name}.#{client_activity}.#{client_width}x#{client_height}.#{client_flags};,}},}}|#{pane_current_path}'
```
Raw baseline and subsequent actual laptop act on 3.4:
```text
%subscription-changed w2 $0 @1 1 - : /dev/ttys047.1792944488.120x40.attached,focused,UTF-8;|/Users/jimmyyao/repos/tether
%subscription-changed w2 $0 @1 1 - : |/Users/jimmyyao/repos/tether
```
On 3.7b:
```text
%subscription-changed w2 $0 @1 1 - : /dev/ttys045.1792944504.120x40.attached,focused,UTF-8;|/Users/jimmyyao/repos/tether
%subscription-changed w2 $0 @1 1 - : |/Users/jimmyyao/repos/tether
```
The second line is after laptop prefix-n moved the shared session to W1; it is not a report that the control selection made the laptop act.

## 4. Laptop prefix-n, vote clear

With the laptop on W2 at 120×40, a 60×30 vote on W1 (`@0`) changed W1 from 80×24 to 60×30. The laptop's real prefix-n key moved S to W1; the control client received `%session-window-changed $0 @0`. Clearing W1's vote (`refresh-client -C '@0:'`), as tether should when this act is observed, restored W1 to the laptop's 120×39. W2 had no vote and remained 120×39. The same sequence and dimensions were observed on 3.4 and 3.7b.

3.4 raw clear-vote result (3.7b gave the same layout lines):
```text
%begin 1792944628 303 1
%end 1792944628 303 1
%layout-change @0 ccfd,120x39,0,0,0 ccfd,120x39,0,0,0 *
%layout-change @1 ccfe,120x39,0,0,1 ccfe,120x39,0,0,1 -
# one-shot sizes after clear
120x39
120x39
```
Earlier direct combined vote/switch capture on both versions also showed the laptop's 120×39 W1 size and W2's independent 60×30 vote:
```text
%session-window-changed $0 @0
%layout-change @0 ccfd,120x39,0,0,0 ccfd,120x39,0,0,0 *
# one-shot sizes after prefix-n
120x39
60x30
```

## 5. Startup display format and missing session

A single `display-message -p -t '$0'` with tab-separated fields returned the current window and its active pane; adding session and window ids to the startup format works. On both versions the raw reply was:
```text
%begin 1792944352 293 1
$0\t@0\t0\t%0\t80\t24\tW1
%end 1792944352 293 1
```
Format, in order: `#{session_id}\t#{window_id}\t#{window_index}\t#{pane_id}\t#{pane_width}\t#{pane_height}\t#{window_name}`. For a missing session target `$9999`, tmux succeeded and printed one line of empty fields (six tab separators), rather than an error, on each version:
```text
%begin 1792944528 273 1
\t\t\t\t\t\t
%end 1792944528 273 1
```

## 6. Session destruction and `detach-on-destroy`

Ran each case with another surviving session T and a control client attached to S.

| Version and option | Close S's last window | `kill-session -t S` |
|---|---|---|
| 3.4, `on` (default) | S control: `%sessions-changed` → `%exit` (process exited); T control saw S's window close and `%client-detached`. | S control: `%sessions-changed` → `%exit`; T control saw `%sessions-changed`, window close, and `%client-detached`. |
| 3.4, `off` | S control: `%unlinked-window-close @0` → `%session-changed $1 T` → `%sessions-changed`; it stayed alive. | S control: `%session-changed $1 T` → `%sessions-changed` → `%unlinked-window-close @0`; it stayed alive. |
| 3.7b, `on` (default) | Same as 3.4; S control got `%exit`. | Same as 3.4; S control got `%exit`. |
| 3.7b, `off` | Same as 3.4; S control switched to `$1 T` and stayed alive. | Same as 3.4; S control switched to `$1 T` and stayed alive. |

Representative raw 3.4 `off`, last-window case (3.7b identical):
```text
%unlinked-window-close @0
%session-changed $1 T
%sessions-changed
```
Representative raw `on` case, both versions:
```text
%sessions-changed
%exit
```
So the default makes the daemon's control client terminate when its session disappears. With `off`, tmux retargets it to the surviving session rather than exiting; tether would need to account for that if it uses this option.

## 7. Cost / notification rate

No cost benchmark was run. The tested one-shot and selection operations produced a handful of lines per action; no uncontrolled notification storm was observed. No held-key rate measurement was made.


## 8. Current-window subscription (`c::#{window_id}`): questions 1–5

**Result:** Both versions’ first value is the current `@0`; after the laptop prefix-n switches S from W1 to W2, the value changes to `@1` alongside the session-window event. A swap of indices 1→0 changes `c` to `@1` but emits no `%session-window-changed`; with a three-second wait, each of three reverse swaps (current window as source) reports the new `@0` value on both versions within 0.21–0.68 s of the one-shot return. A second link of W2 at index 5 and selecting it did not change `c`, because the selected linked window retained id `@1`. Typing for five seconds, idle time, and a cwd change produced no additional `c` value. `refresh-client -B 'c'` succeeded and no later value was seen.

**Setup deltas:** Started S with W1=`@0` current, W2=`@1`, plus the actual 80×24 PTY laptop and control client. Subscribed using the requested format. Laptop prefix-n was bytes `\x02n` written to the PTY master. The swap used one-shot `swap-window -s S:1 -t S:0`, then `swap-window -s S:0 -t S:1` (the latter’s source was the current window). Link/select used `link-window -s S:W2 -t S:5` and `select-window -t '$0:5'`.

**3.4 raw control-mode excerpts**
```text
%begin 1792947159 298 1
%end 1792947159 298 1
%subscription-changed c $0 - - - : @0
%session-window-changed $0 @1
%subscription-changed c $0 - - - : @1
# after select of linked @1 at index 5: no c line; only window/session notifications
%window-add @1
%session-window-changed $0 @1
# five seconds of typing: no c line; only pane output, e.g.
%extended-output %1 0 : ab
%extended-output %1 0 : cde
%begin 1792947143 305 1
%end 1792947143 305 1
# unsubscribe; no subsequent c line
```

**3.7b raw control-mode excerpts**
```text
%begin 1792947173 313 1
%end 1792947173 313 1
%subscription-changed c $0 - - - : @0
%session-window-changed $0 @1
%subscription-changed c $0 - - - : @1
%window-add @1
%session-window-changed $0 @1
%extended-output %1 0 : abcde
# five seconds idle/typing: no c line
%extended-output %1 0 : \015\012sh-3.2$ 
%extended-output %1 0 : cd /tmp\015\012sh-3.2$ 
# valid `cd /tmp` produced no c line
%begin 1792947149 320 1
%end 1792947149 320 1
# unsubscribe; no subsequent c line
```

A separate swap capture on both versions showed the first swap’s lone subscription update and no session-window event:
```text
%subscription-changed c $0 - - - : @1
```
The three reverse swaps’ final `display-message -p -t '$0' '#{window_id}'` returned `@0` each time; with sufficient observation time, every reverse swap emitted a `c` value (`@0`) on both versions. The earlier 0.5-second window had simply ended before the once-per-second subscription check. The one-shot link/select command itself returned success; same-id selection produced no subscription value. Unsubscribe reply was `%begin … 1` / `%end … 1` on both versions.

## 9. Control client name and making it latest (questions 6–7)

**Result:** A control client can learn its own name by sending `display-message -p '#{client_name}'` on its own control stream; it returned a `client-<pid>` name on both. With laptop input made latest after a 200×50 control vote, the window stayed 80×23. Same-session switch alone did not resize on 3.4, but did resize on 3.7b. Re-sending the unchanged vote recalculates on both. The minimal reliable combined group is `switch-client -c C -t '$0' ; refresh-client -C '@0:200x50'`; it resized to 200×50 on both.

**Setup deltas:** Created the 200×50 vote, then wrote a real laptop byte to the PTY to make its 80×24 client latest again (tmux window size 80×23). Tested the same-session switch, repeat vote, and combined group. The combined group was executed as one control-mode command line with literal semicolon separators.

**3.4 raw control-mode excerpts**
```text
%begin 1792947201 298 1
client-52732
%end 1792947201 298 1
# after laptop input, switch alone:
%begin 1792947204 321 1
%end 1792947204 321 1
%session-changed $0 S
# window remained 80x23; unchanged vote then recalculated:
%layout-change @0 ac9d,200x50,0,0,0 ac9d,200x50,0,0,0 *
%begin 1792947205 327 1
%end 1792947205 327 1
%layout-change @0 ac9d,200x50,0,0,0 ac9d,200x50,0,0,0 *
# switch ; refresh-client group after laptop latest:
%begin 1792947587 307 1
%end 1792947587 307 1
%begin 1792947587 308 1
%end 1792947587 308 1
%session-changed $0 S
%layout-change @0 ac9d,200x50,0,0,0 ac9d,200x50,0,0,0 *
```

**3.7b raw control-mode excerpts**
```text
%begin 1792947208 313 1
client-52773
%end 1792947208 313 1
# after laptop input, switch alone:
%begin 1792947211 336 1
%end 1792947211 336 1
%session-changed $0 S
%layout-change @0 ac9d,200x50,0,0,0 ac9d,200x50,0,0,0 *
# re-sending unchanged vote also recalculated:
%begin 1792947212 342 1
%end 1792947212 342 1
%layout-change @0 ac9d,200x50,0,0,0 ac9d,200x50,0,0,0 *
# switch ; refresh-client group after laptop latest:
%begin 1792947594 322 1
%end 1792947594 322 1
%begin 1792947594 323 1
%end 1792947594 323 1
%session-changed $0 S
%layout-change @0 ac9d,200x50,0,0,0 ac9d,200x50,0,0,0 *
```

The group produced the layout line in the same collected control reply batch. The observed 3.4 reason to retain the refresh after switch is behavioral: switch alone did not recalculate to the new latest client, while the unchanged per-window vote did. 3.7b recalculated at switch; retaining the refresh gives one sequence that works on both.

## 10. Same-session switch side effects (question 8)

**Result:** On both versions, the owner receives `%session-changed $0 S`, T’s control client receives `%client-session-changed <owner> $0 S`, and the global `client-session-changed` hook fires. No `%session-window-changed` was observed. `session_activity` and `session_last_attached` both advance at the switch. The laptop’s `w0` activity line stays unchanged at the switch (a later laptop key updates it). With `focus-events on`, no focus-in/out bytes were observed in the pane on switch. For the bell check, a BEL emitted by W2 while W2 was non-current set W2’s bell flag to 1, W1’s remained 0, and switching did not clear either flag.

**Setup deltas:** Attached a second control client to T. Set a global `client-session-changed` hook that appended to `/tmp/p-round2-p231/hook-<version>`. Used daemon-core §3.7’s window-client list expression under `w0`. For the focus check, enabled `focus-events` and ran a focus-reporting/cat pane; the control stream and pane capture showed no switch-generated focus pulse. Focus was simulated only through the PTY, so this establishes no observed switch pulse in this harness, not behavior of a physically focused terminal. For flags, executed `printf '\a'` in non-current W2 and queried `#{window_bell_flag}` for both windows.

**3.4 raw control-mode excerpts**
```text
# T control's initial attach
%session-changed $1 T
# on same-session switch, owner stream
%begin 1792947234 319 1
%end 1792947234 319 1
%session-changed $0 S
# T stream
%client-session-changed client-52871 $0 S
# w0 subscription before switch, then no w0 line during switch:
%subscription-changed w0 $0 @0 0 - : /dev/ttys042.1792947229.80x24.attached,focused,UTF-8;|/private/tmp/p-round2-p231
```
`session_activity session_last_attached` output changed from `1792947229 1792947229` to `1792947234 1792947234`; hook file contained `fired`. Bell queries returned W1=`0`, W2=`1` before and after switching. The switch stream contained no `%session-window-changed` and no focus-report payload.

**3.7b raw control-mode excerpts**
```text
%session-changed $1 T
%begin 1792947245 334 1
%end 1792947245 334 1
%session-changed $0 S
%client-session-changed client-52907 $0 S
%subscription-changed w0 $0 @0 0 - : /dev/ttys044.1792947240.80x24.attached,focused,UTF-8;|/private/tmp/p-round2-p231
```
`session_activity session_last_attached` changed from `1792947240 1792947240` to `1792947245 1792947245`; hook file contained `fired`. Bell queries again returned W1=`0`, W2=`1` before and after switch. No `%session-window-changed` or focus-report payload appeared on switch.

## 11. Laptop takes latest back (question 9)

**Result:** After tether is made latest at 200×50 (using the reliable group above), a real laptop key returns W1 to 80×23 on both versions. The `w0` subscription reports the laptop’s new `client_activity` timestamp within the next 0.5 s polling interval (the PTY act itself was sent after a 1.1 s wait to ensure a different second-resolution timestamp).

**Setup deltas:** Kept the real laptop attached at 80×24 and subscribed to the laptop entry using the §3.7 format. Sent a real PTY byte `b` after the control group and captured the subscription stream.

**3.4 raw control-mode excerpts**
```text
%session-changed $0 S
%layout-change @0 ac9d,200x50,0,0,0 ac9d,200x50,0,0,0 *
# laptop byte b
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 *
%extended-output %0 0 : \015\033[Ksh-3.2$ ab
%subscription-changed w0 $0 @0 0 - : /dev/ttys042.1792947505.80x24.attached,focused,UTF-8;|/private/tmp/p-round2-p231
```

**3.7b raw control-mode excerpts**
```text
%session-changed $0 S
%layout-change @0 ac9d,200x50,0,0,0 ac9d,200x50,0,0,0 *
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 *
%extended-output %0 0 : \015\033[Ksh-3.2$ ab
%subscription-changed w0 $0 @0 0 - : /dev/ttys046.1792947515.80x24.attached,focused,UTF-8;|/private/tmp/p-round2-p231
```
The reported post-act `client_activity` values differ by five seconds from the preceding laptop act; tmux’s formatted timestamp has one-second granularity.

## 12. Clearing tether’s vote and detaching (question 10)

**Result:** With control client size 80×23, clearing the window vote after control became latest restores 80×23. With a distinctive control-client size of 100×30, clearing the vote restores 100×30 on both versions, without laptop input between clearing and measurement. Detaching the control client then restores the laptop-driven 80×23. The 3.4 switch-alone step did not resize immediately; after `refresh-client -C '@0:'`, recalculation selected the 100×30 control-client size. 3.7b switched directly to 200×50, and clear restored 100×30.

**Setup deltas:** Set client size with `refresh-client -C 100x30`, voted `@0:200x50`, then made laptop latest with a real PTY key. Switched control client to S; cleared `@0:`; measured; detached control client; measured again.

**3.4 raw control-mode excerpts**
```text
%begin 1792947305 300 1
%end 1792947305 300 1
%layout-change @0 a87d,100x30,0,0,0 a87d,100x30,0,0,0 *
# switch; window remained laptop-sized 80x23
%begin 1792947306 312 1
%end 1792947306 312 1
%session-changed $0 S
# clear; final layout after vote removal is 100x30
%begin 1792947307 318 1
%end 1792947307 318 1
%layout-change @0 a87d,100x30,0,0,0 a87d,100x30,0,0,0 *
# detach control client
%begin 1792947307 323 1
%end 1792947307 323 1
%exit
```

**3.7b raw control-mode excerpts**
```text
%begin 1792947323 315 1
%end 1792947323 315 1
%layout-change @0 a87d,100x30,0,0,0 a87d,100x30,0,0,0 *
%begin 1792947324 327 1
%end 1792947324 327 1
%session-changed $0 S
%layout-change @0 ac9d,200x50,0,0,0 ac9d,200x50,0,0,0 *
%begin 1792947325 333 1
%end 1792947325 333 1
%layout-change @0 a87d,100x30,0,0,0 a87d,100x30,0,0,0 *
%begin 1792947326 338 1
%end 1792947326 338 1
%exit
```
One-shot size queries returned `100x30` after clear and `80x23` after detach for each version.

## 13. Selecting W2 and switching order (question 11)

**Result:** W2 ended at 200×50 on both versions in both command orders. Each group generated two `%layout-change` lines (W1’s 80×23 layout line and W2’s 200×50 layout line). All three command `%begin`/`%end` replies arrived before the layout/notification batch. Selecting before switch yielded `%session-window-changed` then `%session-changed`; switching before select yielded `%session-changed` then `%session-window-changed`.

**Setup deltas:** W1=`@0` was laptop-current at 80×24; W2=`@1`. Ran the requested `refresh-client -C '@1:200x50'`, `select-window -t '$0:@1'`, and same-session switch, first in select-then-switch order and then switch-then-select.

**3.4 raw excerpts (select before switch)**
```text
%begin 1792947369 300 1
%end 1792947369 300 1
%begin 1792947369 301 1
%end 1792947369 301 1
%begin 1792947369 302 1
%end 1792947369 302 1
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 -
%layout-change @1 ac9e,200x50,0,0,1 ac9e,200x50,0,0,1 *
%session-window-changed $0 @1
%session-changed $0 S
```
**3.4 raw excerpts (switch before select)**
```text
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 -
%layout-change @1 ac9e,200x50,0,0,1 ac9e,200x50,0,0,1 *
%session-changed $0 S
%session-window-changed $0 @1
```

**3.7b raw excerpts (select before switch)**
```text
%begin 1792947382 315 1
%end 1792947382 315 1
%begin 1792947382 316 1
%end 1792947382 316 1
%begin 1792947382 317 1
%end 1792947382 317 1
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 -
%layout-change @1 ac9e,200x50,0,0,1 ac9e,200x50,0,0,1 *
%session-window-changed $0 @1
%session-changed $0 S
```
**3.7b raw excerpts (switch before select)**
```text
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 -
%layout-change @1 ac9e,200x50,0,0,1 ac9e,200x50,0,0,1 *
%session-changed $0 S
%session-window-changed $0 @1
```
In each case the three command replies were `%begin … 1` / `%end … 1`. The layout/notification batch arrived after them. Both switch placements left W2 at `200x50` per one-shot `display-message`.

## 14. Plain raw `send-keys` after switch (question 12)

**Result:** Yes. `send-keys -t @0 -H 78` (without `-K`) delivered lowercase `x` to the W1 pane after same-session switch on both versions; capture-pane showed `sh-3.2$ x`.

**Setup deltas:** Fresh session, switch control client to `$0`, send one hex byte with the existing raw pane-input path, and inspect control output plus `capture-pane`.

**3.4 raw control-mode lines**
```text
%begin 1792947378 302 1
%end 1792947378 302 1
%extended-output %0 0 : x
```
`capture-pane -p -t %0` returned `sh-3.2$ x`.

**3.7b raw control-mode lines**
```text
%begin 1792947391 317 1
%end 1792947391 317 1
%extended-output %0 0 : x
```
`capture-pane -p -t %0` returned `sh-3.2$ x`.


## 15. Swap subscription updates with a longer observation window

**Result:** With `c::#{window_id}` subscribed, all six ordinary swaps (three `S:1`→`S:0`, each followed by `S:0`→`S:1` with the current window as source) emitted the changed current id on both versions. The `c` line arrived 0.21–0.68 s after the one-shot command returned; none emitted `%session-window-changed`. This resolves the earlier 0.5-second observation: the reverse-swap subscription does update, but only at the next periodic check. `swap-window -d -s S:1 -t S:0` also emitted a `c` update and changed the current id to `@1` in this three-window setup. Swapping two non-current windows left current `@1` unchanged and emitted no `c` line during the three-second wait.

**Setup deltas:** Each version used a fresh isolated server with W1=`@0` current, W2=`@1`, W3=`@2`, the 80×24 PTY laptop and control client at 80×23. The control client subscribed with `refresh-client -B 'c::#{window_id}'`. For each of the six ordinary swaps, a one-shot `tmux swap-window` was timed through its return; a reader polled control output every 50 ms for the following three seconds. Delay below is from one-shot return to the reader timestamp of the `c` line. Then tested the `-d` variant and a non-current W2/W3 swap.

**3.4 raw control-mode excerpts** (each `c` event below was independently received within 0.21–0.68 s after its corresponding one-shot returned):
```text
# swap-window -s S:1 -t S:0 (repeated 3 times)
%subscription-changed c $0 - - - : @1
%subscription-changed c $0 - - - : @1
%subscription-changed c $0 - - - : @1
# swap-window -s S:0 -t S:1 (current window as source, repeated 3 times)
%subscription-changed c $0 - - - : @0
%subscription-changed c $0 - - - : @0
%subscription-changed c $0 - - - : @0
# swap-window -d -s S:1 -t S:0
%subscription-changed c $0 - - - : @1
# swap-window -s S:1 -t S:2 (both non-current); no c line in 3 s
```
Measured delays, in command order: `0.675, 0.558, 0.450, 0.366, 0.297, 0.207 s`. The final current id after the six swaps was `@0`; after the `-d` swap it was `@1`; the non-current swap left it `@1`. No `%session-window-changed` was received for these swap operations.

**3.7b raw control-mode excerpts** (same independent three-second observation):
```text
# swap-window -s S:1 -t S:0 (repeated 3 times)
%subscription-changed c $0 - - - : @1
%subscription-changed c $0 - - - : @1
%subscription-changed c $0 - - - : @1
# swap-window -s S:0 -t S:1 (current window as source, repeated 3 times)
%subscription-changed c $0 - - - : @0
%subscription-changed c $0 - - - : @0
%subscription-changed c $0 - - - : @0
# swap-window -d -s S:1 -t S:0
%subscription-changed c $0 - - - : @1
# swap-window -s S:1 -t S:2 (both non-current); no c line in 3 s
```
Measured delays in command order: `0.680, 0.595, 0.500, 0.407, 0.326, 0.231 s`. Final current ids were likewise `@0`, then `@1`, and `@1`. No `%session-window-changed` was received for swaps.

## 16. Selecting W2 when laptop is latest, including unchanged vote

**Result:** On both versions, all three fresh-server groups ended with W2 at 200×50. Group (a) and (b) each emitted two W2 `%layout-change` lines: (a) showed the voted 200×50 layout twice, while (b) first emitted an unchanged-size 80×23 layout on selection, then 200×50 after the switch. Group (c) emitted one W2 layout change, directly to 200×50. Thus all sequences reached the target, and (c) did so with the fewest W2 layout notifications. On 3.4, group (b) confirms the follow-up unchanged `refresh-client -C` is needed after `switch-client` for the intended resize; group (a)'s final re-send supplies it. After (a), repeating `switch-client -c C -t '$0' ; refresh-client -C '@1:200x50'` produced an unchanged `%layout-change @1` on each version (as well as an unchanged W1 layout line), not silence.

**Setup deltas:** Each group ran on its own fresh isolated server per tmux version. A real 80×24 laptop PTY acted on W2 (`C-b n`, typed `x`), then W1 (`C-b p`, typed `x`), leaving it latest on both windows; both displayed 80×23. The control client's size was 80×23. `C` in the requested commands was replaced with the name returned by `display-message -p '#{client_name}'` sent on that control stream (`client-<pid>`). Each command group's replies are shown as consecutive `%begin`/`%end` pairs. Excerpts omit asynchronous pane-output lines; they preserve all command replies, layout notifications, and session/window notifications in order.

**3.4 raw control-mode excerpts**

Group (a), `refresh-client -C '@1:200x50' ; select-window -t '$0:@1' ; switch-client -c C -t '$0' ; refresh-client -C '@1:200x50'` (four successful replies, two W2 layout lines):
```text
%begin 1792947895 320 1
%end 1792947895 320 1
%begin 1792947895 321 1
%end 1792947895 321 1
%begin 1792947895 322 1
%end 1792947895 322 1
%begin 1792947895 323 1
%end 1792947895 323 1
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 -
%layout-change @1 ac9e,200x50,0,0,1 ac9e,200x50,0,0,1 *
%session-window-changed $0 @1
%session-changed $0 S
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 -
%layout-change @1 ac9e,200x50,0,0,1 ac9e,200x50,0,0,1 *
```
Repeat after (a), same-session switch and unchanged vote:
```text
%begin 1792947896 339 1
%end 1792947896 339 1
%begin 1792947896 340 1
%end 1792947896 340 1
%session-changed $0 S
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 -
%layout-change @1 ac9e,200x50,0,0,1 ac9e,200x50,0,0,1 *
```
Group (b) (three successful replies; W2 first has unchanged 80×23, then changes to 200×50):
```text
%begin 1792947905 320 1
%end 1792947905 320 1
%begin 1792947905 321 1
%end 1792947905 321 1
%begin 1792947905 322 1
%end 1792947905 322 1
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 -
%layout-change @1 ae5e,80x23,0,0,1 ae5e,80x23,0,0,1 *
%session-window-changed $0 @1
%session-changed $0 S
%layout-change @1 ac9e,200x50,0,0,1 ac9e,200x50,0,0,1 *
```
Group (c) (three successful replies; one W2 layout change):
```text
%begin 1792947911 320 1
%end 1792947911 320 1
%begin 1792947911 321 1
%end 1792947911 321 1
%begin 1792947911 322 1
%end 1792947911 322 1
%session-window-changed $0 @1
%session-changed $0 S
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 -
%layout-change @1 ac9e,200x50,0,0,1 ac9e,200x50,0,0,1 *
```

**3.7b raw control-mode excerpts**

Group (a) (four successful replies, two W2 layout lines):
```text
%begin 1792947916 335 1
%end 1792947916 335 1
%begin 1792947916 336 1
%end 1792947916 336 1
%begin 1792947916 337 1
%end 1792947916 337 1
%begin 1792947916 338 1
%end 1792947916 338 1
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 -
%layout-change @1 ac9e,200x50,0,0,1 ac9e,200x50,0,0,1 *
%session-window-changed $0 @1
%session-changed $0 S
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 -
%layout-change @1 ac9e,200x50,0,0,1 ac9e,200x50,0,0,1 *
```
Repeat after (a), same-session switch and unchanged vote:
```text
%begin 1792947917 354 1
%end 1792947917 354 1
%begin 1792947917 355 1
%end 1792947917 355 1
%session-changed $0 S
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 -
%layout-change @1 ac9e,200x50,0,0,1 ac9e,200x50,0,0,1 *
```
Group (b) (three successful replies; W2 first has unchanged 80×23, then changes to 200×50):
```text
%begin 1792947922 335 1
%end 1792947922 335 1
%begin 1792947922 336 1
%end 1792947922 336 1
%begin 1792947922 337 1
%end 1792947922 337 1
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 -
%layout-change @1 ae5e,80x23,0,0,1 ae5e,80x23,0,0,1 *
%session-window-changed $0 @1
%session-changed $0 S
%layout-change @1 ac9e,200x50,0,0,1 ac9e,200x50,0,0,1 *
```
Group (c) (three successful replies; one W2 layout change):
```text
%begin 1792947928 335 1
%end 1792947928 335 1
%begin 1792947928 336 1
%end 1792947928 336 1
%begin 1792947928 337 1
%end 1792947928 337 1
%session-window-changed $0 @1
%session-changed $0 S
%layout-change @0 ae5d,80x23,0,0,0 ae5d,80x23,0,0,0 -
%layout-change @1 ac9e,200x50,0,0,1 ac9e,200x50,0,0,1 *
```
In every group, the one-shot final `display-message` size query returned `200x50` for W2, and the current window was `@1`. In the repeat after (a), W2 remained `200x50`; the `%layout-change` line is unchanged in dimensions/layout data.
