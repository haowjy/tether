# W2 notes: terminal and desktop input

For the lead to fold into `docs/design/decisions.md`, `browser-behaviors.md`, plan.md and
CHANGELOG.md. Design: [client-architecture.md](../design/client-architecture.md) rev 4 §5.4, §6.4,
§7.1 to §7.5. Requests for W0-owned files: [w2-requests.md](w2-requests.md).

## Decisions, with the alternatives rejected

1. **The renderer, its element and every driver live in `screens/terminal/terminals.ts`, outside
   Preact.** `TerminalScreen` places the element and draws state. Rejected: a component that owns the
   renderer (it unmounts under an admission problem and loses the buffer and every watch, which §6.5
   forbids); a context provider in `app/` (W0's file, for state only this screen reads).
2. **Cmd combinations are the browser's on every platform, and Ctrl+Shift+C copies on every platform.**
   §7.2 says "on macOS" and "elsewhere", but telling them apart needs `navigator`, which lint rule 3
   confines to `platform/`. Rejected: a `mac` field on `Viewport` (a new adapter fact for no lost key:
   nobody sends Super+key to a shell, and Ctrl+Shift+C is not `^C` in any terminal); a lint exemption.
   Option on macOS needs nothing: xterm's `macOptionIsMeta: false` is its own default.
3. **Keystrokes are batched for 8 ms into one `input` message** (`terminals.ts`). The daemon refuses a
   burst of separate messages with `busy` once enough are in flight; a refused input names no request,
   so `Host` drops the error and characters vanish. Seen in WebKit under CPU load: a 70-character
   command arrived cut off. Rejected: one message per keystroke (the cause); a longer window (adds
   echo latency for nothing).
4. **tmux is sized by one formula over the stable box, the chrome measured from the surface.**
   `chrome = stable box less the surface`, measured only while `viewport.keyboard` is false, so a
   native web view that shrinks for the keyboard never changes it. The first `watch` claims the first
   measured size; later changes go out 150 ms after the last (`term/size.ts`). Nothing watches before
   the renderer has a cell size, so tmux never sees 80x24.
5. **The surface is hidden (`data-blank`, opacity 0) until the shown tab's own snapshot paints.** Another
   tab's content never sits under a pill that isn't its own, and an empty terminal doesn't look live.
   Rejected: `visibility: hidden` (the input must stay focusable); clearing the buffer on switch (the
   next snapshot resets it anyway).
6. **`limited` is a connection state, not a halt.** The reducer keeps the daemon's message, climbs the
   backoff on each refusal (500 ms, 1 s, 2 s…), and Retry asks at once without resetting the count
   (resource-limits.md §3.6). A lost socket supersedes it. Its pill is error-coloured even off screen.
7. **A restored tab shows `Checking…` and the reconnecting colour until a `watching` reply or the first
   listing proves its window (§6.2).** The band appears after 1.5 s, like "Connecting to…".
8. **Desktop toolbar ends with the host's name, coloured by the active tab's connection.** The contract
   asks for colour on "the tab and host label"; the mockup's label sat inside sample terminal text.
   Phone has no room for it.
9. **Late focus.** The first time a tab opens the input element doesn't exist yet (fonts load first), so
   the focus effect finds nothing. `terminals.ts` focuses it when it appears, if Terminal is the screen
   and nothing else holds the focus.
10. **Paste reports "sent".** `driver.input([{ paste }])` returns false when the tab isn't watching
    ("Not pasted: the tab isn't connected"); a daemon refusal (`busy`, `inputTooLarge`) carries no `req`
    yet and is dropped by `Host`. L4 adds both.
11. **Image paste** uploads through `platform.uploads.send`, then types the quoted path into the tab it
    was pasted in, only if that tab is `live` when the upload ends; otherwise a notice says the file is
    in Files. Without `uploads.send`: "Paste images from Files → Upload".
12. **`bufferText(rows)` takes `{ from, to }`** (buffer rows, `to` exclusive) and joins by `isWrapped`;
    trailing blanks go only where a logical line ends.

## For the log and the contract

- `tests/fixtures/proto/keys.json` grew from 175 to 306 names: every name the key handler can make
  (`S-` before F-keys, `C-M-S-` navigation, `C-0`..`C-9`, `M-Tab`, `M-Space`...). All match the daemon's
  regex (checked in `tabs/keymap.test.ts` and again in Python); the Rust test reads the file as before.
- The 4th-session test uses `memory_budget_mib = 58` (one tmux session, three sockets). With the default
  72 MiB a fourth *page* meets the 3-socket cap (4005) before a fourth session: only one watch can be
  live per page, so the limit is unreachable from browser pages.
- The daemon's refusal reads "allows 1 tmux sessions at a time" (src/hub/owners.rs:336, no plural).
- The daemon can't answer `/auth/info` without tailscaled, so `e2e/terminal/stack.ts` runs it with
  `--allow-login e2e` and its front proxy, standing in for Serve, answers `/auth/info` itself.
- A page's `watch` is its only user of a control client; a lingering one frees itself for the next watch
  (confirmed: Retry succeeds the moment the other window closes).
