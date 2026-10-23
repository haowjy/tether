# iOS shell: the native app

> **Client UX update (2026-10-22):** Start with [client design and Mac handoff](client/README.md).
> Its approved browser/mobile navigation and minimal layout supersede conflicting
> UI rules below. Subsystem invariants remain in force; touch, clipboard, and local
> draft proposals retain explicit prototype/device gates.

This document is a target design, not a claim that the production app exists. Only the keyboard spike is currently available in `ios/spikes/keyboard`.

tether's phone client is a Swift app: a `WKWebView` runs the web UI (terminal, tabs,
sheets, file manager), and native code owns the keyboard, auth, media and lifecycle.
The web UI is bundled in the app and served from a custom scheme. The app connects to
each host's daemon directly. The terminal's keystrokes come from a native first
responder, not from a text field in the page.

Auth is in [auth.md](auth.md), the wire protocol in
[daemon-core.md §5](daemon-core.md#5-srcproto-the-wire-protocol), and spike 1, which
gates this design, in [spike-1-keyboard.md](spike-1-keyboard.md). Reasons and rejected
alternatives are in [decisions.md](decisions.md).

```mermaid
flowchart LR
  subgraph app["tether.app (iPhone)"]
    subgraph native["Native (UIKit, Swift)"]
      input["TerminalInputView<br/>first responder"]
      acc["Accessory<br/>key row, compose, paste"]
      focus["FocusController"]
      auth["Unlocker + TokenStore"]
      scheme["AppSchemeHandler<br/>assets + host proxy"]
      media["Media picker + Uploader"]
    end
    subgraph web["WKWebView: web UI (Preact, xterm.js)"]
      ui["tabs, terminal, sheets, files"]
      link["HostLink per host<br/>(WebSocket)"]
    end
  end
  h1["host A daemon<br/>tailscale serve"]
  h2["host B daemon (v2)"]
  input -- "bridge: input events" --> ui
  ui -- "bridge: focus, haptics, token" --> focus
  ui -- "tether-app://h-{host}/…" --> scheme
  scheme -- "HTTPS + Bearer" --> h1
  media -- "upload, Bearer" --> h1
  link -- "wss, token in subprotocol" --> h1
  link -.-> h2
```

## What is native and what is web

Native code takes what WebKit can't do well on iOS, or what must not depend on the
web content process: keyboard ownership, secrets, system integration. Everything a
user looks at for long stays in the web UI, so Jimmy iterates on it without
rebuilding the app.

| Native (Swift) | Web (`web/`, in the WKWebView) |
|---|---|
| Keyboard: the first responder, software and hardware keys, modifiers | Terminal rendering (xterm.js), touch gestures, selection overlay |
| Accessory above the keyboard: key row, compose field, paste control | Tab bar, suggestion strip, `[+]` session sheet |
| Focus: who holds the keyboard, and lending it to web text inputs | File manager and viewers; the editor (v2) |
| Keyboard geometry: sizing the web view | Host protocol: WebSocket per host, tabs, reconnect |
| Auth: Face ID lock, tokens in the Keychain, lock screen | |
| Hosts: host list, Add host and enrolment screens | Host picker in the `[+]` sheet (from the native host list) |
| Media: photo picker, camera, image paste, HEIC→JPEG, uploads | Upload chips, path insertion through the normal input path |
| Haptics, short text prompts, video player, share extension (later) | Requests for them, over the bridge |
| Lifecycle and network signals; saved tab list | Reacting to them: reconnect, restore tabs |

The keyboard-shown layout from [plan.md](plan.md#layout), split by owner:

```text
┌──────────────────────────────────────┐
│ terminal (web; same rows, pans so    │  WKWebView, frame ends at the
│ the cursor row stays visible)        │  top of the accessory
│ [<] (●main:1 ×)(◌api:2 ×)…   [+] [⊞] │  web: tab bar
│ git checkout ‹feat/›‹main›‹--track›  │  web: suggestion strip
├──────────────────────────────────────┤
│ ┌ compose (optional) ───────[Paste]┐ │  native inputAccessoryView
│ esc  tab  ctrl  ⇧tab ▸swipe     [⌨̲] │  native key row
├──────────────────────────────────────┤
│           iOS keyboard               │  system; no ⌃ ⌄ ✓ bar: that bar
└──────────────────────────────────────┘  belongs to WebKit form fields
```

## Where the web UI comes from

The native app's web UI is **bundled in the app** and served by a
`WKURLSchemeHandler`, with a Debug-build switch that takes the assets from a dev
server instead. Separately, the daemon embeds and serves the production browser build
at its canonical tailnet origin ([auth.md](auth.md#canonical-origin)); the iOS app
does not load that copy or register its service worker.

**The scheme handler** (`ios/Tether/Web/AppSchemeHandler.swift`) serves two kinds of
origin:

- **`tether-app://ui/`**: web assets, from the app bundle's `WebUI/` folder or, in dev
  mode, the dev server. The page and its scripts live here.
- **`tether-app://h-{host_id}/…`**: a proxy to that host's daemon (`/fs/*`,
  `/complete`) over HTTPS, with `Authorization: Bearer`
  ([auth.md](auth.md#carrying-the-token)). Each host gets its own origin, different
  from the UI's, so the UI's `script-src 'self'` can never cover a daemon response.
  The handler forwards the method (`GET`, `POST`, and `PUT` in v2) and the body;
  streams the response; passes the request headers `Range`, `If-Match`, `Content-Type`
  and the response headers `Content-Range`, `ETag`, `Content-Type`; adds the security
  headers below and `Access-Control-Allow-Origin: tether-app://ui`, since the page
  fetches these cross-origin. It also adds `Access-Control-Expose-Headers:
  Content-Range, ETag`: a cross-origin page can read only the CORS-safelisted response
  headers (`Content-Type`, `Content-Length` and a few others), so without the list the
  page could not read the file size from `Content-Range` or the validator from `ETag`.
  Dev mode never shows the gap, because the Vite proxy makes everything same-origin.
  It answers a CORS preflight (`OPTIONS`) itself, allowing
  `tether-app://ui`, those methods and those request headers, and never forwards one:
  the daemon answers no preflight ([auth.md](auth.md#carrying-the-token)). The routes
  are in [fs.md](fs.md). After `webView(_:stop:)` it cancels the
  upstream request and never calls that task again (WebKit raises an exception if it
  does).
  - **Compatibility gate:** the handler proxies to a host only once that host's
    `GET /auth/info` has reported, in this app session, a protocol range that contains
    the app's version; otherwise it answers `409 {"error": "incompatible"}` without
    contacting the daemon. The protocol version covers the HTTP routes
    ([daemon-core.md §5.2](daemon-core.md#52-handshake-and-versions)).
  - **A `401`** means the device was removed from that host: the handler marks it "not
    enrolled" and passes the `401` on, without retrying.

The native web UI builds every host URL through one function, from the host entry's
`baseURL` ([payloads](#boot-and-host-payloads)), and the native adapter supplies a
device token for each host. The production browser adapter uses `location.origin`
and carries no credential; the daemon judges it as an enrolled tailnet node. Native
requests continue to present their token and use the same endpoints without browser
Origin checks.

### Web content security

The page holds the WebSocket token and can call the bridge, and the file viewer shows
files from repos and agent output. Untrusted content must never run as script in
`tether-app://ui`:

- **Navigation.** A `WKNavigationDelegate` allows only the app's own document
  (`tether-app://ui/index.html`, and reloads of it) in the main frame. Every other
  navigation, link or `window.open` is cancelled; `http`, `https` and `mailto` URLs go
  to `openURL` (Safari), anything else is dropped. In-app links (a relative link in
  rendered Markdown, a file path) are intercepted by the web router first. The web
  viewers use no iframes.
- **Bridge.** The `tether` message handler rejects any message whose
  `frameInfo.isMainFrame` is false or whose frame origin isn't `tether-app://ui`.
- **CSP on the app's assets**, a response header set by the scheme handler:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src
  'self' tether-app: blob: data:; media-src 'self' blob:; connect-src 'self'
  tether-app: wss:; frame-src 'none'; object-src 'none'; base-uri 'none'` (`wss:`
  because each host's socket is on its own `*.ts.net` name). In Debug dev-server mode
  the handler relaxes it as far as Vite's dev client needs, never in a release build.
- **Every proxied response** also gets `Content-Security-Policy: sandbox` and
  `X-Content-Type-Options: nosniff`.
- Rendered Markdown and Mermaid stay behind DOMPurify and Mermaid's strict mode
  ([plan.md](plan.md#security)).

**Video** doesn't go through the scheme handler: custom-scheme media loading has a
history of dropping `Range` (WebKit bug 203302, fixed 2021, unverified on iOS 26). The
web asks native to play a video, and native opens `AVPlayerViewController` on the
daemon's `/fs/raw` URL with the Authorization header (`AVURLAssetHTTPHeaderFieldsKey`).
The file-manager spike checks it; if the header option fails, add a short-lived
single-path media ticket to auth, not before.

**Dev mode** (Debug builds; Settings → Web UI source):

- *Bundled* (default).
- *Dev server* at a URL such as `https://devbox.tail…ts.net:8443`, published with
  `tailscale serve` ([plan.md](plan.md#running-the-phone-spikes)). The handler fetches
  assets from it; the origin stays `tether-app://ui`, so auth, storage and the host
  proxy behave as in a release build. Vite HMR connects to an explicit `server.hmr = {
  protocol: "wss", host, clientPort: 8443 }`. Vite 6.0.9+ requires its HMR token: keep
  the check on; if it blocks the custom scheme, fall back to reloading (a three-finger
  double tap reloads the web view in Debug).
- Web Inspector: `webView.isInspectable = true` in Debug.
- A desktop browser also runs the web UI against a real daemon: the host-URL function
  points at a Vite proxy that connects to `local.sock` via `TETHER_SOCKET` and adds a
  token from `tether device add` ([auth.md](auth.md#cli)). A dev shim stands in for
  the bridge (DOM key events as input, no haptics). Playwright uses the same path.

The release build runs `scripts/build-web.sh` from an Xcode build phase (`vite build`,
output copied to `WebUI/`), so a release app always carries the web UI from the same
commit.

## Transport

**The WebSocket lives in the web UI**, one per host (`web/src/net/HostLink`). Output
frames go daemon → JS with no bridge crossing; keystrokes cross the bridge once
(native → JS) before going out on the socket.

*Fallback, behind the same `HostLink` interface:* a native `URLSessionWebSocketTask`
per host, with output forwarded to JS over the bridge as base64. Keystroke to echo
crosses the bridge once either way, so bridge latency can't favour the native socket;
under heavy output it only makes it worse. What decides is socket reliability:

- **Spike 3** (in the app, against a real daemon): if a WKWebView WebSocket gets
  stuck after resume and the stuck-socket recovery ([plan.md](plan.md#reconnect)) doesn't
  clear it, the socket moves to native.
- **Spike 1** measures the keystroke crossing as an acceptance check: p99 under a
  1 MB/s output flood within one 60 Hz frame (16 ms)
  ([spike-1-keyboard.md](spike-1-keyboard.md#what-the-numbers-decide)).

## Keyboard

### The input responder

`TerminalInputView: UIView, UIKeyInput` is the first responder whenever the terminal
has the keyboard. It is invisible and zero-size, and sits in the root view, not inside
the web view.

- `UIKeyInput`, not `UITextInput` or a hidden `UITextView`: terminal input is sent the
  moment it's typed, so there is nothing for autocorrect, marked text or predictions
  to edit afterwards.
- Traits: `autocorrectionType = .no`, `autocapitalizationType = .none`,
  `spellCheckingType = .no`, `smartQuotesType = .no`, `smartDashesType = .no`,
  `smartInsertDeleteType = .no`, `inlinePredictionType = .no`,
  `keyboardType = .asciiCapable`, `returnKeyType = .default`.
- `hasText` always returns `true`, so Backspace reaches `deleteBackward` on an empty
  line.
- `insertText("\n")` sends Enter; `deleteBackward()` sends BSpace; other text goes as
  literal text.
- Dictation, CJK input and autocorrect belong to the compose field
  ([plan.md](plan.md#autocorrect-and-text-input)). `UIKeyInput` conformers get "a small
  subset of keyboards", which is fine for a terminal.
- `UIKeyInput` loses iOS's long-press-space trackpad (it needs `UITextInput`).
  Trackpad mode starts from a two-finger press on the terminal or a drag on the key
  row's arrow group ([plan.md](plan.md#cursor-movement)).

Spike 1 checks what this view really gets on iOS 26: the QuickType bar, Backspace on
empty, the double-space period, swipe typing.

### The accessory

For the minimal client, the required keyboard-open surface is a local multiline
`UITextView` draft editor. Return inserts a newline. Explicit Insert sends one paste
without an additional Enter, identically to mobile browser. Hiding the keyboard must
not discard the draft. Retention after insertion or tab closure remains to settle;
see [the local-draft design](client/terminal-interaction-design.md).

The native focus controller owns transitions between terminal and draft. The draft's
`compose` focus state is native/internal; it is not a new web bridge `focus` mode.
Any web-controlled draft toggle needs an explicit reviewed bridge action before
implementation, rather than sending an undocumented mode.

Placement and native keyboard geometry must be prototyped on a real iPhone. The
older paging key row, sticky modifiers, suggestion chips, and dedicated media key
are deferred UI options, not initial requirements. The diagrams and ownership table
above illustrate platform boundaries, not an approved accessory layout. The spike
may retain extra controls as instrumentation. Standard user-driven paste remains
required; evaluate `UIPasteControl` or native paste menus without forcing extra
persistent controls into the minimal layout.

### Hardware keyboard

> Key delivery remains required. Custom application shortcuts below are deferred; do not add a shortcut system to the minimal client.

- `pressesBegan`/`pressesEnded` on `TerminalInputView` handle keys that aren't plain
  text: Esc, Tab, Shift+Tab, arrows, Home/End/PgUp/PgDn, F-keys, anything with Ctrl
  or Option. Those presses are consumed. Plain printing keys go to `super` and arrive
  through `insertText` in the active layout.
- Key repeat for consumed keys: `pressesBegan` reports key-down once, so
  `HardwareKeys` repeats (400 ms delay, then every 33 ms) until `pressesEnded`. If
  spike 1 shows iOS repeating `pressesBegan` itself, the timer goes. `UIKeyCommand`
  fires once per press, so it isn't used for terminal keys.
- Option acts as Meta (`M-<key>`); Option-typed accented characters are in the
  compose field only.
- `UIKeyCommand` covers app shortcuts only: Cmd+T new tab, Cmd+W close tab, Cmd+1…9
  switch tab, Cmd+K clear compose, with `wantsPriorityOverSystemBehavior`.
- With a hardware keyboard connected (`GCKeyboard.coalesced != nil`, updated from
  `GCKeyboardDidConnect`/`DidDisconnect`), the key row collapses to a thin strip with
  the modifier state and hide.

`TetherKit/KeyMapper` turns a `UIKey` (`keyCode`, `modifierFlags`,
`charactersIgnoringModifiers`) and key-row keys into input events. It is pure,
unit-tested, and the only place the Swift side spells key names.

### How input reaches the terminal

Native sends input events to the web, which puts them on the active tab's watch.
Every source takes this path: software keyboard, key row, hardware key, suggestion
chip, compose field, and a photo path after upload (inserted by the web itself).

```text
InputEvent = { text: string }    // literal text
           | { key: string }     // tmux key name: "Escape", "BTab", "C-c", "M-Enter", "Up"
           | { bytes: string }   // raw bytes, base64: only Shift+Enter (CSI-u ESC [13;2u)
           | { paste: string }   // bracketed paste through tmux
```

- The web maps these onto the protocol's `input` and `paste` messages
  ([daemon-core.md §5.3](daemon-core.md#53-json-messages)). The compose field's send
  is a single `paste`, without a following Enter event. A tab sends input only once its watch
  is bound (`watching`).
- Key names are plain strings checked by the daemon's allowlist
  ([daemon-core.md §3.4](daemon-core.md#34-commands-commandrs)). The contract is the
  fixture `tests/fixtures/proto/keys.json`: the Rust tests check each name against
  the regex, and the KeyMapper tests check KeyMapper emits nothing outside it.
- **Shift+Enter** goes as `bytes`, never the key `S-Enter`, which tmux 3.4 types as
  literal text.
- **Esc Esc** is two `Escape` events about 50 ms apart; native times the gap.
- The web splits `text` longer than the `input` limit
  ([daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling)) into several
  messages; bulk text goes as `paste`.
- Native coalesces events from one run-loop turn (fast hardware typing, key repeat)
  into one bridge call, in order.
- Native doesn't know about tabs or panes; the web routes to the active tab.

### Focus: one controller, native

`FocusController` (Swift) is the only code that changes first responder. The web
(`web/native/`) asks for focus changes over the bridge and never focuses an element.

| State | First responder | Keyboard | Entered by |
|---|---|---|---|
| `hidden` | `TerminalInputView`, with an empty `inputView` and no accessory | down | hide key, `focus hidden` (a sheet that needs the screen) |
| `terminal` | `TerminalInputView` | up | `focus terminal` (`[⌨]`, a tap on the terminal), the end of any borrow |
| `compose` | compose `UITextView` | up | compose toggle, a tap in the field |
| `webText` | WebKit's content view, once the user taps the field | WebKit's own (with its ⌃ ⌄ ✓ bar) | `focus webText`: a web surface with a text input (the v2 editor) |
| `select` | WebKit's content view | down | `focus select`, only if selection needs it (below) |
| `nativeModal` | a native alert or sheet's own field | up or down | native prompts, Add host |

- **Hiding doesn't give up first responder.** `hidden` sets
  `TerminalInputView.inputView` to an empty zero-height view and the accessory to nil,
  then calls `reloadInputViews()`; showing restores both. Hardware keys still arrive,
  and a tap while hidden can't let WebKit take over.
- **The guard.** In `terminal` and `hidden`, `canResignFirstResponder` returns `false`
  unless `FocusController` is moving focus. Taps on web content then can't take first
  responder, and the keyboard stays up through scrolling, terminal taps, tab-bar and
  chip taps, and web sheets.
- **State comes from the responder, not keyboard notifications.** A hardware keyboard
  hiding the software keyboard changes no state; only `viewport.keyboard` changes, and
  the layout follows.
- **Borrowing for web text inputs.** The web sends `focus webText` when it opens a
  surface with an editable element, before the user taps into it; `FocusController`
  lowers the guard and resigns the terminal input, and WebKit focuses the editor on the
  tap. On close the web sends `focus terminal`, and native makes `TerminalInputView`
  first responder again with no tap needed. Accepted: the keyboard is down between
  opening the editor and tapping into it; if WebKit's ✓ closes it, the state stays
  `webText` until the user taps the editor or closes it.
- **No other web text inputs.** Rename, new window and new file names use a native
  prompt (`prompt` on the bridge, a `UIAlertController`), so the editor is the only
  borrower in the MVP. Live search (v2) will be a second `webText` borrower. A web
  lint rule bans `<input>`, `<textarea>` and `contenteditable` outside the editor, and
  xterm.js's helper textarea is made inert (`tabindex=-1`, `inert`, `disableStdin`).
- **Selection** ([plan.md](plan.md#select-copy-and-paste)) relies on WebKit's
  selection, handles and Copy menu, which may need WebKit's content view as first
  responder. Spike 1 checks it with the guard on. If they don't work, selection mode
  sends `focus select`: the guard drops, WebKit selects, the keyboard goes down, and
  native restores `terminal` when selection ends. Nothing makes the user tap to get the
  keyboard back.
- **Restore after interruptions.** `FocusController` remembers the wanted state and
  restores it on foreground, after a native sheet, and after a web content process
  restart.
- **System dismissal** of the software keyboard changes no focus state: native reports
  `viewport` with `keyboard: false`, and `focus terminal` brings it back
  (`reloadInputViews()`, and `becomeFirstResponder()` if needed).

### Keyboard geometry

Native sizes the web view, so the web never measures the keyboard.

- On `keyboardWillChangeFrame`, native moves the web view's bottom edge to the top of
  the keyboard plus accessory, with the keyboard's curve and duration. With the
  keyboard hidden, the web view fills the screen.
- On every change native sends `viewport { width, height, safeArea, keyboard: bool,
  collapsedHeight, reason }`, `reason` being `initial`, `keyboard` or `rotation`.
  `collapsedHeight` is the web view's height with the keyboard hidden in the current
  orientation: the full screen height, safe-area bands included, and `safeArea` is that
  layout's insets.
- **Every `viewport` carries the full-screen layout's `safeArea`, a `keyboard` one
  included.** The web view that ends above the keyboard has no bottom inset of its own
  (its `env(safe-area-inset-bottom)` is 0), but the web sizes tmux from the collapsed
  layout and sets its padding from `safeArea` (`--safe-*` in `web/ui/tokens.css`).
  Native therefore sends the insets of the full-screen layout in every message, so a
  rotation while the keyboard is up gives the rows the collapsed layout has.
- The web computes the tmux size from `collapsedHeight` and width only, and resizes
  tmux only on `initial`, `rotation` and font-size changes. A `keyboard` change never
  resizes tmux, and neither does the suggestion strip appearing or going. The columns
  come from `width` minus the left and right insets, each side at least a 4 px edge
  inset (`--term-edge`) so text never touches the glass; the rows from
  `collapsedHeight` minus the top and bottom insets and the tab bar, at the current
  cell size (`web/term/size.ts`; the daemon clamps what it receives,
  [daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling)). **The strip is
  not subtracted:** it shows only while the keyboard is up and the tab is live, so
  counting it would resize tmux each time chips came or went. It shortens the terminal
  area as the keyboard does, and the pan below keeps the cursor row in view. The edge
  inset costs a column in a 393-wide portrait view (56 to 55 columns, measured in the
  dev shim) and none in landscape, where the side insets are larger.
- **The pan.** With the keyboard up, and with the strip showing, the terminal area
  (above the tab bar and strip) is shorter than the terminal's rows, and the terminal
  keeps its rows ([plan.md](plan.md#layout)). The renderer (`web/term/xterm.ts`, `cursorPan`) slides
  the terminal up just far enough that the bottom of the cursor row meets the bottom of
  that area: never down, never past the last row, and not at all while every row fits.
  The area's height and the cursor row decide it, so the web keeps no keyboard flag for
  it, and it follows the cursor as well as the keyboard. The slide animates with the
  keyboard's curve and duration when the area changes size (`--ease-keyboard`,
  `--dur-keyboard`); a cursor move jumps, as text does.
- `webView.scrollView`: `contentInsetAdjustmentBehavior = .never`, `bounces = false`,
  `keyboardDismissMode = .none`; zoom off in the viewport meta.

*Alternative kept for the spike:* leave the web view full size and send only the
keyboard height, if resizing the frame makes WebKit relayout badly or WebKit also
adjusts for the keyboard itself.

### Haptics

`Haptics` keeps one prepared generator per kind and calls `prepare()` on the
anticipating touch-down.

| Event | Feedback | Triggered by |
|---|---|---|
| Key row key down | light impact | native |
| Modifier lock on/off | medium impact | native |
| ^C/^D confirmation shown | warning notification | native |
| Tab switch, chip accepted | selection changed | web, via `haptic` |
| Selection mode starts | rigid impact | web |
| Upload done / failed | success / error notification | native |

## The bridge

One message handler named `tether` (`WKScriptMessageHandlerWithReply`, so web requests
return promises), and two entry points in the page, called with
`callAsyncJavaScript(_:arguments:in:in:)` in the page content world:
`window.__tether.receive(messages)` for native → web messages, and
`window.__tether.activeTab()`, which returns `{ host, tab }` for the tab on screen.
Every message is a JSON object with a `type`. The boot reply carries `bridgeVersion`;
a mismatch can only happen in dev mode and shows an error banner.

| Web → native | Reply | Purpose |
|---|---|---|
| `ready` | `boot { bridgeVersion, hosts, tabs, active, viewport, locked }` | Start; restore the saved tabs and the active one ([payloads](#boot-and-host-payloads)) |
| `token { host }` | `{ token }`, `{ locked }` or `{ notEnrolled }` | WebSocket token ([auth.md](auth.md#carrying-the-token)) |
| `hostRejected { host }` | | The host closed the socket with 4401: mark it "not enrolled". The web halts that host's tabs as unauthorized until a tap on a pill retries |
| `recreateWebView` | | Two consecutive connect timeouts on a host's socket ([plan.md](plan.md#reconnect)): discard the web view and load a fresh one. No data, no reply. All state that matters is on the server and in native's saved tabs |
| `saveTabs { tabs, active }` | | Persist the open-tab list and which tab is on screen |
| `focus { mode }` | | `terminal`, `hidden`, `webText`, `select` |
| `haptic { kind }` | | Semantic haptics |
| `prompt { title, message, initial }` | `string` or `null` | Short text entry |
| `pickMedia` | | The file manager's upload button |
| `playVideo { host, path }` | | Native player |
| `openURL { url }` | | Links leave the app |
| `ack { id }` | | Spike 1 latency measurement only |

| Native → web | Purpose |
|---|---|
| `input { events: InputEvent[] }` | Keystrokes, key row, compose |
| `viewport { … }` | Geometry, including whether the keyboard shows |
| `lifecycle { phase }` | `active`, `background` |
| `network { reachable, interface }` | Reconnect trigger |
| `lock { locked }` | The app-wide lock: drop or fetch tokens |
| `hosts { hosts: HostEntry[] }` | Host list or a host's enrolment changed |
| `upload { id, host, tab, progress, path?, error? }` | Upload chips; on `path`, insert it into `tab` |

`lifecycle.phase` has two values, `active` and `background`; there is no `foreground`.
The `token` reply is one of `{ token }`, `{ locked }` (the app is locked) or
`{ notEnrolled }` (native holds no token for that host). **Open question:** what the web
does on `{ locked }` and `{ notEnrolled }` (wait for `lock { locked: false }`, what the
pill says, whether to ask again) is undecided, and the web code that fetches a token
doesn't exist yet ([Open risks](#open-risks)).

### Boot and host payloads

```text
HostEntry = { id: string,        // host_id
              name: string,      // a label for the host list, never turned into a URL
              baseURL: string,   // "https://<magicdns-name>"
              enrolled: bool }
SavedTab  = { id: string,        // the web's tab id, kept across launches
              host: string,      // a HostEntry id
              window: WindowRef, // { server, window }, daemon-core.md §5.3
              name: string }     // the title; follows windowRenamed (plan.md)
boot      = { bridgeVersion, hosts: HostEntry[], tabs: SavedTab[],
              active: string | null,   // the SavedTab id native last saw on screen
              viewport, locked }
```

- **`baseURL` is explicit.** Native builds it when Add host takes the MagicDNS name
  ([Hosts](#hosts)), and the web derives the host's WebSocket URL from it (`wss`, `/ws`).
  `name` is a label (`/auth/info.name` may be the config key `name`), not the host's DNS
  name, so the web never builds a URL from it.
- **`tabs` is the open-tab list `saveTabs` last stored**, in order. Native stores it as
  given and keeps no model of tabs.
- **`active`** is the tab id the last `saveTabs` named; native persists it with the list
  so the app reopens on the tab Jimmy left. `null`, or an id not in `tabs`, means the
  first tab.

Every bridge type, `HostEntry`, `SavedTab` and `Boot` included, is written twice, in `web/native/bridge.ts` and
`ios/TetherKit/Sources/TetherKit/Bridge.swift`; both test suites decode the same
fixtures in `ios/TetherKit/Tests/fixtures/bridge/*.json`. The daemon never sees the
bridge.

## Lifecycle and reconnect

| Event (native signal) | What happens |
|---|---|
| Launch | Load the UI from the bundle; `boot` restores tabs as "reconnecting", with the one last on screen active; the lock screen shows if needed ([auth.md](auth.md#swift-side-keychain-item-and-app-lock)); once unlocked, the web connects every host with an open tab |
| Background (`sceneDidEnterBackground`) | Native sends `lifecycle background` inside a short `beginBackgroundTask`; the web closes its sockets cleanly. The daemon ends the watches at once, so the laptop gets its window size back without waiting for the idle timeout ([daemon-core.md §3.6](daemon-core.md#36-sizing)) |
| A native screen covers the terminal (host list, Add host, settings) | The web sends `unwatch` for the tab on screen and keeps the socket and its pings; it sends `watch` again when the terminal shows, and gets a fresh snapshot |
| Foreground (`sceneDidBecomeActive`) | Lock check first; then `lifecycle active`; the web reconnects at once and sends `watch` for the tab on screen, which repaints from a snapshot; `FocusController` restores the keyboard |
| Network change (`NWPathMonitor`: satisfied, or interface changed) | `network` → the web resets backoff and reconnects sockets that are closed or silent past a heartbeat |
| Web content process killed (`webViewWebContentProcessDidTerminate`) | Native reloads the page; `boot` restores tabs from the native copy, which survives this; focus is restored |
| Web asks for a fresh web view (`recreateWebView`, after two consecutive connect timeouts: iOS 26 can leave a new WebSocket stuck in CONNECTING after resume) | Native discards the `WKWebView` and loads a new one, then it follows the same path as a killed content process: `boot` restores tabs from the native copy, the web reconnects, focus is restored |
| Host unreachable for a while | Tabs stay "reconnecting" ([plan.md](plan.md#reconnect)). Past 10 s, the pill's detail says "Can't reach devbox. Is Tailscale on?": the app can't read the VPN state, and Tailscale off is the usual cause |

iOS suspends the app in the background and its sockets die, native or not; resume
speed is what the design optimizes.

## Files and sharing

**Photo, camera, image paste (MVP), native.** The key row's `^V img` key (or
`pickMedia` from the web) opens a menu: Photo Library (`PHPickerViewController`, no
permission prompt), Camera (`UIImagePickerController`), Paste image (through the paste
control). Then:

1. Native asks the page for `activeTab()` and keeps the `{ host, tab }` it returns:
   the upload goes to that host, and its path to that tab.
2. `ImageConverter` (ImageIO) re-encodes HEIC to JPEG at quality 0.9, longest side
   2048 px unless "Send original" is on.
3. `Uploader` posts the bytes to the host's `/fs/upload?name=<file name>` with the
   Bearer token ([fs.md](fs.md#post-fsupload)), one upload at a time, retrying a `503
   busy` after its `Retry-After`, and reports progress in `upload` messages. The web has
   no progress UI yet: it acts only on the finished upload (step 4).
4. On success, the `upload` message carries the absolute path. The web queues an
   insertion for `tab`: the path, shell-quoted, as `text` input, without Enter. It is
   applied at once if the tab's watch is bound, otherwise when that tab's next
   `watching` arrives; if the tab closed meanwhile, it is dropped with a notice naming
   the file.

**Share extension (after the paid account).** A `TetherShare` target accepts images
and movies, copies them into the App Group container (`Inbox/<uuid>.<ext>` plus a
manifest), and tells Jimmy to open tether. On the next foreground the app offers "Send
1 photo to main:1?" and runs the upload above. The extension never touches tokens or
the network. App Groups are likely unavailable to a free Personal Team, which is why
this waits.

**Clipboard (v2).** Native code may write `UIPasteboard` without a gesture, so an OSC
52 copy from the server can go straight to the clipboard, behind a setting.

## Hosts

`HostStore` keeps the host list in `UserDefaults`: `{host_id, name, baseURL}`. Tokens
live in the Keychain ([auth.md](auth.md#swift-side-keychain-item-and-app-lock)). The
MVP has one host, but the store, the bridge and the scheme's `h-{host}` origins
already carry the host id. Add host (SwiftUI) takes the MagicDNS name and the
enrolment code, and stores `baseURL` as `https://<that name>`; the bridge sends it in
each `HostEntry` ([payloads](#boot-and-host-payloads)). A host whose name changes keeps
its `host_id`; Jimmy edits its URL.

## Project layout

```text
ios/
  project.yml            XcodeGen spec: Tether app, TetherTests; TetherShare later
  Tether/
    App/                 AppDelegate, SceneDelegate, RootViewController
    Web/                 WebShell (WKWebView setup), AppSchemeHandler, Bridge
    Input/               TerminalInputView, Accessory (key row, compose, paste),
                         HardwareKeys, ModifierState, FocusController, KeyboardGeometry
    Auth/                TokenStore, Unlocker, AuthClient (auth.md)
    Hosts/               HostStore, HostsView, AddHostView (SwiftUI)
    Media/               MediaPicker, ImageConverter, Uploader, VideoPlayer
    Support/             Haptics, Settings, Info.plist, Tether.entitlements
  TetherKit/             Swift package, no UIKit: KeyMapper, bridge types, auth DTOs;
                         `swift test`
  scripts/build-web.sh   Xcode build phase: vite build → bundle WebUI/
  spikes/keyboard/       spike 1 (deleted once it has answered)
```

- **UIKit for the shell, SwiftUI for screens.** First responder,
  `inputAccessoryView` and WKWebView control are UIKit concepts; the host list, Add
  host, lock screen and settings are SwiftUI views in `UIHostingController`s.
- **XcodeGen.** `project.yml` is committed; `Tether.xcodeproj` is generated and
  gitignored. Agents on the Linux box can edit Swift files and the YAML but can't run
  Xcode, and a hand-edited `project.pbxproj` breaks easily.
- **Info.plist:** `NSFaceIDUsageDescription`, `NSCameraUsageDescription`; no ATS
  exceptions (`*.ts.net` certificates are publicly trusted). Bundle id and team are in
  `project.yml`.
- **Builds and tests run on the Mac.** `ios/scripts/check.sh` runs `xcodegen`, `swift
  test` for TetherKit, and an `xcodebuild` for the simulator. The Linux preflight
  doesn't build iOS.

### Protocol types in Swift

Swift needs only the auth DTOs, the `/auth/*` bodies defined in `src/proto/auth.rs`
([auth.md](auth.md#endpoints)). They are hand-written `Codable` types in TetherKit,
tested against JSON fixtures the Rust tests emit, the same pattern as the bridge. Key
names are strings with a shared fixture (above). If the socket ever moves native, the
WebSocket messages get the same treatment.

## Distribution

- **Now:** Xcode on Jimmy's Mac, free Personal Team. Profiles last 7 days, so he
  reinstalls from Xcode weekly; at most 3 apps on the device; no App Groups, so no
  share extension. Developer Mode must be on.
- **Later:** paid account, TestFlight internal testing (builds last 90 days), App
  Groups and the share extension.

## Open risks

- **The guard vs WebKit's selection** (medium): if WebKit needs first responder to
  select, selection briefly drops the keyboard. Spike 1.
- **WKWebView adjusting for a keyboard it doesn't own**, fighting the frame resize.
  Spike 1, both geometry variants.
- **Bridge latency under load**: unmeasured on iOS 26. Spike 1.
- **Token fetch replies** (open): the web code that asks native for a host's token must
  handle `{ locked }` and `{ notEnrolled }`; neither the waiting nor the pill states are
  specified. It also needs the app boot code that routes `lifecycle`, `network`,
  `viewport` and `lock` from native to the hosts and the sizer.
- **The empty-`inputView` trick for `hidden`** is common practice, not documented
  behaviour. Spike 1.
- **WebSocket after resume in WKWebView** (WebKit 308073, seen in Safari): spike 3. A
  Tailscale issue (#20882) reports serve WebSocket failures over HTTP/2; WKWebView's
  WebSockets are expected to use HTTP/1.1, unverified.
- **Cross-origin fetches and CSP on custom schemes**: whether WebKit applies CORS
  between `tether-app://ui` and `tether-app://h-{host}` as expected, and honours
  `sandbox` on custom-scheme responses, is unverified on iOS 26. The file-manager
  spike checks both; navigation and the bridge's origin check hold without them.
- **Video through the native player with an auth header**: the file-manager spike.
- **Vite HMR from the custom scheme**: reload is the fallback; it only affects dev
  speed.
- **Weekly reinstall on the free team** until the paid account.
