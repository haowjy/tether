# Terminal selection / copy / paste — source research

Lane: read-only source study for tether UX design. No project edits. No other artifacts. No tmux live probe (separate lane). No port 8444.

**Answer first:** xterm.js 6.0.0 serializes copy from the *cell buffer* (not the DOM): it joins rows only when `IBufferLine.isWrapped` is true, trims *empty cells* (not written spaces), and treats wide/combining characters as one string cell with width 2/0. It has **no iOS/touch selection path**. Public APIs that can drive a mobile overlay without private fields are `buffer.getLine` / `isWrapped` / `translateToString` / `getCell`, plus `select` / `getSelection` / `getSelectionPosition` / `onSelectionChange`, plus public `.xterm-screen` metrics. At the time of this research, tether's restore painted **one CUP per visual row with wrap off**, so `isWrapped` was false and copy inserted a newline at every wrap. L3 now reconstructs mapped active-grid wraps in daemon restore bytes; history chunks carry a separate map for the DOM history view. A DOM overlay still must join logical rows or serialize from that buffer API; one `<div>` per visual row (xterm's own accessibility tree) will put hard breaks on wraps. Native xterm mouse selection and `Terminal.paste()` are unusable in tether as configured (`disableStdin`, inert textarea, WebGL, `user-select: none`). Paste already bypasses xterm (`paste-buffer -p`).

**Implementation update (2026-10-23):** the snapshot-wrap change keeps the map inside the
daemon, rebuilds xterm's public `isWrapped` state through ordinary restore bytes, and
does not change the frame or terminal pipeline. The history view joins rows from the
chunk bitmap. The historical blockers and alternatives below remain useful as the
reasoning record; blocker 1 is resolved. Headless verification does not replace the
pending iPhone Safari/WKWebView checks.

---

## Versions and sources

| Item | Value |
|---|---|
| Pinned package | `@xterm/xterm` **6.0.0** (`web/package.json`) |
| npm tarball | `https://registry.npmjs.org/@xterm/xterm/-/xterm-6.0.0.tgz` |
| lock integrity | `sha512-TQwDdQGtwwDt+2cgKDLn0IRaSxYu1tSUjgKarSDkUM0ZNiSRXFpjxEsvc/Zgc5kq5omJ+V0a8/kIM2WD3sMOYg==` |
| Upstream tag | `6.0.0` → `f447274f430fd22513f6adbf9862d19524471c04` (`git ls-remote`) |
| Local sources | `web/node_modules/@xterm/xterm/{src,typings,css}` (152 TS files; **not missing**, so `~/.meridian/ref/xterm.js` was not cloned) |
| Typings | `web/node_modules/@xterm/xterm/typings/xterm.d.ts` |
| Headless twin | `@xterm/headless` **6.0.0** (devDependency; used for isolated POC) |
| Unicode addon | `@xterm/addon-unicode11` **0.9.0** (tether sets `unicode.activeVersion = "11"`) |
| Repo | https://github.com/xtermjs/xterm.js |
| Tag blob base | https://github.com/xtermjs/xterm.js/blob/6.0.0/src/ |

Tether at inspection: branch `main`, `66a5ef9`.

All line numbers below are from the **npm 6.0.0 tree**, which matches tag `6.0.0`.

---

## How xterm selects and serializes text

**Checked.** Selection is a buffer-coordinate model (`SelectionModel`), not `window.getSelection()`. Mouse down/move/up on the terminal element drive it. Copy reads `selectionService.selectionText` and puts `text/plain` on the clipboard.

```203:261:web/node_modules/@xterm/xterm/src/browser/services/SelectionService.ts
  public get selectionText(): string {
    // ...
    // Get first row
    result.push(buffer.translateBufferLineToString(start[1], true, start[0], startRowEndCol));
    // Get middle rows
    for (let i = start[1] + 1; i <= end[1] - 1; i++) {
      const bufferLine = buffer.lines.get(i);
      const lineText = buffer.translateBufferLineToString(i, true);
      if (bufferLine?.isWrapped) {
        result[result.length - 1] += lineText;
      } else {
        result.push(lineText);
      }
    }
    // Get final row: same isWrapped join
    // ...
    const formattedResult = result.map(line => {
      return line.replace(ALL_NON_BREAKING_SPACE_REGEX, ' ');
    }).join(Browser.isWindows ? '\r\n' : '\n');
    return formattedResult;
  }
```

Copy handler (checked):

```32:38:web/node_modules/@xterm/xterm/src/browser/Clipboard.ts
export function copyHandler(ev: ClipboardEvent, selectionService: ISelectionService): void {
  if (ev.clipboardData) {
    ev.clipboardData.setData('text/plain', selectionService.selectionText);
  }
  ev.preventDefault();
}
```

Public wrappers: `hasSelection`, `getSelection` → `selectionText`, `getSelectionPosition`, `select(column, row, length)` → `setSelection`, `selectAll`, `selectLines`, `clearSelection`, `onSelectionChange`.

```1160:1198:web/node_modules/@xterm/xterm/typings/xterm.d.ts
    hasSelection(): boolean;
    getSelection(): string;
    getSelectionPosition(): IBufferRange | undefined;
    clearSelection(): void;
    select(column: number, row: number, length: number): void;
    selectAll(): void;
    selectLines(start: number, end: number): void;
```

**Checked contradiction:** `IBufferCellPosition` is documented as **1-based**, but `getSelectionPosition()` returns `selectionStart`/`selectionEnd` which are **0-based** buffer coordinates (`CoreBrowserTerminal.ts` 981–996 vs typings 1488–1496). Link ranges *are* 1-based (`SelectionService` subtracts 1). Do not mix the two.

`select(column, row, length)`: `row` is a **buffer** index (includes scrollback), `length` is in columns and may span wrapped rows via `selectionStartLength` (`SelectionModel.ts` 78–87).

Word/line select: double-click walks `wordSeparator` default `' ()[]{}\',"`'` (`OptionsService.ts` 54); triple-click uses `getWrappedRangeForLine` so a logical wrapped line is one selection (`SelectionService.ts` 1026–1038).

---

## Soft wraps vs hard newlines

**Checked.** Soft wrap is `BufferLine.isWrapped === true`. It is set only when DECAWM print overflow moves to the next row (or `BufferService.scroll(..., true)` when that overflow hits the scroll bottom). A real LF/VT/FF **clears** wrap on the destination row.

Overflow (soft):

```557:577:web/node_modules/@xterm/xterm/src/common/InputHandler.ts
      if (this._activeBuffer.x + chWidth - oldWidth > cols) {
        if (wraparoundMode) {
          // ...
            this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y)!.isWrapped = true;
```

Hard LF:

```726:731:web/node_modules/@xterm/xterm/src/common/InputHandler.ts
      // There was an explicit line feed (not just a carriage return), so clear the wrapped state of
      // the line.
      this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y)!.isWrapped = false;
```

Public API: `IBufferLine.isWrapped` — “Whether the line is wrapped from the previous line.” `translateToString` “not taking isWrapped into account” (typings 1596–1632). Join is the caller’s job; `getSelection()` and tether `prompt.ts` already do that join.

`getWrappedRangeForLine` scans up while `isWrapped`, down while next `isWrapped` (`Buffer.ts` 543–555).

Windows conpty wrap heuristic exists (`WindowsMode.ts`) and is irrelevant on POSIX.

---

## Trim / spaces

**Checked.** `selectionText` always calls `translateBufferLineToString(..., true)` (trimRight). That trims to `getTrimmedLength()`, which walks backward for `HAS_CONTENT_MASK` (codepoint or combined bit). Space U+0020 **has content** (code 32). Null cells (never written) do not.

```461:468:web/node_modules/@xterm/xterm/src/common/buffer/BufferLine.ts
  public getTrimmedLength(): number {
    for (let i = this.length - 1; i >= 0; --i) {
      if ((this._data[i * CELL_SIZE + Cell.CONTENT] & Content.HAS_CONTENT_MASK)) {
        return i + (this._data[i * CELL_SIZE + Cell.CONTENT] >> Content.WIDTH_SHIFT);
      }
    }
    return 0;
  }
```

POC (headless 6.0.0): `"AB  "` → `translateToString(true)` is `"AB  "` (two written spaces kept); `translateToString(false)` pads the rest of the row with spaces for null cells.

**Stale comment (checked):** `Buffer.translateBufferLineToString` says “Wide characters will count as two columns in the resulting string.” `BufferLine.translateToString` advances by cell width and emits `getChars()` once, so a CJK cell is one string character, not two.

NBSP in the serialized string is rewritten to ASCII space before join (`SelectionService.ts` 255–258).

---

## Unicode wide / combining

**Checked** in `InputHandler` print loop + `BufferLine.translateToString` + POC.

- Width comes from `UnicodeService.charProperties` (tether: Unicode 11 via addon; headless default without addon is version `"6"`).
- Wide char: `getWidth() === 2`, following cell `getWidth() === 0`, `getChars() === ""`.
- Combining: `shouldJoin` stores a combined string on the base cell (`IS_COMBINED_MASK`). `getChars()` is the full cluster; `getCode()` is the **last** codepoint (typings 1638–1656; POC: `e`+U+0301 → chars `"é"`, code 769).
- Selection mouse coords that land on width 0 bump to the next column (`SelectionService.ts` 556–561, 649–659). Word select tracks wide and “long” (emoji) cells separately (`_convertViewportColToCharacterIndex`, `_getWordAt`).
- `translateToString(..., outColumns?)` fills a column map so string offset → cell column (used by `AccessibilityManager` for DOM-selection → `select()`).

POC: `"A中B"` cells `{A w1, 中 w2, "" w0, B w1}`; `translateToString(true) === "A中B"`. `"AB中C"` at 4 cols wraps: row1 `isWrapped: true`.

---

## Bracketed paste

**Checked.** DECSET 2004 sets `decPrivateModes.bracketedPasteMode`. Public `terminal.modes.bracketedPasteMode`. `Terminal.paste(data)`:

```13:54:web/node_modules/@xterm/xterm/src/browser/Clipboard.ts
export function prepareTextForTerminal(text: string): string {
  return text.replace(/\r?\n/g, '\r');
}
export function bracketTextForPaste(text: string, bracketedPasteMode: boolean): string {
  if (bracketedPasteMode) {
    return '\x1b[200~' + text + '\x1b[201~';
  }
  return text;
}
export function paste(...) {
  text = prepareTextForTerminal(text);
  text = bracketTextForPaste(text, coreService.decPrivateModes.bracketedPasteMode && optionsService.rawOptions.ignoreBracketedPasteMode !== true);
  coreService.triggerDataEvent(text, true);
}
```

**Checked blocker in tether’s config:** `triggerDataEvent` returns immediately when `disableStdin` is true (`CoreService.ts` 61–64). So `Terminal.paste()`, textarea `paste`, and `onData` never fire. Tether already pastes out-of-band: native → `{ type: "paste" }` → `load-buffer` + `paste-buffer -p -d` (`command.rs` 139–151). tmux `-p` adds 2004 brackets only if the *pane* enabled bracketed paste — independent of xterm.js mode.

Snapshot restore **does not** restore bracketed paste (`snapshot.rs` 73–74 lists it among unreported modes). That affects xterm’s `modes.bracketedPasteMode` only; it does not affect tmux `paste-buffer -p`.

---

## Mouse / touch / pointer, especially iOS

**Checked: mouse only. No touch/pointer selection.**

| Mechanism | Present? |
|---|---|
| `mousedown` on `.xterm` → `SelectionService.handleMouseDown` | yes (`CoreBrowserTerminal.ts` 545) |
| document `mousemove` / `mouseup` while dragging | yes |
| `touchstart` / `touchmove` / `pointerdown` | **no** (search of `src/`) |
| `isIphone` / `isIpad` | defined in `Platform.ts` 39–40, **never used** in selection/clipboard/mouse |
| iOS long-press / loupe | not implemented |
| CSS | `.xterm { user-select: none }` (`css/xterm.css` 41–43) |
| DOM renderer rows | `pointer-events: none` (`DomRenderer.ts` 168–171) so clicks hit the container, not text |
| WebGL | canvas; selection is a renderer overlay from `SelectionRenderModel`, not DOM text |
| Mouse protocol on | `SelectionService.disable()` (`CoreBrowserTerminal.ts` 727–738) |

`Platform.ts` has `isSafari`, `isMac`, `isIphone`, `isIpad`. Selection only special-cases Mac (alt/option force-select) and Linux (middle-click paste via textarea). Firefox right-click uses `mousedown` button 2 instead of `contextmenu`.

Coords: `MouseService.getCoords` is **not public**. It uses `getBoundingClientRect` + CSS cell size + optional half-cell offset for selection (`input/Mouse.ts` 34–54). Tether already computes cell size from public `.xterm-screen` / `cols` / `rows` (`web/term/xterm.ts` 85–91) — same geometry without private fields. Replicating the half-cell bias is optional (`isSelection ? cssCellWidth / 2 : 0`).

When tmux mouse mode is on, snapshot restore emits `?1000h` / `?1002h` / `?1003h` (`snapshot.rs` 116–127). xterm then **disables** its selection manager. Force-select (Shift, or Mac Option if `macOptionClickForcesSelection`) is a desktop modifier story, not iOS.

---

## Supported APIs for mobile selection (no private fields, no pixel-guessing of glyphs)

Usable without `_service` / private buffer fields:

1. **`terminal.buffer.active.getLine(y)`** → `isWrapped`, `translateToString(trimRight, startCol, endCol)`, `getCell(x).getWidth()/getChars()/getCode()`. `y` is 0-based buffer index (`length` includes scrollback). Proposed API already on (`allowProposedApi: true`).
2. **`select` / `getSelection` / `getSelectionPosition` / `clearSelection` / `onSelectionChange` / `selectLines` / `selectAll`.** `getSelection()` is the wrap-aware serializer. Do not trust the 1-based docs for `getSelectionPosition`.
3. **Column mapping:** if a DOM overlay is used, keep an `outColumns`-style map (string offset → cell column), as `AccessibilityManager` does, then call `select(col, bufferRow, length)`. Do not use `text.length` as a column count (wide/combining).
4. **Hit-testing:** `element.getBoundingClientRect()` of `.xterm-screen` divided by `term.cols`/`term.rows` (already `cellSize()`). That is cell geometry, not reading pixels or private renderer dimensions.
5. **`registerMarker` + OSC 133** — already used for prompt; “Select output” can use the same marks, not pixels.
6. **`modes.mouseTrackingMode` / `modes.bracketedPasteMode` / `modes.wraparoundMode`** — read-only status.

Not a solution:

- **`screenReaderMode` / accessibility tree:** `user-select: text` on `.xterm-accessibility-tree`, one div per *visual* row, `translateToString(true)` with **no wrap join** (`AccessibilityManager.ts` 177–194, `xterm.css` 157). Native copy from that tree hard-breaks wraps. It also maps DOM selection back through `select()`, which still needs `isWrapped` for `getSelection()`.
- **`Terminal.paste()` / helper textarea:** dead under `disableStdin`; tether sets `textarea.inert = true` and `tabIndex = -1` (`web/term/xterm.ts` 22–41).
- **Guessing wrap as “row is full”:** not an xterm API; fails on a hard newline after an exactly-full row.
- **Reading WebGL/DOM glyph pixels.**
- **Serialize addon:** not in tether’s dependencies; not required if you walk `getLine`.

---

## Tether snapshot replay vs wrap metadata

### What the daemon captures

```63:74:src/tmux/command.rs
pub fn snapshot(pane: PaneId) -> Group {
    // ...
        format!("capture-pane -p -e -N -t {pane}"),
        format!("capture-pane -p -P -C -t {pane}"),
        format!("capture-pane -p -e -N -a -q -t {pane}"),
```

Flags: print, SGR (`-e`), keep trailing spaces (`-N`). **No `-J` (join wraps).** One reply line = one visual grid row. History op is `capture-pane -p -e` **without `-N`** (`command.rs` 135–136), so tmux strips trailing spaces there.

`STATE_FORMAT` includes `#{wrap_flag}` (DECAWM), not per-row wrap (`snapshot.rs` 15–21). Compose comment: bracketed paste, pending wrap, current SGR pen, etc. are **not** restored (`snapshot.rs` 73–74).

### How restore is painted

```167:173:src/tmux/snapshot.rs
fn paint(out: &mut Vec<u8>, captured: &[Bytes], rows: u32) {
    for (line, row) in (0..rows).zip(captured).filter(|(_, row)| !row.is_empty()) {
        cup(out, line, 0);
        out.extend_from_slice(row);
    }
}
```

Wrap is **disabled** for the whole paint (`\x1b[?7l` at `compose` start), then each non-empty row is CUP’d to column 0. DECAWM is turned back on only if `wrap_flag` after paint. No overflow can occur, so **no `isWrapped` bit is set**.

`WritePipeline.snapshot` does `reset → resize → write(restore)` (`web/term/pipeline.ts` 51–56). `reset()` also clears wrap flags in xterm (`InputHandler` reset paths set `isWrapped = false`).

Live `%output` after the snapshot *can* set wrap on new overflow. Anything restored from capture (the whole visible screen, and the saved primary) will look wrapped on screen and copy as separate lines.

Tether already depends on wrap bits for the prompt: `web/term/prompt.ts` `rowsText` returns null if a continuation row is not `isWrapped`, and joins with `translateToString(false, ...)`. L3 now reconstructs that wrap state during restore. Prompt extraction can still be unavailable after a snapshot because `PromptTracker.reset` drops the OSC 133 marks; it resumes when the application emits them again, independently of the restored wrap bits.

`TerminalRenderer` (`web/term/index.ts`) exposes no selection/copy API.

### POC (isolated `@xterm/headless` 6.0.0, no tmux)

```
LIVE wrap "ABCDEFGHIJKL" cols=8
  y0 wrapped=false t="ABCDEFGH"
  y1 wrapped=true  t="IJKL"
  selection-like join: "ABCDEFGHIJKL"

HARD CRLF "ABCD\\r\\nEFGH"
  y0 wrapped=false t="ABCD"
  y1 wrapped=false t="EFGH"
  selection-like join: "ABCD\\nEFGH"

RESTORE CUP-per-row of the same visual cells (compose-like: ?7l, CUP, ?7h)
  y0 wrapped=false t="ABCDEFGH"
  y1 wrapped=false t="IJKL"
  selection-like join: "ABCDEFGH\\nIJKL"   ← newline injected

wrap off overflow "ABCDEFGHIJKL"
  t="ABCDEFGL" (last column overwritten)

CSI ? 2004 h → modes.bracketedPasteMode === true
unicode.activeVersion without addon === "6"
```

---

## Structural blockers (concrete)

1. **Resolved by L3 — snapshot wrap metadata.** CUP-per-row + `?7l` could not reconstruct `isWrapped`. L3 now pairs physical and joined tmux captures, then replays only an unambiguous continuation's first character with autowrap enabled. `getSelection()`, word/line select and prompt joins can use xterm's ordinary `isWrapped` state after restore. The underlying finding remains: capture alone does not restore this state. (tmux `capture-pane -e` is already documented in `docs/design/research/tmux-control-mode.md` as not preserving wrap-as-state; this lane did not re-read tmux `cmd-capture-pane.c`.)
2. **xterm selection is mouse-only; CSS `user-select: none`; WebGL has no selectable text.** iOS long-press / loupe / Copy menu will not appear on the terminal as shipped. `isIphone` is unused.
3. **`disableStdin` + inert textarea** kill xterm copy-from-textarea and all `paste()`/`onData` paths. Intentional (native keyboard). Copy/paste must be app-owned.
4. **Restored tmux mouse modes disable `SelectionService`.** Even desktop xterm selection stops.
5. **A DOM overlay does not automatically copy correctly.** xterm’s own accessibility overlay is the existence proof: one node per visual row, no wrap join, `translateToString(true)`. WebKit copy of that structure is visual lines. Column metrics must use a cell-column map, not string length, or CJK/emoji handles land on the wrong cell.
6. **`getSelectionPosition` origin is 0-based despite 1-based typings.** Easy to implement the overlay mapping off-by-one.
7. **Unicode width drift** (tmux grid vs Unicode 11 in the browser) can desync columns vs captured rows; already noted in the tmux research note. Not re-measured here.

---

## Supported choices (design, not implementation)

**Copy serialization (do this regardless of UI):** walk `buffer.active` with the same algorithm as `selectionText` (join on `isWrapped`, `translateToString(true)` for the selected column range, `\n` between non-wrapped rows). That is the supported serializer. It is only as correct as wrap bits.

**Hit-testing:** public `.xterm-screen` rect / `cellSize()` → `(col, viewportRow)` → `viewportY + row` buffer index → `select` or a custom highlight. No private `MouseService`.

**iOS UI:** do not expect xterm’s mouse selection or WebKit selection of the WebGL/DOM renderer. If the product overlay uses WebKit’s selection handles (plan.md), the overlay text nodes must represent *logical* lines (joined wraps) **or** copy must be intercepted (`copy` event) and replaced with `getSelection()` / the buffer walk. Do not assume “same metrics + `user-select: text`” yields the right clipboard. If the overlay is custom handles (not WebKit), still serialize from the buffer API.

**Wrap after snapshot — settled implementation:**

Pair `-N -T` physical rows with `-J` joined rows, in one tmux command group on every
supported version. Set only unambiguous wrap bits. The daemon uses the active-grid map
while composing restore bytes; history chunks carry a packed map that the history view
joins. The snapshot frame and terminal pipeline do not carry or consume a map.

Rejected: full-row heuristics (wrong for exact-width hard lines), `-F` (unavailable on
the minimum tmux), private grid dumps, a snapshot frame field, and accepting hard
newlines after reconnect as a permanent limitation.

**Paste:** keep tmux `paste-buffer -p`. Do not turn on xterm stdin/paste. Bracketed paste is tmux’s pane mode, not xterm’s.

**Do not:** enable `screenReaderMode` as a copy hack; read private selection fields; sample canvas pixels; rely on synthesized mouse events from iOS long-press.

---

## Checked vs inferred

| Claim | Status |
|---|---|
| `selectionText` join/trim/NBSP/Windows CRLF | Checked in `SelectionService.ts` |
| `isWrapped` set on DECAWM overflow, cleared on LF | Checked in `InputHandler.ts` |
| CUP-per-row restore leaves `isWrapped` false | Checked in `snapshot.rs` + headless POC |
| Trim keeps written spaces, drops null cells | Checked in `BufferLine.ts` + POC |
| Wide/combining cell layout and `translateToString` | Checked + POC |
| No touch/pointer selection; `isIphone` unused | Checked (repo search) |
| `user-select: none`; DOM rows `pointer-events: none` | Checked CSS/DomRenderer |
| `disableStdin` swallows `paste`/`onData` | Checked `CoreService.ts` |
| Tether paste is `paste-buffer -p`, not xterm | Checked `command.rs`, `web/tabs/input.ts` |
| Mouse protocol disables selection | Checked `CoreBrowserTerminal.ts` |
| `getSelectionPosition` 0-based vs 1-based docs | Checked |
| Accessibility tree copies per visual row | Checked `AccessibilityManager.ts` |
| tmux `capture-pane` does not emit wrap flags | **Inferred** from tether’s flags + existing design research; tmux C source not re-read this lane |
| WebKit overlay copy inserts `\n` between block divs | **Inferred** HTML behavior; iOS WKWebView not probed (other lane) |
| iOS long-press vs first responder / keyboard | **Not probed** (`ios-shell.md` already flags it); other lane |
| Unicode 11 vs tmux widths on emoji/Nerd Font | **Not measured**; addon present, headless POC used default Unicode 6 |

---

## Uncertainties / follow-ups for other lanes

- tmux probe: does any `capture-pane` flag or format expose `GRID_LINE_WRAPPED` per row?
- Browser/WKWebView: long-press + `user-select: text` overlay vs native first responder (plan.md / ios-shell.md).
- Whether history is ever written into xterm scrollback (the current path joins bytes for the DOM history view); if that changes, preserve the same wrap mapping and trailing-space semantics.
