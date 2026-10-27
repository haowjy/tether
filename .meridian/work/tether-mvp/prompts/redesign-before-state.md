# Capture today's web UI before the redesign replaces it

tether's web client (`/Users/jimmyyao/repos/tether/web/`) is about to be redesigned
(`docs/design/client/browser-behaviors.md`). Capture what it looks like now, so later
slices can be compared against it.

Use the harness (see `web/README.md`, "The harness"): start it with
`pnpm --dir web run dev -- --mode harness` (pnpm only, never npm) and open
`/harness/index.html?fixture=<name>&layout=phone|desktop&scheme=dark|light#/route`.
List the fixtures under `web/harness/` and pick the ones that show each screen.

Screenshot, in phone layout (390x844) and desktop layout (1280x800), dark and light where
the scheme differs:
- terminal with the keyboard down (dock / bottom bar) and, if the harness can show it,
  the dock in its keyboard-up/line-field state
- the session switcher (phone) and session picker (desktop), with several sessions,
  including a multi-window session if a fixture has one
- Home, Settings, Files (folder list, a preview, the roots list), any tab bar
- empty / offline / error states that a fixture exposes

Save PNGs under `/Users/jimmyyao/repos/tether/.meridian/work/tether-mvp/redesign/before/`
with descriptive names (e.g. `phone-dark-terminal-dock.png`), plus a `README.md` there
listing each file, the exact harness URL, and one line on what it shows. Keep the images
small (PNG, viewport-sized; no full-page traces). Edit nothing else in the repo; stop the
dev server when done.
