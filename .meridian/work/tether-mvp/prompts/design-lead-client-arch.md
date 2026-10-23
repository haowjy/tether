# Design the rebuilt web client: architecture, design system, platform adapter

The old web UI is being thrown out and rebuilt for three clients (desktop browser,
phone browser/installed PWA, native iPhone WKWebView) on the approved layouts. Jimmy
also wants the layouts improved with standard components and a proper design-token
system. Write the client architecture spec to
`.meridian/work/tether-mvp/design/client-architecture.md`. Design docs only; no source.

Read: `docs/design/client/README.md`, `browser-behaviors.md`, `mockups/index.html`
(the approved layout), `terminal-interaction-design.md`, `browser-setup.md`,
`connection-roadmap.md`; `docs/design/plan.md` (Code structure and standards),
`ios-shell.md`; the current `web/` tree; and the inventory in the report of spawn p25
(`meridian spawn show p25`; summary: proto/, tabs/, term/pipeline+size+prompt,
net/http, ui/store are UI-free and tested; main.tsx, native/bridge, term/xterm,
app/*, files/* are coupled to native boot or the old sheets; the protocol already has
create session/window with name and dir, attachedElsewhere, window index).

Settle, with alternatives rejected:
1. **What survives** from `web/`, what is deleted, and the new module layout.
   Default: keep the UI-free core, delete every old view, style and the
   native-only lint ban (rescope the no-focus rule to the native app).
2. **Platform adapter**: one interface the app calls for boot and credentials, input
   and focus, viewport and keyboard, lifecycle (visible/online), storage, file pick
   and image paste, link opening, haptics. Implementations: browser, native, test.
   The dev shim must not become production auth.
3. **App state and routing**: Home/Terminal/Files, tabs keyed by server+window
   identity, restore after reload validated against a listing, browser history rules
   from the contract, the sessions listing refresh (event-driven, no polling).
4. **Design system**: token tiers (primitive → semantic → component) in CSS custom
   properties, light/dark, a density axis for desktop vs touch (44 px targets), type
   scale with the terminal font, the connected/reconnecting colors (no dot markers).
   Components: choose between a headless accessible library that works with Preact
   (check size, Preact compatibility, maintenance — e.g. via preact/compat) and a small
   owned primitive set; consider bundle size, since the shell ships over spotty links.
   List the components the screens need and which mockup details you'd improve.
5. **Terminal input on desktop and phone browser**: xterm's own textarea vs a
   tether-owned input; the local draft editor; paste and image paste routes.
6. **PWA**: manifest, service worker scope and update flow, what is cached, offline
   drafts that never queue terminal input.
7. **Build order** as lanes with disjoint directories so several coders can work in
   one checkout at once (no worktrees by repo policy), and what each lane verifies.

Keep Jimmy's explicit choices: no Files in `+`, no intermediate menu, no dot markers or
separators, no custom browser keyboard strip, local draft whose Insert sends no Enter.
Browser auth (being revised) admits enrolled tailnet nodes, no cookie; the adapter's
boot reads an enrolment state from the daemon. Default memory budget allows 3
sessions at once; a refused session needs a clear message. Write for a cold reader.
