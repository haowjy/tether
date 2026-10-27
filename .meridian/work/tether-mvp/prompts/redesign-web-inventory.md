# Map today's web client against the client redesign

tether's web client (`/Users/jimmyyao/repos/tether/web/`, Preact + TS, shared by desktop
browser, phone Safari/PWA and the iOS app's WKWebView) is about to be redesigned. The
redesign is specified, not built. I'm the tech lead planning it in shippable slices and
need a precise map of what exists today and what each part of the redesign would touch.

Read first:
- `docs/design/client/browser-behaviors.md` (the redesign contract: Platform layout, Home,
  Terminal, Session picker/switcher, Window switcher, Files, Persistence, Phone dock)
- `docs/design/client/terminal-interaction-design.md` (dock targets, key-row routing table)
- `web/AGENTS.md` and `.meridian/work/tether-mvp/design/client-architecture.md` §3, §6, §7.4
  (state owners and the current dock/switcher design)
- `git log --oneline -40 -- web/` for recent shape

Report, with file paths and line refs:

1. **Today's structure.** The screens, the app shell/router routes, where the phone dock
   lives (Dock, KeyRow, LineField, LineMirror, nativeLine), the current session
   switcher/picker (phone and desktop), the tab bar(s), Home, Settings, Files (FilesPane,
   the single Files "place"), theme/tokens (is there a light/dark switch? a terminal
   text-size setting?), the focus controller, the workspace reducer and its persisted
   format (version, how Files is represented, drafts keying), and the native bridge
   messages that carry active tab / input target / appearance.
2. **Gap per redesign piece.** For each of: (a) terminal bar = current-tab button +
   keyboard, no terminal tab strip; (b) sessions sheet (half-height with tabs+`+` at
   bottom; full-height from Home with Back), window switch inside it; (c) keyboard-up
   layout (compose box always visible, text-only key row incl. `| ~ / -`, ←/→/esc
   routing while composing, terminal tap returns); (d) Home server-first cards + Settings
   behind a gear (System/Light/Dark, true-black dark terminal, text size, Face ID relock
   in the app only); (e) Files as N tabs each with its own place, "‹ parent" row, roots
   start; workspace format change; (f) Mermaid in Markdown previews; (g) desktop one top
   row with ⌂, tabs, +, server, and the + popover; (h) bell attention dot on tabs/rows.
   Say what exists that can be reused, what must be replaced, and what gets deleted.
3. **Coupling and enabling refactors.** Where would a slice have to touch many files at
   once? Which seams are missing (e.g. a tab abstraction that only knows terminal tabs, a
   Files singleton baked into the workspace or router, a switcher that owns state it
   shouldn't)? Which refactors would make the later slices small?
4. **Tests and harness.** Which unit tests, harness fixtures and Playwright specs pin the
   current layout (so they will go stale), and how the harness renders phone vs desktop.

Write nothing in the repo. Facts with paths/lines; mark inference as inference.
