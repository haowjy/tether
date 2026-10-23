# Research: accessible UI components for a small Preact 11 app shipped over spotty links

tether's web client (Preact 11.0.1, Vite 8, TypeScript strict, xterm.js 6) is being rebuilt.
It runs in desktop browsers, iPhone Safari / installed PWA, and an iOS WKWebView. The shell
is downloaded over weak mobile links, so every KB counts. We must choose between:

A. a headless accessible component library usable from Preact, and
B. a small owned primitive set built on native HTML (`<dialog>` + showModal, the `popover`
   attribute, `<details>`, `inert`, `:focus-visible`, `<button>`), plus our own roving-focus/listbox code.

Components the screens need: modal dialog (desktop picker, creation form), bottom sheet (mobile
picker, iOS-style, tall, rounded), disclosure/accordion (session groups), listbox or
grid-ish list with keyboard navigation (session/window rows, file rows), tabs strip (terminal
tabs: horizontally scrolling, closable, not a classic tabpanel?), text field + search field,
buttons/icon buttons with tooltips, toast/live-region status, maybe a menu.

Find, with sources and dates (today is 2026-10-23):
1. For each candidate — Radix Primitives, React Aria Components / react-aria hooks, Base UI,
   Headless UI, Ark UI / Zag.js (incl. any vanilla or Preact adapter), Ariakit, and any
   Preact-native headless option — does it work with Preact 11 (natively or via preact/compat)?
   Known breakages (portals, useId, useSyncExternalStore, React 19-only APIs, event
   system differences, refs-as-props)? Last release date, maintenance signals.
   Minified+gzipped cost for dialog + disclosure + listbox (bundlephobia/pkg-size or measured), plus preact/compat's cost.
2. Platform support for the native route on iOS Safari 17–26 and current desktop browsers:
   `<dialog>` showModal (focus trap, Escape, top layer, `closedby`), `popover`, `inert`,
   `<details name=>` exclusive accordions, `interestfor`/tooltips, CSS anchor positioning,
   `@starting-style` for enter/exit animation. Known iOS WKWebView/Safari bugs (e.g. dialog
   focus, scroll lock, virtual keyboard with dialogs).
3. Is Preact 11 actually released and what changed vs 10 that matters for compat libraries?
4. Your recommendation with the reasoning, and what the owned route must implement itself
   (e.g. roving tabindex, typeahead, scroll lock, focus return).

Write nothing to the repo. Report findings with links in your final report; mark guesses as guesses.
