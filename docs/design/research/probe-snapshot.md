# Probe: snapshot boundary (tmux 3.4)

Runtime spikes on this dev box, 2026-10-21 (meridian spawns p3, p5). The first part
shows the review's pause-based hand-off is lossy; the second confirms the no-pause
`%end` boundary.

## Pause-based hand-off (p3): lossy

### Result

**The pause → capture → marker → continue sequence reproduced the active screen in the TUI redraw case, but this run does not prove a byte-complete hand-off.** The post-marker stream began at a later frame than the snapshot. The emulator comparison passed for the redraw’s changing frame row; it was not a full-screen, multi-pattern proof.

### Runtime evidence

Ran against **tmux 3.4** on a private `tmux -L spike-p3` socket, under `nice -n 10`. The pane entered the alternate screen, enabled mouse and bracketed-paste modes, and repeatedly redrew a numbered frame using cursor positioning.

With `%0` paused, `capture-pane -p -e` showed `FRAME 00067997`; `list-panes` reported `cursor=14,1 alt=1` and mouse flags enabled. After the marker and continue, the first post-marker redraw was `FRAME 00093472`; the last was `FRAME 00132917`. The later tmux capture also showed `FRAME 00132917`.

Feeding the captured screen, recorded cursor position, and **907,258 bytes** of post-marker output into the `vt100` emulator produced `FRAME 00132917` on the redraw row—the same frame as tmux’s later capture. This was a targeted comparison of the updating row, not a normalized diff of every cell and mode.

The frame gap is important: frames `00067998` through `00093471` were not in the post-marker stream. For this redraw they were superseded by later writes to the same row, so the tested screen converged. That does **not** establish lossless reconstruction for output whose omitted updates matter.

### Sequence and observations

The tested order was:

```text
refresh-client -A '%0:pause'
capture-pane -p -e -t %0
capture-pane -p -e -a -t %0
capture-pane -p -e -P -t %0
list-panes -t %0 -F 'cursor=#{cursor_x},#{cursor_y} alt=#{alternate_on} ...'
display-message -p 'SNAPSHOT-MARKER'
refresh-client -A '%0:continue'
```

Control-mode excerpt:

```text
%begin ... 282 1
%pause %0
%end ... 282 1
...
SNAPSHOT-MARKER
%end ... 288 1
%begin ... 289 1
%continue %0
%end ... 289 1
%output %0 \033[2;1HFRAME 00105422\033[K...
```

- With the alternate screen active, the ordinary capture showed its active frame; `-a` captured the other screen. When no alternate screen was active, `-a` returned `no alternate screen`.
- `capture-pane -p -e -P` returned an empty body in this run; it did not substitute for the ordinary screen capture.
- One hand-off took **181 ms** from before pause through continue, including a deliberate **100 ms** paused hold. The command/reply driver used a 10 ms polling interval; this is a single observation, not a latency distribution.
- A separate short `yes FAST` run generated **8 MiB**; the TUI run above supplied the emulator comparison. I did not run the proposed colored-file `cat` case.

The supplied `docs/design/research/probe-tmux.md` reports that `refresh-client -f pause-after=1` switches to `%extended-output`, and that pause-after discards output. It also records explicit `%pause %0` / `%continue %0` events. I did not independently trigger an automatic pause-after transition in this run.

### Difference from the review’s libtmux-rs claim

The current `PaneOutput::snapshot()` implementation I read does **not** pause, capture both screens, emit a marker, and continue. It sends an ordered `capture-pane -p -t %pane`, consumes preceding output events through the matching boundary, then returns the capture reply. It also documents that the visible screen and preceding raw output may overlap. Thus the review’s description of the library’s exact sequence does not match that implementation.


## No-pause boundary (p5): holds

### Result

Source inspection supports the **no-pause capture boundary**: for pane bytes tmux has read, the capture reply’s `%end` separates bytes already reflected in the snapshot from later output. Runtime checks matched that ordering for sequential output, including SGR-colored lines. A `vt100` emulator also reconstructed an alternate-screen scrolling TUI from a snapshot plus post-boundary bytes in three trials.

The pending-sequence probe confirmed that `capture-pane -P` returned an incomplete CSI prefix; feeding that prefix into the emulator before post-boundary bytes produced a full-screen match.

I rearmed, continued the probe, cleaned up, and ran `meridian spawn done`. No repository files were changed.

### Source-level ordering

Fetched upstream tmux tag `3.4` (`9ae69c3795ab5ef6b4d760f6398cd9281151f632`) into scratch, then removed it.

- `window.c:1006–1030`: `window_pane_read_callback` calls `control_write_output` at lines 1025–1028, then `input_parse_pane` at line 1029.
- `control.c:468–500`: `control_write_output` appends pane-data blocks to the client’s `all_blocks` queue.
- `control.c:406–428`: reply lines go directly to the client only if that queue is empty; otherwise, they join the same queue.
- `control.c:588–605, 655–716`: queued reply lines and pane-data blocks are emitted in order.
- `cmd-queue.c:739–789`: `cmdq_next` fires queued commands synchronously until it reaches a waiting item. `server.c:269–277` advances command queues in the server loop.

**Inference:** if a pane-read callback runs before capture execution, its output block is queued before the capture reply; those bytes are parsed into the screen before capture runs. If it runs afterward, both screen parsing and output queuing happen after the reply. Pane bytes still waiting in the kernel have not yet changed the captured screen and will be handled afterward.

The queue and command-loop paths support this boundary claim for tmux 3.4. They do not establish identical behavior on other tmux versions.

### Runtime checks

All runs used a private `tmux -L spike-p5` server under `nice -n 10`; capture clients used an 80×24 PTY.

**Uncolored numbered output:** the pane emitted sequential 100-line bursts with 10 ms pauses between bursts. I issued 200 captures with a blocking `select` reader on control-client stdout. Of those, 198 had post-boundary output available for comparison; **all 198 matched**: the first complete post-boundary number was exactly N+1, where N was the capture’s last complete screen number. There were no mismatches.

**Capture-to-`%end` latency:** for those 200 captures, send-to-receipt-of-matching-`%end` was **p50 0.110 ms, p95 0.140 ms, range 0.080–0.230 ms**. The reader blocked on stdout readiness, with no polling loop. These are observations for this harness and workload, not a performance comparison.

**SGR-colored numbered output:** 200 captures were issued during red-SGR numbered bursts. Of these, 196 had post-boundary data to compare; **all 196 matched** N→N+1. No mismatches were observed.

**Alternate-screen incremental TUI reconstruction:** in three trials, a TUI entered the alternate screen, populated it, and then appended lines that scrolled the screen. For each trial, the `vt100` emulator was initialized from the captured screen, fed the post-boundary bytes, and compared against a final tmux capture. All three normalized 24-row comparisons had **zero differing rows**. Each had 338 post-boundary bytes. The initial cursor position was set to the known bottom-row position for this fixture; this was not a test of arbitrary cursor/mode restoration.

**Pending escape sequence:** with the pane holding an incomplete `ESC [ 31` CSI sequence, `capture-pane -p -P` returned that prefix (`\x1b[31`). After the boundary, the pane completed it with `mPROBE`. Feeding the captured screen, the `-P` prefix, and the post-boundary bytes into `vt100` produced a **zero-difference normalized 24-row comparison** against the final tmux capture. The installed tmux man page describes `-P` as capturing output at the beginning of an as-yet incomplete escape sequence (`/usr/share/man/man1/tmux.1`, lines 2252–2255).

### Tested reply sequence and recommendation

A combined capture-plus-state command list was tested with a raw semicolon separator. Tmux returned separate guarded replies, for example:

```text
%begin ... 280 1
[captured screen]
%end ... 280 1
%begin ... 281 1
cursor=0,0 alt=0
%end ... 281 1
```

The recommended control-client input is:

```text
capture-pane -p -e -t %pane ; capture-pane -p -P -t %pane ; display-message -p 'cursor=#{cursor_x},#{cursor_y} alt=#{alternate_on}'
```

Treat the **first capture command’s `%end`** as the snapshot boundary. The command list executes synchronously in the server’s command queue, so these state queries do not allow a pane-read callback to interleave before the list completes. Initialize the emulator from the captured active screen and state; feed the `-P` bytes as parser input, not literal screen text; then apply only `%output` bytes after the first capture `%end`. Do not pause the pane or apply pre-boundary `%output` bytes again.

