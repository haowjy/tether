# Numbered-line gap: independent tmux probe

## Conclusion

I could not reproduce a **missing numbered line in tmux 3.8 control-mode output**. In the controlled runs below, decoding `%output`/`%extended-output` showed a continuous `L1…Ln` sequence, and `capture-pane -S - -E -` held the same numbered lines. The analogous run also had no sequence gaps on tmux 3.4 and 3.7b.

I did reproduce a checker-visible gap in a 3.8 exploratory run: the raw decoded stream contained `L5685\r\r\n` between `L5684` and `L5686`. `tests/tmux_real.rs::numbered` strips at most one trailing CR, so it rejects that line and reports the apparent transition `L5684 → L5686`. The line is present in the raw control output, not dropped. I then saw the same doubled-CR framing on 3.4 and 3.7b (and in matching `pipe-pane` output), so this observation is not specific to 3.8's control-mode implementation. In those trials, `capture-pane` also retained every number.

**Decision:** the evidence does not support blaming a silent 3.8 control-mode drop. The prior tether test failure still merits attention, but this probe points to a PTY/pane-output framing or test-recognition issue as a plausible explanation for at least some apparent gaps. It does not disprove the separate prior captures in `numbered-gap-diagnosis.md`; those need a frame-aware comparison that distinguishes a genuinely absent number from a line rejected because it has two CR bytes.

## Method and exact commands

All servers used a unique `-L p82-…` private socket and `-f /dev/null`; no default server or existing session was used. A temporary `setup` session let me set history-limit **before** creating the tested `fixture` pane (important for older tmux versions):

```sh
tmux -L p82-<run> -f /dev/null new-session -d -s setup -x 80 -y 24 -c /tmp /bin/sh
tmux -N -L p82-<run> -f /dev/null set-option -g history-limit 500000
tmux -N -L p82-<run> -f /dev/null new-session -d -s fixture -x 80 -y 24 -c /tmp /bin/sh
tmux -N -L p82-<run> -f /dev/null kill-session -t setup
```

The pane ID was read with `display-message -p -t fixture '#{pane_id}'`. I attached a plain control client with:

```sh
tmux -C -L p82-<run> -f /dev/null attach-session -t fixture
```

For the direct-file condition its stdout went to a per-run file. The slow-reader condition used a pipe reader that read 4096 bytes, then slept 10 ms before reading again (about 400 KiB/s maximum, below the flood's output rate). The flood body matched the test's `NUMBERED` loop, with a unique stop file:

```sh
stty -echo
i=0
while [ ! -e /tmp/tether-p82/<socket>.stop ]; do i=$((i+1)); echo L$i; done
echo FLOW-DONE
```

The concurrent-snapshot condition issued 200 one-shot snapshots, 5 ms apart, while that loop was running:

```sh
tmux -N -L p82-<run> -f /dev/null capture-pane -p -t <pane-id>
```

After the stop file was created and `FLOW-DONE` arrived, history was captured with:

```sh
tmux -N -L p82-<run> -f /dev/null capture-pane -p -S - -E - -t <pane-id>
```

I also enabled `pipe-pane -t <pane-id> 'cat > /tmp/tether-p82/<socket>.pipe'` before the flood. A small Python harness ran the private-server lifecycle, attach/reader, 200 snapshots, stop, and history capture. Its decoder split control records on actual LF, selected `%output` and `%extended-output` for the tested pane, octal-decoded each payload (`\\015` → CR, `\\012` → LF, `\\134` → backslash), concatenated payload bytes, then checked numbered lines. A second check mirrored the test helper: split on LF and accept `L<digits>` with zero or one final CR only. The latter is why a doubled CR appears as a skipped number to that test helper.

For source comparison I fetched the official tmux release tarballs (`tmux-3.4.tar.gz`, `tmux-3.7b.tar.gz`, `tmux-3.8.tar.gz`) and built 3.4/3.7b using Homebrew libevent/ncurses:

```sh
PKG_CONFIG_PATH=/opt/homebrew/opt/libevent/lib/pkgconfig:/opt/homebrew/opt/ncurses/lib/pkgconfig \
CPPFLAGS='-I/opt/homebrew/opt/libevent/include -I/opt/homebrew/opt/ncurses/include' \
LDFLAGS='-L/opt/homebrew/opt/libevent/lib -L/opt/homebrew/opt/ncurses/lib' \
./configure --prefix=/tmp/tether-p82/install<VERSION> --disable-utf8proc --disable-sixel
make -j4
make install
```

The resulting binaries reported `tmux 3.4` and `tmux 3.7b`; the installed Homebrew binary reported `tmux 3.8`.

## Results

| tmux | condition | runs | numbered output / history | checker-visible gaps | actual missing numbers |
|---|---|---:|---|---:|---:|
| 3.8 | stdout directly to file, no snapshots | 5 | 6,495–7,752 lines/run; history count matched each run | 0/5 | 0/5 |
| 3.8 | deliberately slow pipe reader, no snapshots | 5 | 6,783–8,170 lines/run; history count matched each run | 0/5 | 0/5 |
| 3.8 | 200 snapshots, 5 ms apart; history-limit set before pane | 10 | 55,102–330,896 lines/run; history count matched each run | 0/10 | 0/10 |
| 3.4 | same 200-snapshot flood; history-limit set before pane | 5 | 100,553–226,282 lines/run; history count matched each run | 1/5 runs (4 double-CR lines) | 0/5 |
| 3.7b | same 200-snapshot flood; history-limit set before pane | 5 | 108,802–244,751 lines/run; history count matched each run | 2/5 runs (2 and 19 double-CR lines) | 0/5 |

`actual missing numbers` counts gaps after allowing a doubled CR in the raw line ending. The control stream's `L1…Ln` sequence was otherwise continuous in every row. On the corrected 3.8 snapshot set, decoded control output and `pipe-pane` bytes were identical in 9/10 runs and differed by one byte in the other run; all numbered sequences and history captures were complete in all 10. In the 3.4 and 3.7b anomalous trials, control output and `pipe-pane` bytes were identical, and history remained continuous.

A representative raw decoded excerpt from the exploratory 3.8 checker-visible gap was:

```text
L5680\r\nL5681\r\nL5682\r\nL5683\r\nL5684\r\nL5685\r\r\nL5686\r\nL5687\r\nL5688\r\n
```

`L5685` exists in the control output. The test's `numbered()` helper (`strip_suffix(b"\\r")`, then require only digits) rejects `L5685\\r\\r`, which makes its continuity check see `(5684, 5686)`. In another exact-history 3.4 run, four such lines yielded checker gaps `(5760,5762)`, `(7000,7002)`, `(7443,7445)`, `(8229,8231)`; in 3.7b runs, the same pattern occurred. This cross-version evidence argues against a 3.8-only control queue drop.

## Source and client-side controls

The 3.8 `control.c` output path is substantially reorganized relative to 3.7b, so the source change deserves review if a true omission can be reproduced:

- 3.8 queues pane blocks in `control_write_output` (`control.c:617–669`) and serializes them via `control_append_data` / `control_write_pending` (`:805–922`). `control_append_data` advances `cp->offset` by the byte count it encodes. The corresponding 3.7b code is `control_write_output` (`control.c:472–524`) and `control_write_pending` (`:667–730`); it has the same offset/queued-block pattern.
- 3.8 added ordered command-reply buffering and a 64 MiB reply-buffer cap (`control.c:425–451`). Reaching that cap exits the client as “too far behind”; it is not a silent per-line skip. The output code explicitly skips only for control-pane-off/paused or client discard/exit states.
- `pause-after` is a backpressure policy, not a lossless workaround: when the age threshold is exceeded, tmux pauses the pane and discards queued pane data before notifying `%pause` (`control.c:590–611`). `refresh-client -A %pane:pause` likewise calls `control_pause_pane`, which discards queued data; `off` disables output and `continue` resumes at the pane's current offset (`cmd-refresh-client.c:108–138`, `control.c:375–402`). None preserves the continuous stream while avoiding this observed framing anomaly.

I did not find a client-side setting that fixes the apparent gap without suppressing or discarding pane output. No setting was applied as a proposed workaround.

## Cleanup and limitations

All servers used private `p82-*` sockets. I explicitly killed the remaining private servers and unlinked their stale socket files after the harness runs; no p82 server/socket remains. The `p82` scratch source, builds, scripts, control captures, and pipe captures under `/tmp/tether-p82` were temporary and removed. No project source or test was edited, and no test suite was run.

This is a user-style control-mode probe, not a replay of the Rust test process itself. I did not reproduce a true absent number even after 10 corrected-history 3.8 snapshot runs; a rare omission outside these conditions remains open. The source comparison identifies likely locations to inspect, not a proof that no unrelated 3.8 output-loss bug exists.
