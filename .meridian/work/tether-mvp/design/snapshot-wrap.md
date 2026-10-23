# Snapshot soft-wrap loss — investigation and proposed design

## Findings summary

- Source inspection predicts the failure: snapshot rows are repainted at explicit CUP positions, while xterm selection joins only `isWrapped` rows.
- The provided tmux 3.4 probe found `-J` joins soft wraps, but local verification was still needed.
- `tmux -V` on this Mac reports 3.8, not 3.7b. The isolated runtime probe used only fresh-TMPDIR dedicated `-L tether-wrap-…` servers; default sessions were untouched.
- No project source edits are planned; this artifact contains causal evidence and a proposal.

## Root cause / causal chain (reproduced)

1. `src/tmux/command.rs:68-76` requests visible/alternate grid rows using `capture-pane -p -e -N` (`-N` includes unused trailing cells); it does not ask tmux to join wrapped rows or return their wrap flags. History uses the same row-oriented model without `-N` at `command.rs:101-102`.
2. `src/tmux/snapshot.rs:137-143` emits a CUP to column 1 for every captured row, with no row-continuation metadata. Thus it reconstructs identical-looking visual rows but not the terminal's logical line relationship. It also starts painting with DEC autowrap off (`snapshot.rs:75-77`) so an over-wide captured row cannot cause scroll.
3. Snapshot frame `src/proto/frames.rs:4-7, 52-59` carries only size + restore bytes. `web/term/pipeline.ts:57-60` resets/resizes and writes those bytes into xterm; no wrap metadata or second restoration step exists.
4. In pinned xterm 6.0.0, `IBufferLine.isWrapped` is set by actual autowrap, and selection serialization joins rows only when the following row's `isWrapped` is true (evidence and source excerpts in `docs/design/client/terminal-selection-source-research.md`). The row-by-row restore leaves it false; selection therefore inserts `\n` at a former soft-wrap boundary.

Reproduction loop run against installed `@xterm/headless` 6.0.0 in a 12×3 terminal (synthetic content): write `abcdefghijklmnopqr\r\nHARD-A`, observe row flags `[false, true, false]`; reset then apply the current row-wise restore shape (`?7l`, CUP+`abcdefghijkl`, CUP+`mnopqr`, CUP+`HARD-A`) and observe `[false, false, false]`. No project source was edited. The proposed normal-write replay (`abcdefghijklmnopqr\r\nHARD-A`, no CUP at the soft wrap, CRLF only at the hard newline) gives `[false, true, false]` in the same loop.

The repo's accepted UX design already says restore loses wrap metadata and must be fixed before copy after reconnect/history (`docs/design/plan.md:448-453`).

## Design proposal (row map found on tmux 3.7b+; 3.4 fallback is a policy decision)

**Use tmux's existing per-row `-F` flag as the source, a packed row-wrap map as the protocol representation, and xterm's normal autowrap parser to restore.** This is the narrow boundary that keeps tmux authoritative and xterm public APIs intact. tmux 3.7b's capture implementation accepts `-F` and emits `W` when a grid row has `GRID_LINE_WRAPPED`; this is the row's “wraps to the next physical row” bit (opposite the xterm naming convention `next.isWrapped`). The isolated tmux 3.8 probe confirmed `capture-pane -p -e -N -F` returns one record per physical row, flags it with `W`, and preserves the current `-N` cell data. `-L` additionally returns physical row numbers but is not needed when the capture already returns all requested rows in order; omit it on hot paths to avoid extra bytes.

- For snapshot `active` and `saved` captures, add `-F` alongside existing `-e -N`; parse the documented metadata prefix out of each row and keep its content bytes unchanged. In the same `PaneSnapshot`, retain a bitset where bit *i* means physical row *i* wraps forward to row *i+1*. Do this per grid; don't confuse `PaneState.wrap_flag` (DECAWM mode) with row wrap flags.
- For restore, temporarily enable xterm autowrap, CUP to row 0, and paint each `-N` row unchanged. Before row *i*, CUP to `(i,0)` when the preceding row's bit is 0; when preceding row's bit is 1, do not CUP, so the first cell naturally overflows the full-width preceding row and xterm sets `isWrapped` on it. Restore pane modes/cursor after painting. This must be verified with wide/combining characters, escape/style spans, hard exact-width rows and the existing width-drift cases; only a bit-marked boundary should omit the CUP. The screenshot's data continues to come from the fidelity-preserving `-N` rows.
- Extend snapshot frame with explicit length-delimited active and saved packed maps, and thread them through Rust frame/outbox types, web decoder and `web/term/pipeline.ts` `Snapshot`. Explicit lengths matter because saved primary and active screens need not have the same row count. Keep xterm restore logic on normal `term.write()` input, not private buffer mutation.
- For history, add `-F` to the existing physical-row `capture-pane -p -e -S … -E …` command and parse each row's W bit. Carry a packed `wraps` field beside the Base64 `lines` in `HistoryChunk`, with bit *i* meaning row *i* wraps forward. Keep `start`, `lines.length`, the 200-physical-row cap and pagination unchanged. The DOM history renderer/selection serializer joins row *i* to row *i+1* when bit *i* is set. If a response is truncated by byte budget or retried with fewer rows, truncate line and map together; preserve the final row's W bit if its continuation lies beyond this chunk so adjacent chunks can join.
- `-L` can be added to diagnostic/probe captures, and may be useful for history range verification; the p30 probe showed line numbers remain physical even with `-J`. Production can avoid it because row order plus the requested `start` supplies positions.

**tmux 3.4 compatibility:** source at tag 3.4's `capture-pane` argument string does not accept `-F` or `-L` (https://raw.githubusercontent.com/tmux/tmux/3.4/cmd-capture-pane.c, lines 33-45); `-J` exists. Tag 3.7b accepts `F` and `L` (https://raw.githubusercontent.com/tmux/tmux/3.7b/cmd-capture-pane.c, lines 36-47) and emits `W` for `GRID_LINE_WRAPPED` (lines 249-274). Thus the best low-cost fix is exact for 3.7b/3.8, but it cannot be blindly issued to the currently supported 3.4 minimum. Before coding, settle one explicit fallback policy:

1. **Keep 3.4 support and use `-J` logical-line replay there:** it preserves the hard/soft break distinction without guesses, then natural width-based replay into xterm will set `isWrapped`; however `-J` implies `-T` and strips unused tail cells, so colored/padded blank-cell fidelity must be probed. For history it also collapses physical rows, so a `-J` fallback alone breaks current offsets/chunk advancement; don't silently use it there.
2. **Keep existing capture behavior on 3.4:** visible restore remains visually unchanged, but copy after snapshot is still known-bad there; explicitly limit the guarantee to tmux versions that expose W and do not claim the bug fixed for all supported versions.
3. **Provide a supported tmux-side row-flag API or raise the supported minimum:** cleaner than parsing `-R`'s diagnostic grid dump, which is an unstable private representation; this is broader than the scoped code change.

The 3.4 history fallback has no equally cheap exact solution discovered here. Do not guess from row fullness, and do not parse `-R`. Keeping physical `-N` rows plus an authoritative W map is the design target; a separate policy decision is required if 3.4 must be fully covered. This compatibility gate should be decided in the design/decision log before implementation.

**Alternatives rejected:**

- `-J` as the sole snapshot/history payload: it suppresses physical row boundaries and drops unused tail cells; history offsets/chunking depend on physical rows.
- Extra `-J -L` capture to infer starts: unnecessary on 3.7b+, duplicates logical text in control replies and consumes tmux CPU/reply memory; `-F` directly reports W.
- Guess wrap where row is full: exact-width hard lines and width drift make it false.
- Change xterm copy behavior or mutate private `isWrapped`: xterm selection already joins correctly when metadata exists; private buffer mutation is not a supported restore API.
- Bitmap without changing repaint: xterm does not accept a wrap bit via its public `write()` API; replay through ordinary autowrap is required.

### Byte and memory cost (estimate)

A packed bitmap costs `ceil(row_count/8)` bytes: 3 B per 24-row grid, 38 B per max-300-row grid, 76 B if both screen maps are present; 25 B for a 200-row history chunk. A bool-per-row vector would cost 24/300/200 bytes respectively; use packed bytes. The metadata `-F` prefix is added only on the local tmux control stream and stripped before restore: roughly a few bytes per captured row (row flag + separator; with optional `-L`, up to six-digit line number plus separator), typically under 1 KiB for 300 snapshot rows and up to about 2.8 KiB for 200 history rows with `-L`; avoid `-L` in production unless required. The binary snapshot header remains 9 B; each map adds raw packed bytes, not base64. History JSON base64 line payload dominates; a 25-byte `wraps` field adds about 36 base64 characters plus JSON overhead, under the existing 1 MiB capture reservation. Include packed map bytes in `ToConn::charge`/snapshot reservation and count the history field in the existing encoded JSON cost loop; map memory is <=76 B per snapshot plus 25 B per history chunk, while existing capture reply rows and 1 MiB limits dominate.

## Verification and version notes

- Runtime: tmux 3.8 (local `tmux -V`), not 3.7b. The probe created/used/killed isolated `tether-wrap-p29-…` / `tether-wrap-…` sockets, set fresh `$TMUX_TMPDIR`, used synthetic pane content, and cleaned its server/temp resources. It never targeted the default socket. No 3.4 or 3.7b binary is installed for this run; the 3.4 evidence is the already supplied probe.
- At width 12, `capture-pane -p -e -N` returned physical rows separately, including right padding; `-N -J` joined actual wrapped rows, preserved hard breaks and exact-width hard lines, joined a CJK-wide wrap correctly, and stripped unused trailing padding. This confirms logical text is authoritative but not a physical-grid-preserving replacement.
- Example from the probe: source `abcdefghijklmnopqrstuvwx`, then `HARD-A`, `HARD-B` became rows `abcdefghijkl`, `mnopqrstuvwx`, `HARD-A      `, `HARD-B      ` with `-N`; `-N -J` returned logical lines `abcdefghijklmnopqrstuvwx`, `HARD-A`, `HARD-B` (padding removed). A second fixture confirmed exact-width `EXACT1234567` followed by hard newline remained separate and `WRAP-abcdefghijklmno` joined.
- History range probe showed `-S`/`-E` ranges address physical tmux rows; `-J` would reduce returned line count, so it cannot replace the existing row count/offset contract alone.
- A follow-up isolated probe confirmed `-F -L` reports physical row numbers and `W` wrap-forward flags; `-J -L` preserves numbers but joins text directly to following prefixes, so do not parse it as the sole map representation. Official tag source comparison: 3.4 lacks capture `-F`/`-L`; 3.7b implements them and maps W from `GRID_LINE_WRAPPED`. Local runtime confirms 3.8. No 3.4 or 3.7b binary was installed for runtime A/B testing; the version difference is source-level plus 3.8 runtime.
