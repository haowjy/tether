# Probe: terminal bell detection in tmux

Date: 2026-10-27. Probe mode; no tether source edits. **Update p314: 3.4 and 3.7b now tested on Pop!_OS; results below supersede the historical unverified statements in the 3.8 sections.** The original p310 report follows.

Historical p310 status: The Mac reports `/opt/homebrew/bin/tmux -V` → `tmux 3.8`. The requested Pop!_OS checks did not run: `ssh -o BatchMode=yes -o ConnectTimeout=8 pop-os '/usr/bin/tmux -V; /usr/local/bin/tmux -V'` returned `jimmyyao@pop-os: Permission denied (publickey,password).` I did not touch that host. Thus the 3.4/3.7b rows below are explicitly unverified, not inferred from 3.8. Upstream tmux manual/catalog pages identify subscriptions and alert hooks/formats as present since 3.2a, but do not substitute for those runtime probes.

## Pop!_OS follow-up: tmux 3.4 and 3.7b (p314)

Connected with `ssh -o BatchMode=yes jimyao@pop-os`. `/usr/bin/tmux -V` returned `tmux 3.4`; `/usr/local/bin/tmux -V` returned `tmux 3.7b`. Both binaries were run separately against isolated `-L probe-bell-p314 -f /dev/null` servers, with sessions `alpha`, `beta`, a current window 0 and hidden window 1. Bells were generated with `send-keys -l "printf '\\007'"`, then `send-keys C-m`, followed by 0.45 seconds. Each server was killed; no config edited. 3.4 and 3.7b gave the same results in the checks below.

| Question | 3.4 | 3.7b |
|---|---|---|
| 1 detached current | flag 1, `session_alerts=0!`, activity 0 | same |
| 2 control attached | `%output %0 \\007`; current flag 0; no distinct bell notification observed | same |
| 3 global hook and gating | Global hook receives session and window identity, sets session option; current/other matrix below | same |
| 4 subscription | `@*` reported attached session windows; hidden flag change observed; no cross-session subscription test in this follow-up | same |
| 5 clearing | select hidden window clears its flag; reselect detached current does not; attach clears current; `kill-session -C` clears | same |

### Exact working global hook and scope

```sh
# Here TMUX means either /usr/bin/tmux or /usr/local/bin/tmux,
# always invoked with -L probe-bell-p314 -f /dev/null.
TMUX set-hook -g alert-bell 'set-option -F @probe "hook=#{hook_session},session=#{session_id},window=#{hook_window}"'
```

The hook executes `set-option` in the alerted session's context; `-F` expands the *value*. Observed current alpha: `hook=$0,session=$0,window=@0`; hidden alpha: `hook=$0,session=$0,window=@1`; beta: `hook=$1,session=$1,window=@2`. Thus one global hook recorded which of two sessions rang in each session's own user option. **Do not use `set-option -t "#{hook_session}" ...`**: the target was not format-expanded in this test, and no marker was set, on either version. A prior shell command failure must not be mistaken for a hook not firing.

**Important override:** a session-local `alert-bell` hook masks the global hook, rather than running in addition to it. With a global hook writing `@global-mark` and an alpha session hook writing `@local-mark`, a bell in alpha yielded `global=|local=yes`; beta yielded `global=$1|local=` on both versions. Therefore a global hook alone does **not** cover every session if users have session-local alert hooks. Installation must inspect and account for local hooks and future session/hook changes; do not claim universal coverage.

### Gating matrix and hook arrays

For each version, with `monitor-bell=on`, the current and other window both acquired flags regardless of `bell-action`. The `@probe` hook marker was set as follows:

| bell-action | current | other |
|---|---|---|
| any | yes | yes |
| current | yes | no |
| other | no | yes |
| none | no | no |

With `monitor-bell=off` on alpha:0, the observed `window_bell_flag|session_alerts|@probe` was `0||`. Defaults were `monitor-bell=1`, `bell-action=any`, `visual-bell=off`. Other visual-bell/activity combinations in the older 3.8 probe were not rerun on the target versions.

Non-clobbering array demonstration, both versions:

```sh
TMUX set-hook -g 'alert-bell[3]' 'set-option -g @user-hook yes'
TMUX set-hook -ag alert-bell 'set-option -F @probe "appended:#{hook_session}:#{session_id}"'
TMUX show-hooks -g alert-bell
# alert-bell[0] set-option -F @probe "appended:#{hook_session}:#{session_id}"
# alert-bell[3] set-option -g @user-hook yes
# bell in beta => @user-hook=yes, beta @probe=appended:$1:$1
TMUX set-hook -gu 'alert-bell[0]'
# Remaining: alert-bell[3] set-option -g @user-hook yes
# next bell => @user-hook=yes, beta @probe remains unset
```

`-a` selected the first available index (0), not necessarily a larger index than the existing 3. A daemon must identify its exact installed array entry and remove only that entry, checking its contents immediately before removal; concurrent hook edits and daemon crashes complicate safe ownership/cleanup. A blanket unset would remove user hooks. This demo was global, not a full solution for session-local overrides.

### Control protocol and clearing excerpts

Both versions: attached control client's current-pane bell produced `%output %0 \\007`; `alpha|0|0||` was the flag/alert/marker state. No `%bell` or `%window-bell` appeared in the capture. The client also received hidden-pane `%output` and the subscription:

```text
%subscription-changed bell $0 @0 0 - : 0
%subscription-changed bell $0 @1 1 - : 0
%subscription-changed bell $0 @1 1 - : 1
```

`refresh-client -B 'bell:@*:#{window_bell_flag}'` was sent to the live control connection. Only alpha had windows in this excerpt; unlike p310, this follow-up did not explicitly ring beta while measuring subscription coverage. On both versions, `alpha:1` had flag 1 before `select-window -t alpha:1`, then 0; a detached alpha:0 bell had flag 1 before and after reselecting alpha:0, but attaching a control client changed it to 0; `kill-session -C -t alpha` cleared the flag. These operations change shared tmux state, not a phone-private marker.

### Revised recommendation

Streamed pane BEL detection and an independent tether read marker remain appropriate, subject to app BEL behavior. Global `alert-bell` can record a per-session marker with the exact `set-option -F` command above on **both** required versions, without polling. However it is conditional on `monitor-bell`, `bell-action`, **and inheritance of the global hook**. A local hook shadows the global one, so cover local overrides without clobbering them or explicitly accept missed sessions; design must handle changes after startup, exact array ownership, crash recovery, and marker cleanup. Do not promise comprehensive detection from a single global hook. No CPU, wakeup, or phone-network measurements were made. The 3.8 byte counts below remain specific examples, not comparative benchmarks.

## Setup and method

All runtime tests used the isolated socket `probe-bell-p310`, `/dev/null` config, and synthetic sessions `s`, `outside`; all probe servers were killed with `tmux -L probe-bell-p310 kill-server`. No user tmux server or config was touched. A test bell was generated inside a pane by `tmux ... send-keys -t s:0.0 -l "printf '\\007'"` followed by `tmux ... send-keys ... C-m`; shell captured the literal BEL. For hidden-window tests, I created a second detached window and enabled `monitor-bell` explicitly. I queried formats with `display-message`/`list-windows`, attached a real `tmux -C attach-session`, and captured control-mode stdout.

## Results by question

Version notation in the historical sections below: **3.8 = observed**; the historical “not run” statements for **3.4 and 3.7b** are superseded by the p314 follow-up above.

### 1. Current window, session with no attached client; alert flags/options

- **3.8:** With the session detached, default `monitor-bell=1`, `bell-action=any`, `visual-bell=off`, a BEL in its *current* window produced `window_bell_flag=1`, `session_alerts=0!`; `window_activity_flag=0` by default. This contradicts the broad claim “only non-current windows get flags”: the current window of a session with no attached client did get a bell flag. With a control client attached (Q2), current-window flags instead stayed clear.
- `monitor-bell off` suppressed the flag and hook; on produced the bell flag. `bell-action` did **not** change whether the flag was set (tested `any`, `none`, `current`, `other`); it did gate whether `alert-bell` ran (Q3). `visual-bell=off/on/both` did not change the flag. BEL alone did not set activity with default `monitor-activity=off`. With `monitor-activity=on`, a bell-only byte also set `window_activity_flag=1` and `session_alerts=1#`; this is generic output activity, not a bell-specific signal.
- **3.4 / 3.7b:** Not run. Do not treat upstream docs or 3.8 behavior as runtime confirmation.

Commands / excerpts (3.8):

```sh
/opt/homebrew/bin/tmux -V
# tmux 3.8

tmux -L probe-bell-p310 -f /dev/null new-session -d -s s
tmux -L probe-bell-p310 display-message -p -t s '#{window_index}|#{window_bell_flag}|#{session_alerts}|#{window_activity_flag}|#{monitor-bell}|#{bell-action}|#{visual-bell}'
# 0|0||0|1|any|off

tmux -L probe-bell-p310 send-keys -t s:0.0 -l "printf '\\007'"
tmux -L probe-bell-p310 send-keys -t s:0.0 C-m
sleep 0.7
tmux -L probe-bell-p310 display-message -p -t s '#{window_index}|#{window_active}|#{window_bell_flag}|#{session_alerts}|#{window_activity_flag}'
# 0|1|1|0!|0
```

Option comparisons excerpt:

```text
monitor-bell off => 0||
monitor-bell on  => 1|0!|1          # window_bell_flag|session_alerts|@tether-bell
```

With `monitor-activity on`, a pane command wrote only BEL (not an echoed command): `python3 -c "import os,time;os.write(1,bytes([7]));time.sleep(3)"`; result `window_bell_flag|window_activity_flag|session_alerts` → `0|1|1#` while monitor-bell was off.

### 2. Bell while tether-style control client is attached

- **3.8:** A BEL in the attached session's current pane appeared in `%output` (tmux octal-escapes BEL as `\007` in its control protocol). I saw no `%bell` / `%window-bell` notification. With the control client attached, the current-window bell did not set `window_bell_flag` or `session_alerts`; an `alert-bell` hook did run under default `bell-action=any`.
- **3.4 / 3.7b:** Not run.

Exact excerpt from `tmux -L probe-bell-p310 -C attach-session -t s` after external `send-keys` of the BEL command:

```text
%output %0 \007
```

The actual capture also contained ordinary pane echo/redraw `%output` records. No distinct bell notification appeared. The BEL itself was 16 bytes as one control line (`%output %0 \007` + newline). If that pane is already streamed, this is part of its existing pane output, not an extra command/request.

### 3. Hooks, user options, runtime-only installation

- **3.8:** `alert-bell` ran for a current-window bell in a detached session under `bell-action=any`, and a session hook successfully ran `set-option -t s @tether-bell 1`. It also ran for a non-current window under `bell-action=any`. `monitor-bell=off` suppressed it.
- The observed hook/action matrix: `bell-action=any` fires for current and other; `current` fires only for current; `other` fires only for other; `none` fires for neither. This gating did **not** affect the flags from Q1. Avoid changing Jimmy's `bell-action` just to make a hook work; preserve the user's existing choice and accept the corresponding missed-hook cases.
- `set-hook`/`set-option` are runtime tmux commands; no `.tmux.conf` edit is needed. But runtime changes remain in the live server until explicitly undone/server exit. A daemon must preserve/append to existing hooks and remove only its own hook on shutdown; a blanket `set-hook -u alert-bell` could remove the user's hook. Per-session hook option values also remain until cleared.
- **3.4 / 3.7b:** Not run. (The `hook_session` format is documented upstream from 3.2a, but exact runtime delivery/quoting on required versions remains to verify.)

Commands / excerpts (3.8):

```sh
tmux -L probe-bell-p310 set-hook -t s alert-bell 'set-option -t s @tether-bell 1'
# bell in s current window, detached, default action any:
tmux -L probe-bell-p310 display-message -p -t s '#{window_bell_flag}|#{session_alerts}|#{@tether-bell}'
# 1|0!|1
```

With a control client attached, the same current-window bell yielded `0||1` for those formats (no flag; hook set the user option). Setting `monitor-bell off` yielded `0||` (no flag and no hook-set value). In an 8-case comparison, flag behavior was unchanged by bell-action (`any/none/current/other`) and visual-bell (`off/on/both`); hooks followed the matrix above.

### 4. Learning about other sessions; subscriptions, polling, hooks and cost

- **3.8:** `refresh-client -B 'bell:@*:#{window_bell_flag}'` on a control client subscribed to windows in its **attached session**. It reported flag changes as `%subscription-changed`; it did not subscribe to every server session. A separate `list-sessions -F '#{session_name}|#{session_alerts}'` can read the current flags across sessions when issued, but is polling only if the daemon repeats it. `alert-bell` hooks can be server-global (I confirmed a global hook fires for a bell in a different session); a hook can invoke local code. A per-session hook setting `@tether-bell` is directly verified. One global hook setting a server-level user option was verified, but mapping that hook's session ID to a per-session user option was not verified here.
- **Subscription cost, measured on 3.8:** successful command: `refresh-client -B 'bell:@*:#{window_bell_flag}'`. An observed change notification was `%subscription-changed bell $0 @1 1 - : 1` (41 bytes including newline). A clear/change-back is another record. Initial subscription can also report values for windows; after stable state, no subscription-changed bytes were observed at idle. The tmux manual says these are delivered at most once per second, so format reevaluation/notification latency is up to about 1 s; CPU and timer wakeups were not instrumented. It is not a free zero-work subscription, but it avoids periodic command round trips and produces zero idle bytes when formats stay stable.
- **Polling cost:** not benchmarked. Each `list-sessions` poll incurs one local tmux command/reply and output proportional to session count; repeating it creates recurring idle work/bytes. No per-bell network cost is needed for local socket requests. `alert-bell` is event-triggered (no idle hook calls); an external run-shell/IPC handler would run once per alert. CPU was not measured.
- **3.4 / 3.7b:** Not run. Upstream tmux catalog lists `refresh-client -B` and the associated format/hook facilities as introduced by 3.2a; the requested binaries still need direct confirmation.

Command / output excerpt (3.8):

```text
refresh-client -B 'bell:@*:#{window_bell_flag}'
%begin 1793111550 321 1
%end 1793111550 321 1

# after a BEL in hidden window @1 of attached session $0:
%subscription-changed bell $0 @0 0 - : 0
%subscription-changed bell $0 @1 1 - : 1
```

The `$0 @0` value was the initial state and `$0 @1` the changed window. The all-window wildcard was scoped to session `$0`; other sessions were not part of that subscription.

### 5. Clear behavior and whether tether can clear privately

- **3.8:** Selecting a flagged non-current window clears its `window_bell_flag`; `kill-session -C -t s` cleared all bell/activity flags in that session without killing the session. A current-window bell in a detached session produced a flag; selecting that already-current window again did not clear it. Attaching a control client to that session did clear the current-window flag.
- The flag is tmux/session UI state, not per-client. Selecting a different window changes the session's shared current window (and therefore what Jimmy's other clients see); attaching tether cleared the shared current alert; `kill-session -C` also clears the session's alert flags globally. There is no tested operation to clear the built-in flag for only tether. Tether can maintain a separate `@tether-bell`/daemon read bit and clear that on the phone without clearing tmux's flag or changing the laptop.
- **3.4 / 3.7b:** Not run.

Commands / excerpts (3.8):

```text
# before -C:
0:1:0
1:0:1
# after `tmux ... kill-session -C -t s`:
0:1:0
1:0:0
```

### 6. Claude Code / Codex default BEL behavior

This is documentation/source research, not a runtime run of either app.

- **Claude Code:** Not a reliable default BEL. Current official terminal docs say the default is desktop notifications on Ghostty, Kitty, and iTerm2; elsewhere choose `preferredNotifChannel: "terminal_bell"` (or a Notification hook) to get a bell. [Claude Code terminal configuration](https://code.claude.com/docs/en/terminal-config).
- **Codex CLI (current Rust TUI):** Notification delivery is enabled by default, the method defaults to `auto`, and the condition defaults to `unfocused`. `auto` emits OSC 9 on recognized terminals (Ghostty, iTerm2, Kitty, Warp, WezTerm) and BEL otherwise; the BEL backend writes `\x07`. So it is **not always opt-in**, but a BEL is environment-dependent, and is not guaranteed in all terminals. The method can be set explicitly to `bel`. [Codex TUI notification defaults](https://github.com/openai/codex/blob/main/codex-rs/config/src/types.rs), [auto backend selection](https://github.com/openai/codex/blob/main/codex-rs/tui/src/notifications/mod.rs), [BEL backend](https://github.com/openai/codex/blob/main/codex-rs/tui/src/notifications/bel.rs).
- **3.4 / 3.7b:** App behavior is independent of tmux version; still not tested in these tmux environments. Claude may not BEL under its default channel. Codex may emit BEL depending on terminal detection and focus condition, so relying on all users/apps producing BEL will miss attention events.

## Historical p310 recommendation / practical bound (superseded by revised recommendation above)

Use two event sources, without adding idle polling:

1. **For the session/pane already being streamed:** inspect decoded `%output` bytes for BEL. That is already in the pane stream; 3.8 added no separate bell control-mode notification. Emit tether's own attention state to the phone only when it changes, not the pane BEL as a separate payload.
2. **For sessions/panes not streamed:** use a runtime `alert-bell` hook that records/forwards the session identity to the daemon (or a per-session runtime hook storing a `@tether-bell` marker). This is event-driven, zero idle bytes/work for the hook, and needs no `.tmux.conf` edit. Append/preserve user's hooks and restore the daemon's own changes. A session-scoped user option is verified; a server-global handler is verified to fire, but the exact portable session-ID-to-daemon callback should be confirmed on 3.4/3.7b before implementation.

For 3.8, a bell byte itself is 16 bytes in control mode when separately represented as `%output %0 \\007\n`; an alert transition is 41 bytes in the subscription example (per flag change). If the attached pane stream already flows, the BEL adds no additional protocol notification. Idle bytes are zero for the subscription after initialization, with up-to-1Hz format refresh overhead not CPU-profiled; an event hook has no idle work. The recommended hook's exact cross-version behavior is **not reliable yet** when `monitor-bell=off`, or when the user's `bell-action` excludes that window class. A tmux built-in flag also clears/shared-updates when clients view/switch windows, so it cannot serve as tether-private “since this phone last looked” state. Claude/Codex are not universal BEL producers.

## Historical p310 limits / follow-up (SSH blocker resolved above)

- No tmux 3.4 or 3.7b test could be run because SSH public-key/password auth to `pop-os` failed in BatchMode. Retry once credentials are available, especially hook behavior, bell-action gating, current-window flag semantics, and subscription message/version behavior.
- CPU, process wakeups, and actual phone-network bytes were not profiled; the byte figures above are counted from captured control lines. No `.tmux.conf` or tether source was changed. No socket/server was intentionally left running.
