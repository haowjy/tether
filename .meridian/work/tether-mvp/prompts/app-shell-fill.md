# One app shell that fills the window; banners live inside it

Jimmy (desktop browser, real use): "the top banner messes up with scroll... 'update ready'
causes the browser fill to not work... make sure we are properly using fill... we should
have 1 main shell that fills the window, and any banners etc should be inside it."

When the "Update ready" banner (PWA update, `web/sw/` / app shell) shows, the page no
longer fits the viewport: the banner adds height on top of a full-height layout, so the
document scrolls and the terminal/files areas no longer fill correctly.

## Task
Make the root layout one shell that exactly fills the viewport (dynamic viewport units /
`visualViewport`-driven height where the platform adapter already provides it; respect
safe areas) and lays out its children in it: every banner, status band and notice
(update ready, offline/reconnecting, "Sized for another terminal" band, admission or
error notices, anything similar you find) takes space *inside* the shell, and the main
content area flexes into what remains (`min-height: 0` on flex/grid children so inner
scrollers scroll instead of the document). The document itself must never scroll. Find
every banner-like element and every place that assumes it owns the full viewport height
(100vh/100dvh/100% chains); fix the class, not just "update ready".

Check desktop and phone layouts through the harness (`web/README.md`; add or use fixture
states that show each banner, e.g. update ready + offline at once) at 1440x900,
390x844, 375x667, 320x568, Chromium and WebKit: with each banner shown, `document.
scrollingElement.scrollHeight === innerHeight`, the terminal and files areas fill the
rest, and inner lists still scroll. Phone: the dock and the on-screen keyboard path
(`visualViewport`) must still work; you can't fake the keyboard, so reason from the code
and say what Jimmy should check on a real phone.

## Constraints
Read `web/AGENTS.md`. Environment access only in `platform/`; raw inputs only in
`ui/primitives/`; tokens for colour/spacing. W0-owned files (`app/`, `ui/`) may be edited
for this; list each change in your report. Another agent (p216) is concurrently
investigating terminal sizing (`web/term/`, `web/screens/terminal/` sizing, `src/hub`):
avoid those files unless the fill fix strictly needs them, and if so keep the edit
minimal and tell me exactly what you changed there. pnpm only. Do not commit.
`pnpm --dir web run check` and `pnpm --dir web run e2e` must pass. Put a few small
before/after PNGs in `.meridian/work/tether-mvp/evidence/app-shell-fill/`; keep
throwaway scripts outside `web/`.

## Report
Each place found (cause), the layout model you ended with, files changed, verification,
what to check on a real phone.
