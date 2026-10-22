# iOS web-platform research for tether

**Research date:** 2026-10-21 (ET)  
**Scope:** iOS 26-era Safari/Home Screen web apps, with WKWebView where relevant. The exact iPhone 17 Pro/iOS 26.x combination was not available for direct physical-device testing in this research run.

## Evidence labels

- **Documented:** Apple/WebKit/platform documentation or a standards/reference page.
- **WebKit repro/bug:** a reproducible report in WebKit’s tracker or an Apple forum report with a reproducible case. This is stronger than an anecdote, but not necessarily a promise that every device is affected.
- **Experience/anecdote:** forum, GitHub issue, or project report. Useful for failure modes and implementation patterns, not proof of universal behavior.

## Decision-level summary

The PWA is viable as an MVP only if “keyboard stays open” is a best effort with an explicit recovery affordance. It is not viable to promise an always-open keyboard or a perfectly stable terminal viewport on iOS 26. WebKit still gates programmatic keyboard presentation on user activation, background suspension can kill or strand a WebSocket, and multiple iOS 26 visual-viewport regressions are documented.

If the keyboard requirement is absolute, start with a native shell **only if it includes a native first-responder/input-accessory bridge**. A thin WKWebView wrapper alone still shares WebKit’s lifecycle, viewport, WebGL, and IME issues. If the requirement is relaxed, a PWA is the lower-cost first release, with server-authoritative tmux state and aggressive reconnect/recovery.

## 1. Keyboard, accessory bar, predictive input, and viewport

### Answer

**Focus:** Yes. iOS WebKit continues to require focus that results from a user interaction to present the software keyboard. An asynchronous `focus()` after a timeout, promise, or lifecycle callback should not be treated as sufficient. A synchronous focus during `pointerdown`/`touchend`/click is the safe path; preserve the user activation while doing no awaited work.

**Form assistant:** The keyboard accessory is system-owned. Current iOS 26 host implementations use roughly 59 px for a larger Liquid Glass accessory and 44 px for the older/default accessory, but that is not a Safari/PWA contract. A current WebKit PWA report measured a separate 62 px system-drawn gap above the web layer in iOS 26.5.2 portrait; that is not necessarily the same thing as the normal form assistant. A page has no supported CSS/DOM API to size or hide this bar. Tapping Done/checkmark normally dismisses the keyboard, but the page must not assume it produces a reliable element `blur` event: iOS variants have reported window blur, no clean field blur, and modal dismissal inconsistencies.

**QuickType:** `autocorrect="off"`, `autocapitalize="off"`, `spellcheck="false"`, and `autocomplete="off"` are still sensible terminal-field attributes. They reduce correction/AutoFill behavior, but do **not** constitute a documented “hide the predictive strip” switch. `autocomplete` primarily controls completion/AutoFill, not QuickType. Password-input hacks can suppress prediction on some devices, but they have side effects (password-manager UI, dictation/IME behavior) and should not be the default terminal input strategy.

**Visual viewport:** The Visual Viewport API is the best available instrumentation, not a stable contract. WebKit has open/reproduced cases involving a stuck `offsetTop`, delayed or missing resize updates, stale height after keyboard dismissal, rotation, and iOS 26 fixed-position regressions. On some iOS 26 standalone PWAs, `innerHeight` tracks the visible viewport while `documentElement.clientHeight` remains the layout viewport; therefore the plan’s `innerHeight - visualViewport.height` keyboard detector can evaluate to zero even while the keyboard is visible. Use several signals, tolerate stale values, and do not resize the tmux PTY on every transient viewport event.

### Confidence

- User-activation focus requirement: **high**.
- System-owned accessory and inability to hide it: **high**; exact iOS 26 Safari/PWA height: **low/medium**.
- Done means a clean field blur: **low**.
- Attributes fully suppress QuickType: **low**.
- VisualViewport regressions: **high** that the failure modes exist; **medium** for incidence on the exact target phone/build.

### Evidence

- **Documented/platform source:** Apple’s `keyboardDisplayRequiresUserAction` documentation says the default behavior requires a user tap before the keyboard is shown; it is UIWebView-era documentation, but it records the underlying iOS policy: [Apple keyboardDisplayRequiresUserAction](https://developer.apple.com/documentation/uikit/uiwebview/keyboarddisplayrequiresuseraction) (accessed 2026; current page).
- **WebKit source:** WebKit’s iOS port discussion explicitly says the on-screen keyboard is presented only when focus results from user interaction: [WebKit change discussion](https://mail-archive.com/webkit-changes@lists.webkit.org/msg253065.html) (crawled 2026, approximately three months old).
- **Documented background:** Apple’s Safari form guidance describes Previous/Next/Done in the form assistant and the Done dismissal behavior, and documents `autocorrect`: [Designing Forms](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/DesigningForms/DesigningForms.html) (archived, published 2016; behavior still useful as background, not an iOS 26 measurement).
- **Current host measurement:** Chromium’s iOS form-input-accessory implementation has iOS 26 Liquid Glass constants of 59 px for the large accessory and a 44 px default path: [Chromium `form_input_accessory_view.mm`](https://chromium.googlesource.com/codesearch/chromium/src/%2B/1a994603574b872ba430a2ad4af94af1c590522c/ios/chrome/common/ui/elements/form_input_accessory_view.mm) (crawled 2026-10; host-controlled, not Safari PWA proof).
- **WebKit repro:** A Safari 26.1/standalone PWA report describes a 62 px unreachable system gap in iOS 26.5.2, with `innerHeight`, `100dvh`, `clientHeight`, and `visualViewport.height` all at 812 px while the physical screen is 874 px: [WebKit bug 301994](https://bugs.webkit.org/show_bug.cgi?id=301994) (reported 2025-11-04; comments through 2026-07-20).
- **WebKit repro:** Stale height/page-top after keyboard dismissal, rotation, and standalone mode: [WebKit bug 218983](https://bugs.webkit.org/show_bug.cgi?id=218983) (reported 2020; still open and relevant), [WebKit bug 265578](https://bugs.webkit.org/show_bug.cgi?id=265578) (reported 2023; modified 2026-07-28), and iOS 26 fixed-position/24 px mismatch: [WebKit bug 297779](https://bugs.webkit.org/show_bug.cgi?id=297779) (iOS 26 beta 7 report, 2025).
- **WebKit repro:** iOS 26.0.1 Safari/WKWebView viewport remained wrong after keyboard dismissal; a comment reports a fix in 26.1: [WebKit bug 301857](https://bugs.webkit.org/show_bug.cgi?id=301857) (reported 2025-11-03).
- **Apple forum repro:** Safari and WebView `visualViewport.offsetTop` remains nonzero after dismissing the keyboard, moving fixed headers/footers: [Apple Developer Forums thread 800125](https://developer.apple.com/forums/thread/800125) (created 2025-09; current replies in 2026; Apple DTS advised filing a bug).
- **Platform gap:** `interactive-widget` is not implemented on WebKit/iOS, and the VirtualKeyboard API is not available: [WebKit bug 259770](https://bugs.webkit.org/show_bug.cgi?id=259770) (reported 2023, modified 2026-09-17) and [WebKit bug 230225](https://bugs.webkit.org/show_bug.cgi?id=230225) (still open).
- **Anecdote:** iOS 26 users report the redesigned up/down/checkmark bar and that the checkmark hides the keyboard but cannot be removed: [r/iOS thread](https://www.reddit.com/r/ios/comments/1o3t3fv/what_is_this_in_safari_is_it_new_in_ios26/) (2025-10-11). This is not a Safari/PWA specification.
- **Anecdote/maintainer issue:** xterm users have tried a password input to suppress predictive text; behavior is device/IME-dependent: [xterm.js issue 2403](https://github.com/xtermjs/xterm.js/issues/2403) (issue history through 2026) and [issue 5377](https://github.com/xtermjs/xterm.js/issues/5377) (opened 2025-07-20; still discusses basic mobile keyboard integration).

## 2. Lifecycle and WebSocket

### Answer

When a standalone PWA is backgrounded or the screen locks, JavaScript timers and network activity may be suspended. The WebSocket may close, be silently dropped, or appear open while the peer is unreachable. There is no supported guarantee that iOS keeps it alive. On return, `visibilitychange` and `pageshow` are useful triggers, but they are not guaranteed on every suspension/eviction path; iOS has historically omitted lifecycle events when a page is suspended or killed.

The most important current failure is a WebKit-reported iOS 26 case where, after background/resume, a newly created WebSocket remains `CONNECTING` indefinitely in both Safari and standalone PWA; only a full reload restores it. Treat resume as an untrusted transport boundary: run a heartbeat/timeout, close and recreate a stale socket, and if the socket is stuck in `CONNECTING`/`OPEN` without server traffic, force a controlled reload. The tmux session must remain authoritative on the server.

iOS can keep a page/socket alive for a while when it remains foregrounded, and there is no useful fixed timeout to promise. “It worked during my test” is not evidence of a background guarantee.

### Confidence

- Suspension/termination and no keep-alive promise: **high**.
- iOS 26 stuck-`CONNECTING` regression exists: **high** (WebKit repro, but not necessarily universal).
- Exact `pageshow`/`visibilitychange` delivery sequence: **medium/low**; it depends on whether the page was suspended, evicted, or killed.

### Evidence

- **WebKit repro:** iOS 26.3 Safari/PWA can leave a post-resume WebSocket stuck in `CONNECTING`; HTTP remains usable and a full reload restores the connection: [WebKit bug 308073](https://bugs.webkit.org/show_bug.cgi?id=308073) (reported 2026-02-17; status NEW, comments through 2026-04-18).
- **WebKit repro/background family:** WebSockets/signaling are disconnected when an iOS web container is backgrounded: [WebKit bug 245350](https://bugs.webkit.org/show_bug.cgi?id=245350) (reported 2022; still open) and [WebKit bug 226163](https://bugs.webkit.org/show_bug.cgi?id=226163) (reported 2021; SFSafariViewController case, not a PWA but relevant WebKit lifecycle evidence).
- **WebKit lifecycle behavior:** iOS may not dispatch `visibilitychange`, `pagehide`, `beforeunload`, or `unload` when Safari is suspended/killed: [WebKit bug 199854](https://bugs.webkit.org/show_bug.cgi?id=199854) (reported 2019; still relevant). PWA service-worker freezing is also tracked in [WebKit bug 211018](https://bugs.webkit.org/show_bug.cgi?id=211018) (reported 2020).
- **Memory/eviction:** iOS 26 PWA memory pressure and jetsam/reload behavior is reported in [WebKit bug 309251](https://bugs.webkit.org/show_bug.cgi?id=309251) (2026), and mobile web applications are documented as subject to memory-driven refresh/termination: [Esri iOS mobile web guidance](https://support.esri.com/en-us/knowledge-base/navigating-mobile-web-mapping-a-developer-s-guide-to-io-000038494) (published 2025-10-14).
- **Experience report:** A real-time WebSocket deployment guide describes background sockets becoming 1006/zombie connections on mobile Safari: [WebSockets on mobile Safari background tabs](https://www.real-time-websocket.com/real-time-protocol-selection-architecture/browser-compatibility/websockets-on-mobile-safari-background-tabs/) (crawled 2026). A December 2025 PWA report likewise says screen-lock keep-alive cannot be made reliable: [r/webdev thread](https://www.reddit.com/r/webdev/comments/1pt69el/how_to_keep_a_websocket_alive_in_a_pwa_after_the/) (2025-12-22).

## 3. Storage, cookies, passkeys, and push

### Answer

**Storage:** Home Screen web apps are exempt from WebKit’s ITP seven-day cap on script-writable first-party storage. This is not immunity from all eviction: quota pressure, inactivity, and system memory/storage reclamation can still remove data. `navigator.storage.persist()` is heuristic/best effort. The plan’s durable state should therefore be server-side; local storage is a cache for preferences and reconnect metadata.

**Cookies:** A Home Screen web app has isolated website data from Safari after installation. Safari may copy cookies at installation, but subsequent Safari and standalone sessions are not one shared cookie jar. Authenticate in the standalone app (or make the install/cookie-copy behavior an explicit setup step), and use a stable HTTPS host with a Secure, HttpOnly, appropriately SameSite cookie.

**WebAuthn/passkeys:** Platform-authenticator/passkey flows with Face ID work in Safari and are supported by iOS web authentication. Standalone web apps are the same web origin model, but exact behavior should be tested on the target build. The RP ID must be the exact stable hostname or a registrable suffix of the caller; never use a wildcard or bare `ts.net`. A full machine/tailnet hostname such as `host.tailnet.ts.net` is the appropriate candidate. Changing the Tailscale hostname or RP ID later creates a new credential namespace. In a native WKWebView, Apple’s associated-domain requirements apply; this is a separate setup burden.

**Push:** Web Push is available to Home Screen web apps on iOS/iPadOS 16.4 and later, with permission requested from a direct user action. It is out of scope for tether, but availability is not a reason to choose native over PWA.

### Confidence

- ITP seven-day exemption and Safari/PWA data separation: **high** (current WebKit documentation).
- General storage eviction caveat: **high**.
- Passkey in standalone on the exact `*.ts.net` deployment: **medium**; the RP-ID rules are documented, but the exact origin/build needs a device test.
- Web Push availability: **high**.

### Evidence

- **Documented/current:** WebKit says Home Screen web apps are exempt from the seven-day cap and have website data isolated from Safari: [Tracking Prevention](https://webkit.org/tracking-prevention/) (current page, accessed 2026-10), especially the script-writeable-storage and Home Screen sections.
- **Documented/current:** WebKit explains that standalone web apps have browser-like quotas and can still be evicted under storage pressure/inactivity; persistence is heuristic: [Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/) (2023-08-10, current page).
- **Documented/background:** WebKit describes separate Home Screen storage/cookie treatment: [Full third-party cookie blocking and more](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/) (2019-02-21) and [Safari 17 WebKit features](https://webkit.org/blog/14205/news-from-wwdc23-webkit-features-in-safari-17-beta/) (2023-06-07). A current operational explanation is [Auth0: Progressive Web Apps and SSO on iOS](https://support.auth0.com/center/s/article/Progressive-Web-Apps-and-SSO-on-iOS-Not-Working) (updated 2025-11-05).
- **Current behavior caveat:** Safari 26 allows sites to be added as web apps and exposes an “Open as Web App” setting; users can turn that off: [WebKit features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) (2025-09-15).
- **Documented:** Apple supports passkeys in Safari using Face ID/Touch ID: [Apple passkey use in web browsers](https://developer.apple.com/documentation/authenticationservices/passkey-use-in-web-browsers) (current page, accessed 2026) and [Apple Platform passkey support](https://support.apple.com/en-mide/guide/iphone/iph37306ae67/ios) (current page, accessed 2026).
- **Documented:** Apple’s WKWebView guidance requires an associated domain for the relying party, while JavaScript APIs can test platform-authenticator support: [Supporting passkeys](https://developer.apple.com/documentation/authenticationservices/supporting-passkeys) (current page, accessed 2026).
- **Documented:** WebAuthn RP IDs must be the caller’s origin or a registrable suffix; exact-host RP IDs are safest for a Tailscale hostname: [MDN Passkeys](https://developer.mozilla.org/en-US/docs/Web/Security/Authentication/Passkeys) (crawled 2026-10) and [web.dev RP ID guidance](https://web.dev/articles/webauthn-rp-id?authuser=485) (updated 2026-02-19). Check the current [Public Suffix List](https://publicsuffix.org/list/?app=1) when selecting the exact `ts.net` name.
- **Documented:** Home Screen web push is supported from iOS/iPadOS 16.4, and permission must be requested from direct user interaction: [Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) (2023-02-16, current WebKit documentation).

## 4. Rendering and xterm.js

### Answer

The current major is **xterm.js 6**, published under the `@xterm/*` packages; 6.0.0 was released 2025-12-22, with 6.1 in beta in the current package listing. In xterm 6 the old canvas renderer is removed; choose DOM or WebGL. This makes the plan’s “WebGL primary, DOM fallback, canvas fallback” inaccurate for a current xterm 6 dependency. If the project intentionally pins xterm 5, canvas remains a legacy option, but that is not the current-major path.

WebGL is fast, but iOS WebKit has had context loss after backgrounding/screen lock, and xterm’s WebGL addon can exhaust context/resources if terminals/addons are repeatedly created and disposed. Listen for context loss, dispose/recreate safely, and retain a DOM-renderer escape hatch. Rendering degradation is preferable to losing the tmux connection.

xterm’s mobile support remains deliberately basic: the hidden helper textarea is central to IME composition, but iOS CJK IME, dictation, Korean/Chinese composition, duplicate committed text, selection, and touch scrolling have active issues. xterm 6’s ESM/current addons, OSC52 support, synchronized output, and IME fixes are useful, but they do not provide native touch selection, handles, gestures, or a solved iOS keyboard lifecycle. The plan’s selection overlay and custom touch layer are justified; they are not optional polish.

### Confidence

- xterm 6/current package and canvas removal: **high**.
- WebGL context loss/resource risk: **high** for the general WebKit risk; **medium** for frequency on iOS 26.
- Mobile IME/touch gaps: **high** (active upstream issues).

### Evidence

- **Documented/current:** xterm 6 release notes remove the canvas renderer and recommend DOM or WebGL: [xterm.js 6.0.0 release](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0) (released 2025-12-22; current release page) and [@xterm/xterm package versions](https://www.npmjs.com/package/%40xterm/xterm?activeTab=versions) (crawled 2026-10).
- **WebKit repro:** iOS/iPadOS WebGL contexts have been lost after background/lock: [WebKit bug 262628](https://bugs.webkit.org/show_bug.cgi?id=262628) (reported 2023-10-04; duplicate/fix discussion for iOS 17) and [WebKit bug 261331](https://bugs.webkit.org/show_bug.cgi?id=261331) (reported 2023-09-08).
- **xterm issue:** repeated WebGL terminal creation/disposal can leak contexts and eventually blank live terminals: [xterm.js issue 6068](https://github.com/xtermjs/xterm.js/issues/6068) (opened 2026-07-24; current xterm 6/addon-webgl discussion).
- **xterm mobile issues:** basic mobile/touch support remains limited: [issue 5377](https://github.com/xtermjs/xterm.js/issues/5377) (opened 2025-07-20); iOS touch selection/copy/paste: [issue 3727](https://github.com/xtermjs/xterm.js/issues/3727) (opened 2022-04-05, still active); iOS scroll behavior: [issue 3613](https://github.com/xtermjs/xterm.js/issues/3613).
- **Current iOS 26 IME reports:** Chinese IME punctuation/space and composition: [issue 5835](https://github.com/xtermjs/xterm.js/issues/5835) (opened 2026-04-24); helper textarea committed-text corruption: [issue 6012](https://github.com/xtermjs/xterm.js/issues/6012) (opened 2026-06-09), [issue 6078](https://github.com/xtermjs/xterm.js/issues/6078) (opened 2026-07-26), and Korean IME in WKWebView: [issue 6084](https://github.com/xtermjs/xterm.js/issues/6084) (opened 2026-07-31).
- **Experience/project source:** A mobile terminal project documents that xterm 6 has no built-in mobile touch support and implements custom gestures/selection: [tmux-mobile terminal gestures](https://github.com/vokako/tmux-mobile/blob/main/docs/design-docs/pages/terminal-gestures.md) (crawled 2026).

## 5. Haptics and clipboard

### Answer

**Haptics:** `navigator.vibrate()` is not supported by Safari/iOS according to current compatibility data, including iOS 26.x. Do not make vibration a required feedback path. Use visual state, sound if appropriate, and native-shell haptics only if the native shell explicitly adds them. A 2026 MDN compatibility-data issue contains an unverified report that vibration appeared to work; this is an anecdote, not a basis for design.

**Clipboard:** Secure-context `navigator.clipboard.read()` can read text and image types in current iOS Safari/PWA, subject to user activation/permission. Call it directly from the user’s paste button; handle `NotAllowedError` and fall back to the normal `paste` event. iOS may show a system Paste callout/confirmation bubble; it is not page-controlled, may reject if the gesture/permission context is wrong, and has known misses. Image data may be sanitized/normalized to PNG (including EXIF handling), so do not promise original image bytes or HEIC preservation. The plan’s clipboard approach is broadly correct, but “will show the confirmation bubble” should be “may show system UI.”

### Confidence

- `navigator.vibrate` unavailable: **high**.
- `clipboard.read()` image support: **high**, subject to secure context and activation.
- Exact Paste-bubble timing/appearance: **medium**; it is system-controlled and has reported bugs.

### Evidence

- **Compatibility data:** Safari and iOS Safari remain marked unsupported for `navigator.vibrate`: [Can I Use: Notification Vibrate](https://caniuse.com/mdn-api_notification_vibrate) (crawled 2026-10) and [MDN Navigator.vibrate](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate) (crawled 2026-10).
- **Anecdote only:** an MDN browser-compatibility-data issue reports an unverified iOS vibration observation: [MDN BCD issue 29166](https://github.com/mdn/browser-compat-data/issues/29166) (opened 2026-03-03).
- **Documented WebKit behavior:** Safari’s Async Clipboard API supports readable text/HTML/URI/image PNG types; reads/writes are security/gesture gated, and iOS can show a Paste callout: [WebKit Async Clipboard API](https://webkit.org/blog/10855/async-clipboard-api/) (2020-06-23, current behavior documentation).
- **Documented/reference:** secure-context and image-read behavior: [MDN Clipboard.read](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/read) (crawled 2026-10) and [Can I Use Clipboard.read](https://caniuse.com/mdn-api_clipboard_read) (crawled 2026-10; iOS Safari supported through current versions).
- **WebKit repro:** iOS Paste callout can fail to accept/miss the Paste action: [WebKit bug 266569](https://bugs.webkit.org/show_bug.cgi?id=266569) (reported 2023-12-18; iOS 17 reproduction).
- **Current fix context:** Safari 26.4 fixed a Safari “Copy Image” context-menu issue, but this does not remove gesture/permission constraints: [WebKit features for Safari 26.4](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/) (current 2026 release notes).

## 6. Precedent for keeping the keyboard usable

There is no convincing open-source precedent that makes iOS Safari’s keyboard permanently reliable. The projects below show mitigations, not a platform guarantee.

- **VibeTunnel:** active iOS reports say the mobile keyboard is unusable or fails to appear; its 2025 work explicitly moved focus synchronously and handled Escape/hardware-keyboard detection, with more iOS 26 reports afterward: [VibeTunnel issue 530](https://github.com/amantus-ai/vibetunnel/issues/530) (opened 2025-08-13; comments through 2026). This is a counterexample to “a hidden textarea solves it.”
- **terminal-web:** a current web terminal intentionally keeps the soft keyboard state unchanged when tapping its key bar, uses VisualViewport to slide content instead of resizing the terminal, and tunes xterm’s hidden input for iOS/CJK/IME: [terminal-web README](https://github.com/AaronFei/terminal-web) (crawled 2026) and its [session input implementation](https://github.com/AaronFei/terminal-web/blob/main/web/session.ts) (crawled 2026). This is the closest useful implementation precedent, but it still documents a workaround strategy rather than guaranteed focus.
- **mobile-tty:** an iPhone/Safari-tested project uses server-owned background sessions, `@xterm/headless` plus a DOM renderer, and VisualViewport-based grid sizing: [mobile-tty](https://github.com/elidickinson/mobile-tty) and [iOS input plan](https://github.com/elidickinson/mobile-tty/blob/main/docs/plan-ios-input.md) (crawled 2026). It does not claim to support every full-screen alternate-screen application.
- **ting.sh:** its changelog documents fixes for iOS touch-start scrolling, VisualViewport keyboard avoidance, forcing 16 px for the helper input, immediate focus, and canvas repaint issues: [ting.sh](https://github.com/andrewting19/ting.sh) (crawled 2026). This indicates ongoing per-version maintenance rather than a one-time recipe.
- **Ghostty web:** a web terminal uses a hidden textarea, disables autocorrect/autocapitalize, and focuses synchronously from mouse/touch handlers: [Ghostty web commit](https://tangled.org/alice.mosphere.at/ghostty-web/commit/59bb045af54c99b9185e1bf7d1ec436e70a9d6f7) (crawled 2026). This supports the plan’s input-sink pattern but is not proof of iOS 26 standalone reliability.
- **Blink:** Blink’s iOS terminal is a native app, with a native Smart Keys/context bar. Its documentation is a useful native precedent, not a web precedent: [Blink documentation](https://docs.blink.sh/) (current 2026).

## Plan claims that are wrong or risky

1. **“Attributes avoid QuickType.”** Too strong. The attributes reduce correction/AutoFill but do not reliably suppress predictive text. Password-field suppression is a fragile workaround.
2. **“Accessory rows are known/controllable above the keyboard.”** The system accessory is not page-controlled. Do not hard-code one height; 44/59 px host values and a 62 px standalone system gap are different measurements, and exact Safari PWA behavior remains unverified.
3. **“Done blurs the field.”** Do not depend on this. Treat Done as keyboard dismissal and tolerate missing/odd blur/focus events.
4. **Keyboard detector based only on `innerHeight - visualViewport.height`.** Risky on iOS 26 standalone, where both can track the visible viewport while the layout viewport stays different. Add focus/viewport/scroll signals and a manual keyboard toggle/recovery path.
5. **`100dvh`/VisualViewport gives a stable geometry contract.** It does not. Rotation, dismissal, fixed positioning, offsetTop, and resize timing have current WebKit bugs. Avoid resizing the PTY from transient events.
6. **WebSocket reconnect on lifecycle events alone.** Insufficient. Lifecycle events can be absent and iOS 26 has a reproduced stuck-`CONNECTING` regression. Use a health timeout, server session identity, socket replacement, and controlled reload.
7. **“Home Screen storage is durable.”** The seven-day ITP exemption is real, but quota/storage pressure and memory eviction still apply. Keep tmux/session/auth recovery server-side.
8. **“Cookies are shared with Safari.”** They are isolated after installation. Authenticate in the standalone app and test first-install cookie behavior.
9. **“RP ID auto-detected from `*.ts.net`.”** Pin a stable full hostname; RP IDs are not wildcards. Test the exact machine/tailnet hostname and do not use bare `ts.net`; changing names breaks credential lookup.
10. **“xterm canvas fallback.”** Wrong for current xterm 6, where canvas was removed. Use DOM/WebGL and implement WebGL context-loss/recreation handling.
11. **“xterm solves mobile input.”** It does not. IME, helper-textarea, touch selection, and iOS 26 CJK/dictation issues remain active. The custom selection/touch layer and physical-device IME testing are required.
12. **“iOS haptics via `navigator.vibrate`.”** Unsupported in current iOS compatibility data; make it optional only.
13. **“Clipboard read will show a confirmation bubble.”** It may show system Paste UI, but gesture/permission bugs and rejection are known. Preserve the paste-event fallback and expect image normalization.
14. **A thin WKWebView shell is not automatically the fix.** It shares WebKit’s viewport, lifecycle, WebGL, and IME behavior. Native value comes from implementing a real first responder, native input accessory, haptics, and clipboard/auth bridges.

## Unverified items requiring a physical-device spike

- Exact form-assistant height, keyboard dismissal/blur sequence, and predictive-strip behavior on the target iPhone 17 Pro build.
- Standalone WebAuthn enrollment/assertion with the chosen stable `*.ts.net` hostname and RP ID.
- Long screen-lock/background intervals, memory-pressure reload, and the exact stuck-WebSocket recovery sequence.
- Whether the selected xterm 6 WebGL build loses context on the target iOS 26.x build, and whether DOM fallback is visually acceptable.
- CJK IME, dictation, selection handles, touch scroll, paste confirmation, and image clipboard behavior.

