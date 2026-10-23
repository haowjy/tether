# Review the client architecture design for correctness, edge cases and feasibility

Review `.meridian/work/tether-mvp/design/client-architecture.md` (design only, no source yet).
It specifies the rebuilt tether web client (Preact 11 + xterm.js 6) for desktop browser,
phone browser/PWA and the native iOS WKWebView. Read it against the real code in `web/`
(kept modules: proto/, net/host.ts, tabs/, term/, files/api.ts+browser.ts, app/sync.ts) and
the specs it builds on: docs/design/plan.md ("Reconnect", "Code structure and standards"),
docs/design/ios-shell.md (focus, bridge, lifecycle), docs/design/daemon-core.md (input items,
key names, paste, limits), .meridian/work/tether-mvp/design/resource-limits.md §3.6/§6.2,
design/browser-auth.md (rev 3; rev 4 replaces the cookie with enrolled-tailnet-node admission,
no credential in the browser).

Risks to check (not an exhaustive list — judge what else is wrong):
- The Platform interface: missing capabilities, leaky abstractions, things that cannot be
  implemented as written on iOS Safari or WKWebView (focus from gesture, visualViewport, IndexedDB in
  WKWebView custom scheme, clipboard).
- Terminal input: the desktop xterm path with attachCustomKeyEventHandler + named tmux keys;
  the owned phone input's beforeinput mapping; double delivery; paste interception order vs
  xterm's own listener; Shift+Enter; IME.
- Restore/prune semantics vs plan.md Reconnect and HostSync; the watch-before-listing choice.
- Sizing from the terminal box while the keyboard is up; tmux must never resize on keyboard.
- Service worker update flow, navigation strategy, caching rules, offline.
- Lanes: are directories actually disjoint? Hidden shared files (package.json, index.html,
  tsconfig, generated types, preflight)? Ordering hazards.
- Internal contradictions, vague "TBD" spots that would force an implementer to guess.

Write your findings to `.meridian/work/tether-mvp/design/client-architecture-review-1.md`
(severity High/Medium/Low, each with location, problem, concrete fix). Do not edit the design
or any source.
