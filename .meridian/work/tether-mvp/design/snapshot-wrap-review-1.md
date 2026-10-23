# snapshot-wrap.md — structure review 1

Reviewed: `design/snapshot-wrap.md` (follow-up recommendation, 2026-10-23) against `main`
at `6798ad4`, before any code. Lens: `/review` + `/thermo-nuclear-review`. Probes ran on
isolated `-L tether-wrap-review` servers (fresh `TMUX_TMPDIR`), on the built tmux 3.4 and
the installed 3.8, and in `@xterm/headless` 6.0.0. The scripts were throwaway and are
deleted; each check below gives the inputs and what came back, so it can be rerun.

## Verdict: request changes

The diagnosis is right: CUP-per-row restore drops `isWrapped`, and replaying through
autowrap brings it back. The fail-closed 3.4 alignment holds up against tmux's source:
`-N -T` and `-J` serialize the same cells, and the only difference between them is the
separators (`cmd-capture-pane.c`: `EMPTY_CELLS` is off under `-T`/`-J`, `TRIM_SPACES` is
off under `-N`/`-J`). The structure still needs four changes before code:

1. **The snapshot wrap map should never leave `snapshot.rs`.** The restore bytes are
   composed in the daemon, so the map is an input to `compose()`, not a wire field.
   That removes the frame change, the outbox/charge change, the web decoder change and
   the `pipeline.ts` change.
2. **Two cases join text that isn't adjacent.** The saved grid reports `W` for rows it
   truncated (F2), and autowrap during paint can scroll the restored screen (F3).
3. **The history lookahead depends on a range contract tmux doesn't keep.** tmux clamps
   `-S`/`-E`, so the daemon can't tell which rows came back. That is a live bug today (F4).
4. **The version branch has no owner,** and the simplest owner is none at all (F5).

## The shape

```
tmux/  (Session holds the capture shape; nothing above it sees a tmux version)
  command.rs   snapshot list: + capture pair for the active grid only
               history list:  bracketed by '#{history_size} #{pane_height}' reads
  wrap.rs      pure: align(physical, logical) -> WrapMap   (fail closed)
               pure: clamp(requested, hsize, height, rows) -> (start, rows, map)
  snapshot.rs  compose(): soft boundary = no CUP, `?7h` around the first cell only
  Reply::History { rows, wraps }        <- the only map that crosses the tmux boundary
hub/requests.rs  fit loop slices rows and map together; base cost includes the max map
proto            HistoryChunk gains `wraps` (base64, ≤25 B packed). Snapshot frame unchanged.
web              history/selection reads `wraps`. pipeline.ts unchanged.
```

What this removes from the design: the snapshot frame extension and its two
length-delimited maps, threading them through `ToConn`/outbox, map bytes in the snapshot
charge, the web frame decoder change, the `Snapshot.wraps` field in `pipeline.ts`, the
saved-grid map and its 3.4 capture pair, and (if F5's preferred option is taken) the
version branch, the `-F` prefix parser and the second code path to test.

What stays as designed: physical rows as the payload, one `wraps_forward` meaning
(bit *i* = row *i* continues on row *i+1*), fail-closed alignment, no `-R`, no guessing
from full rows, packed bits rather than bools.

## Findings

### High

**F1. Snapshot maps go into `compose()`, not onto the wire.** *(shape; deletes the most)*
The design says to extend the snapshot frame with active and saved maps, thread them
through the Rust frame/outbox types, the web decoder and the `pipeline.ts` `Snapshot`, and
charge their bytes (snapshot-wrap.md "Design proposal", bullet 3; "Byte and memory cost").
`client-architecture.md:123` already plans for this ("The pipeline takes the wrap map once
L3 lands"). None of it is needed. `Session` composes the restore bytes in the daemon and
emits only `Event::Snapshot { restore }` (`session.rs:455-462`, `snapshot.rs:65`).
`pipeline.ts:57-60` writes those bytes into xterm verbatim, and daemon-core §3.5 already
says "the clients carry no restore logic". The restore needs the map at exactly one point,
the `paint()` loop in `snapshot.rs:137`.
- *Check:* traced `from_replies → compose → Event::Snapshot → hub state.rs:575 → outbox →
  frames::snapshot`. Nothing between compose and xterm reads row structure. xterm probe A:
  `HARD`, CUP row 2, `abcdefghijklmnopqr` under `?7h` gives rows `[-, -, W]`, so a
  CUP-less replay sets `isWrapped` with no client involvement.
- *Fix:* add `PaneSnapshot.active_wraps: WrapMap`. `paint()` omits the CUP before row
  *i+1* when bit *i* is set. Leave the frame, outbox, charge, decoder and pipeline as they
  are. Snapshot wire cost is then about +4 B per soft boundary: a `?7h`/`?7l` pair (10 B)
  replaces a CUP (6–8 B). Version skew between daemon and client can't break anything,
  because the client contract doesn't change. Update `client-architecture.md:123`.

**F2. The saved grid reports `W` for rows it truncated. Replaying them drops text.** *(one-off)*
The design carries a saved-grid map and runs the 3.4 pair with `-a`. tmux keeps the saved
primary grid at its old size (`screen.c:645`, and the `compose` comment says the same),
but `capture-pane -a` serializes it at the *current* pane width
(`sx = screen_size_x(&wp->base)`). The `W` flag belongs to the old width.
- *Check:* `/tmp/twr/saved.sh`: a 20-col pane prints `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123`,
  enters `?1049h`, and is resized to 12. `-a -N -F` returns `W ABCDEFGHIJKL` then
  `- UVWXYZ0123`, so `MNOPQRST` is gone. `-a -J` returns `ABCDEFGHIJKLUVWXYZ0123`, so the
  3.4 alignment would agree and set the bit. A copy after the app leaves the alternate
  screen would silently splice two non-adjacent pieces.
- *Fix:* no wrap map for the saved grid. Paint it with CUPs as today. This also drops two
  of the four extra 3.4 captures when the alternate screen is on. State it in the spec:
  the screen behind an alternate screen restores without soft wraps. That is a deletion,
  not a patch.

**F3. Autowrap during paint can scroll the restored screen.** *(class: width drift; the fix
ends it)* The design says to "temporarily enable xterm autowrap" for the paint and to
verify drift later. daemon-core §3.5 step 1 exists because a too-wide row must not wrap
and scroll. With autowrap on, a drifted row at the bottom does exactly that.
- *Check:* `xt.mjs` D: `?7h` from the soft boundary to the end of a 12×3 paint, with a
  bottom row 2 cells too wide: `baseY 1`. The screen scrolled, so every restored row is off
  by one and row 0 went into scrollback. Case B (drift mid-screen) only shifts cells inside
  the run. Case F splits instead: `?7l` for row *i*, then `?7h`, the first cell of row
  *i+1* (after its leading SGR), then `?7l` and the rest. Same drift: `baseY 0`, row 2
  `W`, overflow clamped at the last column as today. G: a wide first cell (`界`) wraps
  correctly under the same split.
- *Fix:* the spec rule is: paint stays under `?7l`. At a soft boundary, emit `?7h`, row
  *i+1*'s leading escape sequences and its first character, then `?7l`. Ignore a set bit
  on the last painted row, because it has no successor. With that rule drift can only
  wrap at a marked boundary, and the bottom row needs no special case. The cost is a small
  pure "split after the first printable character" helper in `snapshot.rs` (skip CSI and
  OSC, take one UTF-8 scalar; combining marks that follow attach without advancing).
  Replace the design's "verify drift later" with this rule.

**F4. History ranges are clamped by tmux. The daemon mislabels rows, and the lookahead
can't be told apart from a clamp.** *(predates this design; the design builds on it)*
`cmd_capture_pane_history` clamps `-S` to the top of history, clamps `-E` to the last
visible row, and turns a range entirely above history into the single top row. The
daemon sends `HistoryChunk { start: <requested> }` regardless (`requests.rs:319`). The
client's loop ends only on an empty chunk (`web/tabs/driver.ts:121-135`), and an empty
chunk never comes.
- *Check:* `/tmp/twr/clamp.sh` on 3.4 and 3.8, with `history_size` = 4.
  `-S -400 -E -201` returns one row, `abcdefghijkl`. `-S -400 -E -1` returns the 4
  history rows, which the daemon labels −400..−397. `-S 2 -E 4` on a 4-row pane returns
  2 rows.
- *Impact today:* scrolling past the top of history makes up to 200 sequential round trips
  on the phone link, each returning the same top row, and fills the view with duplicates
  at wrong line numbers.
- *Impact on this design:* the 3.4 lookahead requests `end+1`. When `end` is the last
  visible row, or when `start` was clamped, the reply count can't say whether the
  lookahead row is there. "Discard that row's payload" then drops a real row or keeps a
  phantom one.
- *Fix (one mechanism, three problems):* bracket the history group with
  `display-message -p -t %P '#{history_size} #{pane_height}'` before and after the
  captures, as the snapshot list brackets its `<STATE>`. A pure `clamp()` in the tmux layer
  replays tmux's rule on those numbers. It returns the true first row, drops rows outside
  the request, returns an empty chunk when the range is past the top, and says whether
  the lookahead row exists. Two different reads mean `Torn`, which closes the gap in F7.
  This belongs in its own commit ahead of wrap maps, with daemon-core §3.4/§4.6 text.

### Medium

**F5. The version branch has no owner, and the simplest owner is none.** *(shape)*
`Session` discards the version once it reaches `Phase::Ready` (`session.rs:405-409`).
`command::op(&op, tag)` takes no version. `snapshot::from_replies` destructures exactly 6
replies (`snapshot.rs:155`). The hub learns the version only from `Event::Ready`. Whatever
issues `-F` has to know the version, and so does whatever parses the replies. The design
doesn't say who that is. Two further gaps: tmux's `CHANGES` never mentions capture
`-F`/`-L`, so the first version that has them is unknown between 3.5 and 3.7a (the design
verified only 3.7b and 3.8). And an `Unrecognised` version counts as newest, so it would
get `-F` and fail every snapshot on a build without it.
- *Preferred:* run the paired path on every version and drop `-F` until the minimum is
  raised. That deletes the version branch, the `-F` prefix parser, version ordering on
  `TmuxVersion`, and the second path in the real-tmux test matrix. The pair is correct on
  every supported version (same `cmd-capture-pane.c` logic). Jimmy's dev box runs the
  pair, because 3.4 is the floor, so it should be the path that gets exercised. The cost
  is the extra local captures the design already accepts for 3.4: about 4 ms and about
  one plain copy of the range per capture, measured; snapshots are spaced at least 250 ms
  apart. The one exactness loss is ambiguous empty continuation rows, which fail closed.
  Log the choice and "switch to `-F` when the minimum reaches ≥3.7b" in `decisions.md`.
- *If both paths are kept:* `Session` stores a `CaptureShape { Flags, Paired }` decided
  once in `started()`. It passes the shape to `command::op` and to the reply parsers, and
  the hub never sees it. Gate `Flags` at ≥3.7b, and send `Unrecognised` to `Paired`,
  since the pair works everywhere. This is the per-version table daemon-core §3.5 already
  uses for `<STATE>`.

**F6. The lookahead row belongs to the tmux layer, and only to the paired path.** The
design's summary says to "use one lookahead row for history chunks" in general. With `-F`,
each row carries its own `W`, so the last row needs no lookahead. On 3.4 the lookahead
exists because `-p` strips the final `\n` (`cmd_capture_pane_exec`: `if buf[len-1]=='\n'
len--`). That makes "last row soft" and "last row hard" look the same, which the design
notes. The hub must not learn about it either: `history_answered` halves `end` on
`TooLarge` (`requests.rs:306-311`), and the fit loop cuts rows. If the extra row lived in
the hub, both of those would have to remember it.
- *Check:* read `requests.rs:262-345` and the 3.7b `cmd-capture-pane.c` exec path.
- *Fix:* `command::op` widens `-E` by one on the paired path. The `clamp()` from F4 drops
  the extra row and reports `Reply::History { rows, wraps }` for exactly the clamped
  request. The hub's halving and fitting then never see it.

**F7. The 3.4 history pair has no tear check.** The design says "capture the pair
atomically". The snapshot list gets that from its before/after `<STATE>` reads and the
in-flight output check (`session.rs:228-235`, which applies only to snapshot panes). The
history group has neither. `capture-pane` is `CMD_AFTERHOOK`, so a waiting hook between the
payload and the pair can let output scroll the range. A shift by k rows then aligns the
pair against different payload rows. With repeated lines it can even succeed and set
wrong bits.
- *Fix:* F4's bracket. The same `history_size` before and after means no scroll happened
  in between. Done as one mechanism, not a second tear check.

### Low

**F8. Budget charging needs one line in the hub.** With F1, the snapshot charge and
reservation don't change. The 3.4 pair (active grid only, after F2) adds roughly two
plain copies of the screen to the group's 1 MiB reply cap (`MAX_REPLY`, `session.rs:19`).
That is about +300 KB at the 500×300 clamp. Such a screen fails today only when
heavily styled, but the daemon-core cap row should say the pair counts. For history, the
fit loop's base cost is `chunk(Vec::new())` (`requests.rs:325`). Build the base with a
full-length map (≤25 B packed, 36 base64 chars plus the key) so the loop stays as it is,
and slice `wraps` to `fit` together with `lines`. The wire cost on a spotty link is about
46 B per ≤200-row chunk, well under 1% of a typical chunk, and zero for snapshots.

**F9. The artifact still carries superseded text, and the proposed spec text would land
the rejected parts.** AGENTS.md: "Specs state the current rule only." The proposed
daemon-core paragraph says "Snapshot and history payloads … carry a packed map" and to
"account map bytes in the existing snapshot … limits". With F1–F3 the snapshot payload
carries nothing, the saved grid has no map, and the restore rule is the split `?7h`.
Rewrite the paragraph accordingly, amend daemon-core §3.5 step 1 (still "`?7l` … instead
of wrapping") and step 3 (CUP for every line), and change `client-architecture.md:123`.
Drop options 1–3 and the frame bullets from the artifact, or mark them rejected, so an
implementer doesn't build from the top section.

## Notes on the brief's questions

- **Where the version branch lives:** preferably nowhere (F5). Otherwise in `Session`,
  fixed at startup and passed down, never in the hub.
- **Two captures in one round trip on 3.4:** yes, and they must be. Both go in the same
  ` ; ` line: the snapshot list (6 → 8 commands, still bracketed by `<STATE>`) or the
  history group (bracketed per F4). The round trip is a local pipe. The real costs are
  reply bytes against `MAX_REPLY` and tmux CPU, not latency.
- **Wire cost on spotty links:** about 0 for snapshots under F1, about 46 B per history
  chunk.
- **Unowned items:** the version decision (F5), lookahead placement (F6), saved-grid
  semantics (F2), the last-row bit (F3), the history range contract (F4), history tear
  detection (F7), and fit-loop accounting (F8). Each now has an owner above.

## Hypotheses (not verified)

- **Dropping the separate `-N -T` capture.** On 3.4, the `-e -N` payload stripped of SGR
  and OSC 8 could stand in for the physical side, which would make it 2 captures instead
  of 3 per grid. Trailing empty cells (`-N`) and real spaces look the same, so it adds a
  second kind of ambiguity. Not probed. Worth a measurement only if F8's reply-cap
  pressure shows up in practice.
- **Empty wrapped continuation rows** (a `W` row followed by an erased row) were not
  built on real tmux, by me or by the design's probes. The fail-closed rule rests on source
  reading.
- **No real iPhone was used.** The `?7h` split rule was checked in `@xterm/headless`
  only, not in the WebGL renderer on device.
