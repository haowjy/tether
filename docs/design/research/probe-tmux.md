# tmux 3.4 / systemd 255 runtime probe

Run 2026-10-21 on this host (`tmux 3.4`, `systemd 255.4`). Every tmux test
used a distinct socket containing `p8843` (for example,
`tmux -L probe-p8843 -f /dev/null ...`); the real tmux server was not touched.
Control-mode clients were run under `script` to provide the tty tmux requires.

## 1. OSC visibility

The pane ran:

```sh
printf '\033]133;A\a\033]7;file://host/cwd\a\033]52;c;SGVsbG8=\aTEXT\n'
```

With the default `allow-passthrough off`, a `-C` client produced this raw
control line (shown with the protocol's octal escaping):

```text
%output %0 printf '\134033]133;A\134a\134033]7;file://host/cwd\134a\134033]52;c;SGVsbG8=\134aTEXT\134n'\015\012\033]133;A\007\033]7;file://host/cwd\007\033]52;c;SGVsbG8=\007TEXT\015\012$
```

Then, through the control client, I ran `set-option -g allow-passthrough on`
and repeated the command. The line was:

```text
%output %0 printf '\134033]133;B\134a\134033]7;file://host/on\134a\134033]52;c;V09O\134aON\134n'\015\012\033]133;B\007\033]7;file://host/on\007\033]52;c;V09O\007ON\015\012$
```

The `show-options -g` reply confirmed `allow-passthrough on`. In both cases,
the control client received the OSC bytes in `%output`; passthrough changes
what an attached terminal client forwards, not whether control mode exposes
the pane's raw output.

**Answer:** OSC 133, OSC 7, and OSC 52 are visible in `%output` with passthrough both off and on; `allow-passthrough` is not needed for the bridge to observe them.

## 2. Snapshot ordering

The pane continuously printed `TICK-%06d` every millisecond. The control
client issued:

```text
capture-pane -p -e -t %0
```

The relevant protocol ordering was:

```text
%output %0 TICK-000428\015\012
capture-pane -p -e -t %0
%begin 1792627070 318 1
TICK-000406
TICK-000407
TICK-000408
...
TICK-000424
%end 1792627070 318 1
```

I also ran three captures while `yes TICK` filled a 5,000-line history
(11,177,460-byte transcript). A scan found no `%output` line between any
`%begin` and matching `%end`; the capture reply is serialized as one reply
transaction on this run. Output events occurred before and after the capture
transaction, but the capture itself has no pane-output sequence number. The
number in `%begin <time> <command-id> 1` identifies the command reply, not a
position in the pane byte stream.

For a deterministic boundary, pause the pane first, capture, then continue:

```text
refresh-client -A '%0:pause'
capture-pane -p -e -t %0
refresh-client -A '%0:continue'
```

The quote around `%0:pause` is required in control-mode command input (the
unquoted form returned `parse error: syntax error`).

**Answer:** `%output` did not interleave inside `%begin`/`%end` in the stress run, but capture has no byte offset/sequence marker; use an explicit pause/capture/continue barrier when the exact included-output boundary matters.

## 3. Mode restore format variables

I used a pane that emitted alternate-screen, mouse, application cursor/keypad,
bracketed-paste, cursor-position, and cursor-visible sequences. The 3.4
format query was:

```sh
tmux -L modes-p8843 -f /dev/null list-panes -F \
 'id=#{pane_id} alternate_on=#{alternate_on} saved=#{alternate_saved_x},#{alternate_saved_y} \
 cursor=#{cursor_x},#{cursor_y} cursor_flag=#{cursor_flag} cursor_char=#{cursor_character} \
 insert=#{insert_flag} keypad_cursor=#{keypad_cursor_flag} keypad=#{keypad_flag} \
 mouse_all=#{mouse_all_flag} mouse_any=#{mouse_any_flag} mouse_button=#{mouse_button_flag} \
 mouse_standard=#{mouse_standard_flag} mouse_utf8=#{mouse_utf8_flag} mouse_sgr=#{mouse_sgr_flag} \
 bracketed_paste=#{bracketed_paste_flag} cursor_keys=#{cursor_keys_flag}'
```

Observed output:

```text
id=%0 alternate_on=1 saved=0,0 cursor=6,4 cursor_flag=1 cursor_char=  insert=0 keypad_cursor=1 keypad=1 mouse_all=1 mouse_any=1 mouse_button=0 mouse_standard=0 mouse_utf8=0 mouse_sgr=1 bracketed_paste= cursor_keys=
```

Available/useful 3.4 variables are:

```text
alternate_on alternate_saved_x alternate_saved_y
cursor_x cursor_y cursor_character cursor_flag
insert_flag keypad_cursor_flag keypad_flag
mouse_all_flag mouse_any_flag mouse_button_flag mouse_standard_flag
mouse_utf8_flag mouse_sgr_flag
pane_in_mode pane_mode
```

`pane_in_mode`/`pane_mode` describe tmux copy mode, not an application's
alternate-screen state. `#{bracketed_paste_flag}` and
`#{cursor_keys_flag}` expanded to empty (and are not listed format variables
in the 3.4 man page). The cursor-key state is represented by
`keypad_cursor_flag`; there is no bracketed-paste format variable to restore.

**Answer:** 3.4 exposes alternate screen, saved/current cursor, cursor/insert, keypad, and six mouse flags; it does not expose bracketed-paste or a separate cursor-keys format flag, so those two modes need stream/model tracking.

## 4. `window-size latest` and resize

The normal client was started in a `script` pty after `stty cols 200 rows 50`.
The control client initially attached without a resize command. The observed
window/client state was:

```text
after normal 200x50 attach:
client=/dev/pts/80 pid=2251197 control=0 size=200x50
window=@0 size=200x49
winch=1

after control attach, before refresh-client:
client=/dev/pts/80 control=0 size=200x50
client=/dev/pts/82 control=1 size=80x
window=@0 size=200x49
winch=1
```

The control client then issued `refresh-client -C 50x30`:

```text
after control refresh-client -C 50x30:
client=/dev/pts/80 control=0 size=200x50
client=/dev/pts/82 control=1 size=50x
window=@0 size=50x30
winch=2
```

The pane's `WINCH` trap count stayed at 2 after:

```text
send-keys -t %0 X
```

The normal client's 200x50 terminal yielded a 200x49 tmux window because the
status row consumes one row. Control-mode attach alone did not change the
window; explicit `refresh-client -C` did, and sending a key did not.

**Answer:** On 3.4 here, `window-size latest` does not resize the window merely because a control client attaches or sends keys; the explicit `refresh-client -C 50x30` changed it and caused one SIGWINCH.

## 5. Flow control

These commands were accepted without errors:

```text
refresh-client -f pause-after=1
refresh-client -f no-output
refresh-client -f '!no-output'
```

With `pause-after=1`, output switched from `%output` to the 3.4 extended form:

```text
%extended-output %0 0 : FLOW-0020\015\012
%extended-output %0 1 : FLOW-0025\015\012
```

`no-output` suppressed output events until `!no-output`; the compact run
showed:

```text
refresh-client -f no-output
%begin 1792627206 274 1
%end 1792627206 274 1
refresh-client -f '!no-output'
%begin 1792627207 275 1
%end 1792627207 275 1
%output %0 N-\015\012
```

After enabling `pause-after`, the explicit pause/continue sequence was:

```text
refresh-client -A '%0:pause'
%begin 1792627201 275 1
%pause %0
%end 1792627201 275 1
refresh-client -A '%0:continue'
%begin 1792627201 276 1
%continue %0
%end 1792627201 276 1
```

An unquoted `refresh-client -A %0:pause` produced `parse error: syntax error`.

**Answer:** `-f pause-after=1` and `-f no-output` work in 3.4; pause-after uses `%extended-output`, `no-output` suppresses pane events, and `%pause`/`%continue` are confirmed with quoted `refresh-client -A '%0:pause|continue'`.

## 6. Key sending

The pane ran `od -An -tx1 -v`; the server had:

```text
set-option -s extended-keys on
set-option -as terminal-features '*:extkeys'
```

The control commands and observed results were:

| Command | Observation |
| --- | --- |
| `send-keys -t %0 BTab` | `%output %0 ^[[Z`; od: `1b 5b 5a` (CSI Z / Shift-Tab) |
| `send-keys -t %0 S-Enter` | `%output %0 S-Enter`; tmux 3.4 treated the unknown key name as literal text, not an extended-key event |
| `send-keys -t %0 M-Enter` | `%output %0 ^[\015\012`; the bytes sent by tmux are ESC CR; the pane tty's `ICRNL` made od see ESC LF (`1b 0a`) |
| `send-keys -t %0 C-j` | od: `0a` |
| `send-keys -t %0 -l 'é中'` | od: `c3 a9 e4 b8 ad` (full UTF-8) |
| `send-keys -t %0 -H 1b 5b 3c 30 3b 31 30 3b 35 4d` | `%output %0 ^[[<0;10;5M`; od: `1b 5b 3c 30 3b 31 30 3b 35 4d` |

The compact od output was:

```text
%output %0  1b 5b 5a 0a 1b 0a 0a c3 a9 e4 b8 ad 0a 1b 5b 3c
%output %0  30 3b 31 30 3b 35 4d 0a
```

**Answer:** BTab, M-Enter, C-j, literal Unicode, and raw SGR mouse bytes work as expected; `send-keys S-Enter` is not supported by tmux 3.4 and arrives as the literal string `S-Enter`, so the planned named-key path needs correction.

## 7. cgroup behavior of a user service

For the first-server case I ran:

```sh
systemd-run --user --unit=probe-p8843 -p MemoryMax=64M --collect \
  sh -c "tmux -L cg3-p8843 -f /dev/null new-session -d -s cg3 'sleep 60'; sleep 60"
```

`systemctl --user status` showed:

```text
CGroup: /user.slice/user-1000.slice/user@1000.service/app.slice/probe-p8843.service
         ├─2275346 /bin/sh -c ...
         ├─2275350 tmux -L cg3-p8843 -f /dev/null new-session -d -s cg3 sleep 60
         └─2275354 sleep 60
```

The server's `/proc/2275350/cgroup` was:

```text
0::/user.slice/user-1000.slice/user@1000.service/app.slice/probe-p8843.service
```

The pane process was launched into a separate transient scope:

```text
pid 2275351:
0::/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-5e5c707d-7052-4eb9-83ee-c241f8d2d947.scope
```

After `systemctl --user stop probe-p8843`, `tmux ... list-sessions` failed with
`no server running`, and both the server and pane failed `kill -0`. Thus the
server is in the service cgroup and is killed by stopping the unit; the pane
has its own scope but dies when the server/pty is torn down.

For the already-running case, I started `tmux -L cg4-p8843 ... new-session`
outside the unit. Its server was in a separate scope:

```text
server cgroup:
0::/user.slice/user-1000.slice/user@1000.service/app.slice/tmux-spawn-d6e75e91-a39c-494f-950a-7d432b46608e.scope
```

Starting a `probe-p8843` service that only ran `tmux -L cg4-p8843 list-sessions`
and then stopping it left the server usable: `outside server still alive after
stop` and `server pid alive=yes`.

**Answer:** A first tmux server started inside the user unit lands in that unit's cgroup and is killed by `systemctl --user stop`; an already-running outside server stays alive when the unit stops.

## 8. Cost of control clients and a 50 MiB burst

Host conditions were `24` CPUs and load average `8.85 7.82 5.80`; these are
one-run observations, not a performance comparison. RSS is the `ps` resident
set in KiB, and CPU is the sampled `ps %CPU` for the **control client process**.

### Idle client

Command shape:

```sh
script -qefc 'tmux -L costidle-p8843 -f /dev/null -C attach -t idle' ...
```

Five samples at 200 ms intervals were identical:

```text
client_pid=2278821
2278821 5308 0.0 00:00:00
2278821 5308 0.0 00:00:00
2278821 5308 0.0 00:00:00
2278821 5308 0.0 00:00:00
2278821 5308 0.0 00:00:00
```

### 50 MiB, slow reader, no pause-after

The pane ran `yes | head -c 52428800`. The control output was consumed by a
reader that read 64 KiB then slept 10 ms. There were 75 samples over 15 s:

```text
slow client_pid=2283040
slow max rss_kib=5364
slow max ps_cpu_pct=0
slow final=5328 0.0 00:00:00
slow transcript_bytes=131635655
slow pauses=0
```

### 50 MiB, slow reader, `pause-after=1`

The same burst and consumer were used after the control command
`refresh-client -f pause-after=1`. There were 90 samples over 18 s:

```text
pause client_pid=2285849
pause max rss_kib=5344
pause max ps_cpu_pct=0
pause final=5344 0.0 00:00:00
pause transcript_bytes=157966038
pause events=0
continue events=0
extended lines=19836
```

The slow consumer was still draining the control stream, so no automatic
`%pause`/`%continue` transition was observed in this particular cost run;
the separate flow-control run above confirms those events. The client stayed
around 5.3 MiB RSS in all three conditions and was below `ps`'s displayed
0.1% CPU granularity. These measurements do not establish a throughput or
latency winner; they show the client process's memory footprint while the
server emitted the burst. The transcript is larger than 50 MiB because it is
the control protocol text plus `script` capture overhead.

**Answer:** An idle control client was 5,308 KiB RSS and 0.0% sampled CPU; during the 50 MiB slow-reader burst it remained about 5.3 MiB RSS and below 0.1% sampled CPU, with pause-after switching to `%extended-output` but not changing the client RSS in this run.

## Cleanup

All probe sockets and transient `probe-p8843.service` units were stopped or
killed. Temporary transcripts and FIFOs were kept only under
`/tmp/tether-tmux-probe-p8843-*` during the run and removed after the report
was written. No source files, `~/.tmux.conf`, or real tmux sessions were
modified.
