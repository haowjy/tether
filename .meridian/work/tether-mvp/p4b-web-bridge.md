# P4b handoff: iOS bridge v2

The native lane is in `ios/`; keep P4b's source edits under `web/platform/native/` (do not edit the iOS fixtures). Bridge contract version is **2**. Shared message fixtures are in `ios/TetherKit/Tests/Fixtures/bridge/`, one JSON file per message. Each file has `direction`, flat `message`, and—on every web-to-native request—`reply`; native events have no reply. Swift `swift test` decodes and re-encodes every message fixture. Read these files in P4b tests rather than copying the contract into a second fixture set.

## Transport and page hooks

- Register `window.__tether.receive(messages: Message[])` before calling `ready`. Native invokes it in the page content world and currently sends a singleton array per event. Route each item to the adapter's single `subscribe` channel. Remove the obsolete page `activeTab()` callback: native uses the `activeTab` bridge message for both keyboard batches and media targeting.
- Send web requests as flat `{ type, ...fields }` messages through the `tether` `WKScriptMessageHandlerWithReply`; each call returns the reply described below. `ready` is sent after hooks are installed. Native rejects unknown types, missing required fields, wrong direction, non-main-frame calls, and calls outside origin `tether-app://ui`.
- Native's saved workspace is the v1 `SavedWorkspace` from `web/platform/types.ts`, not a native tab model. `Boot` is `{ bridgeVersion: 2, hosts: PlatformHost[], workspace: SavedWorkspace | null, viewport: Viewport, lifecycle: Lifecycle }`.
- A `PlatformHost` is `{ handle, hostId, name, pageOrigin }`. Native sets `handle` and `hostId` to daemon `hostId`, `name` from `/auth/info`, `pageOrigin: null` (token-admitted host). Do not expect native `baseURL` or token in this type. `transport.httpBase(handle)` is `tether-app://h-${handle}`; the scheme handler proxies `/fs/*`, `/complete`, and exact `GET /auth/info` to the host's native-stored HTTPS URL and supplies its Bearer token for protected routes. The custom scheme is not a WebSocket URL.
- Resolve the native socket inside `HostLink`: request `{type:"socket", host}` immediately before connecting. The reply is `{url, token}`, `{locked:true}`, or `{notEnrolled:true}`. `url` is `wss://<stored host>/ws`; do not derive it from `hostId`. Never copy URL or token into `PlatformHost`, controller state, workspace, storage, logs or UI. The only exception is echoing the exact token in `{type:"hostRejected", host, token}` after that socket's auth refusal; native revokes only if it still matches the stored token. A locked reply waits for `lifecycle.locked === false`, then retries once; do not spin or re-prompt. `notEnrolled` becomes the host's token refusal.
- Send `{type:"activeTab", tab}` whenever the active tab changes, including `tab:null` when there is none. Native caches it for coalesced keyboard batches and `pickMedia`; the hot input path makes **one** bridge crossing. The web still drops a batch whose `tab` no longer equals the active key.
- Bridge input events use `InputEvent` (`{text}`, `{key}`, `{bytes}`, `{paste}`). Web must compare `input.tab` with the active tab key and drop stale events; never route an old tab's input into the newly active one.

## Web → native requests

| Message | Send and handle reply |
|---|---|
| `ready` | Send `{type:"ready"}` once hooks are ready. Decode `Boot`, require `bridgeVersion === 2`, initialize hosts/workspace/viewport/lifecycle, then start normal host admission and rendering. |
| `socket` | From inside `HostLink`, send `{type:"socket", host: handle}` before opening/reopening a socket. Reply is `{url:string, token:string}`, `{locked:true}`, or `{notEnrolled:true}`. Keep URL and token inside the Link only, except the exact token is echoed in `hostRejected` on refusal; never log or persist it. On a locked reply wait for lifecycle unlocked; on not-enrolled stop that host's admission. |
| `hostRejected` | Send `{type:"hostRejected", host: handle, token}` with the exact token that the socket presented when it reports auth refusal. Native deletes it only if it still matches the stored token, then publishes updated `hosts`; keep the host registration so its UI can report that pairing is needed. Reply `null`. |
| `recreateWebView` | Send `{type:"recreateWebView"}` for the settled stuck-socket recovery path. Native reloads the bundled page; `ready` returns saved workspace. Reply `null`. |
| `saveWorkspace` | Send `{type:"saveWorkspace", workspace}` with the exact current `SavedWorkspace` (version 1); native stores it opaquely. Reply `null`. |
| `focus` | Send `{type:"focus", mode}` for every resting destination/overlay change: `terminal` or `hidden` on Terminal with no overlay; `webText` elsewhere; `select` only during selection. Native owns `UIResponder` and never infers focus from a terminal tap. A `webText` from the line field restores as `terminal`; other `webText` destinations stay `webText`. Reply `null`. |
| `activeTab` | Send `{type:"activeTab", tab: TabKey | null}` whenever the selected tab changes, even if focus mode does not. This is a cheap state update, not a request for native to call back. Reply `null`. |
| `lineField` | Send `{type:"lineField", rect}` with the line field's rect in **WKWebView-local coordinates**, or `{type:"lineField", rect:null}` when unavailable/covered. Native uses this hit region only to lend first responder to WebKit after a touch began there. Reply `null`. |
| `draftGet` | Send `{type:"draftGet", key: TabKey}`; reply is `DraftRecord` or `null`. |
| `draftPut` | Send `{type:"draftPut", record: DraftRecord, baseRevision:number}`. Reply is exactly `"ok"`, `"conflict"`, or `"failed"`. Compare revisions in web before calling; do not treat a conflict as success. |
| `draftDelete` | Send `{type:"draftDelete", key: TabKey}`; reply `null`. |
| `draftList` | Send `{type:"draftList"}`; reply is `DraftRecord[]`. |
| `copy` | Send `{type:"copy", text}` for user-initiated terminal Copy; native always writes the system clipboard and replies `"ok"`. Do not use this for OSC 52 server writes. |
| `readPasteboard` | In the edit-menu Paste gesture send `{type:"readPasteboard", tab: TabKey}`; reply is `{text:string}`, `{uploading:string}`, `"empty"`, or `"denied"`. Text paste goes through the normal tab-keyed paste route. If image is present native starts upload and returns its id; then wait for `upload` event. |
| `haptic` | Send `{type:"haptic", kind}` for `key`, `modifier`, `rigid`, `selection`, or `warning` before ^C/^D; reply `null`. |
| `pickMedia` | Send `{type:"pickMedia"}` synchronously in the media-button gesture; reply `null`. Native captures its cached `activeTab` and presents the picker/action sheet. Track upload events by id. |
| `playVideo` | Send `{type:"playVideo", host: handle, path}`; native plays the authenticated `/fs/raw` resource. Reply `null`. |
| `manageHosts` | Send `{type:"manageHosts"}` from the web's Home/Settings host-management entry; native presents the server sheet. Reply `null`. |
| `openURL` | Send `{type:"openURL", url}` for external `http`, `https`, or `mailto` links. Reply `null`. |
| `ack` | Send `{type:"ack", id}` for optional latency measurement; reply `null`. Fixture uses numeric `id`; keep it opaque in JS. |

## Native → web events

| Event | Required web behavior |
|---|---|
| `input` | `{type:"input", tab:TabKey, events:InputEvent[]}`. Deliver events only to a driver whose exact tab key is still active; drop if it changed or closed. Events come from software and hardware terminal input. |
| `viewport` | `{type:"viewport", viewport:Viewport}`. Replace viewport state and feed CSS/sizing immediately. v2 fields are `layout`, `density`, `directInput`, `scheme`, `width`, `stableHeight`, `visibleHeight`, `keyboardInset`, `safeArea`, `keyboard`. Native reports points as CSS-pixel-equivalent values, uses the keyboard-hidden full-screen safe area, and resizes its WKWebView above a docked keyboard. `keyboardInset` is still required: it is the bottom obstruction the dock/sheets/toasts use. |
| `lifecycle` | `{type:"lifecycle", lifecycle:Lifecycle}` where all four booleans (`visible`, `online`, `locked`, `covered`) are a whole current snapshot. Recompute the one host-watch predicate and token behavior from this object; don't expect separate `network`, `lock`, `phase`, or `covered` messages. |
| `hosts` | `{type:"hosts", hosts:PlatformHost[]}` replaces the host list after enroll/remove/token refusal. Reconcile host admission and reconnect state without losing saved workspace. |
| `upload` | `{type:"upload", id, host, tab:TabKey, progress, path?, error?}`. `host`/`tab` identify the originating upload; progress is in `[0,1]`; terminal event has `path` or `error`. On success, offer “Insert path into <tab>” for that original tab—**do not insert automatically**. If the tab closed, keep the path available and report that it can no longer be inserted. |

## Known gaps / lane boundaries

- `web/.context/TODO` W5 records that the current phone keyboard toggle has no registered `terminal` element in native, so `FocusController.toggleKeyboard` cannot focus it and the key row never appears. P4a provides the native responder and accepts `focus {mode}`; P4b still must wire the adapter's focus owner / terminal registration so the toggle calls the native focus path. A native terminal tap must not open the keyboard.
- Native must report `Viewport.keyboardInset` from actual keyboard-frame obstruction. P4a derives it from the stable and visible web-view heights and publishes viewport events only when the value changes. P4b must use it for the dock/sheets/toasts even though native resizes WKWebView.
- The P4a Simulator screenshot loads the bundled P3b Home UI, but P3b's browser adapter does not consume the native `safeArea`; the iOS status bar overlays its header, and the native Servers control overlays Home copy. P4b should apply `viewport.safeArea` and coordinate that control with the native/web header before treating the screenshot as a visual pass.
- **Host management entry:** use a web Home/Settings action that sends `manageHosts` and presents the existing native server sheet. Keep the floating native Servers button only until that web entry is wired; remove the overlay in the same P4b change that adds the web entry.
- **Lifecycle spec reconciliation:** `.meridian/work/tether-mvp/design/client-architecture.md` §5.10 calls for a separate `lifecycle.covered` event. P4a settles coverage inside each full `lifecycle` snapshot; use that contract and reconcile the older table before implementing the adapter.
- The native scheme handler returns local `423 locked` or `401 not_enrolled` instead of forwarding protected HTTP without a token; it only treats a daemon `401` as token rejection when it sent that exact token. It preserves percent-encoded paths, allows only `/fs/*`, `/complete`, and exact `GET /auth/info`, answers preflight before compatibility checks, and refuses cross-origin redirects. The current host HTTP fetcher will need to stay within those paths.
- Background sends a lifecycle snapshot in a short `beginBackgroundTask` window so web sockets close. Native retains tokens until the app returns after more than five minutes; short app switches do not request Face ID. The lock screen covers the terminal and suppresses keyboard input.
- Simulator software keyboard cannot be shown in this environment. Toggle transitions, line-field first-responder lending from both `terminal` and `hidden`, keyboard-up viewport geometry, and rotate-with-keyboard behavior remain for P4b's real WebKit/device checks and Jimmy's iPhone checklist.
- The bundled UI in this lane is the current P3b web build. It is not yet the v2 native adapter; that is P4b. Do not interpret a loaded current Home/terminal screen as evidence that host transport, token admission or v2 event routing is live.
