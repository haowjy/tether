# Web spacing pass: nothing clipped, everything fits the browser

Jimmy's first real use of the web client (desktop browser, then phone) showed layout
problems. His words: "the open session thing is covering the search box a little bit"
and "make sure everything is properly spaced to fit inside the browser properly".

## Known instance
The "Open session" dialog (`web/screens/picker/`, also the same search field in
`screens/home/Home.tsx` and `screens/switcher/Switcher.tsx`): the "Find a session"
field's 2px focus ring (`ui/tokens/base.css` `:focus-visible`, offset 2px; `LineInput`
uses offset 1px) is clipped along its top edge, apparently by the dialog's scrolling
body (`overflow` clips outlines drawn outside the field). Screenshot: desktop browser,
dialog ~960px wide, ring flat at the top.

## The task
That instance is one of a class: focus rings, shadows and content clipped by an
`overflow` container, and content that does not fit the viewport (horizontal scroll,
cut-off dialogs, controls under the safe area or the on-screen keyboard). Find and fix
the class across every screen and primitive, not just the picker. Fix it at the right
level: if the primitive (Dialog, LineInput, list/scroll container) causes it, fix the
primitive, not each screen.

Check every screen in both layouts and both schemes through the harness
(`/harness/index.html?fixture=...&layout=phone|desktop&scheme=dark|light`, see
`web/README.md`), at these viewports at least: 1440x900, 1024x768, 390x844 (iPhone),
375x667, 320x568; and with long session names, many sessions, error/empty/loading/offline
states. Use Playwright (Chromium and WebKit) to screenshot and to assert no element
overflows the viewport horizontally and no focus ring is clipped (e.g. compare the
outline box against the nearest clipping ancestor). Keep those checks only as your own
verification unless they are cheap, stable and worth keeping; if you think one earns a
permanent place, propose it in your report rather than committing it.

## Constraints
- Read `web/AGENTS.md` first. Raw inputs live only in `ui/primitives/`; colour through
  `ui/tokens/semantic.css`; spacing/radius from the scales; each screen styles itself
  with a CSS module. `ui/` is W0-owned: edits there are allowed for this pass; record
  each primitive change and why in your report (the lead logs it).
- Jimmy's explicit layout choices stay (`docs/design/client/browser-behaviors.md`): no
  Files in `+`, no intermediate menu, no dot markers or separators, the phone dock.
- pnpm only (`pnpm --dir web ...`). Do not commit; the lead commits.
- `pnpm --dir web run check` and `pnpm --dir web run e2e` must pass.

## Report
What you found (each instance: screen, viewport, cause), what you changed and at which
level, before/after screenshots saved under
`.meridian/work/tether-mvp/evidence/web-spacing/` (PNG, small), verification results,
and anything you saw but didn't fix.
