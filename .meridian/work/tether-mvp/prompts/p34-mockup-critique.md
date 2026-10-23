# Screenshot and critique the approved tether layout mockup

Serve and open the static mockup: from the repo root run
`python3 -m http.server 5175 --bind 127.0.0.1 --directory docs/design/client` (stop it when done)
and open http://127.0.0.1:5175/mockups/ . It has platform controls at the top to switch
desktop/mobile layouts and a connection-state selector. Read
docs/design/client/browser-behaviors.md first for what it is meant to show.

Capture screenshots (save under /tmp/tether-mockup-shots/, not the repo) of: desktop Home,
desktop terminal with tabs, desktop picker open, desktop Files + preview, desktop New session
dialog, mobile Home sessions (one group expanded), mobile Files, mobile terminal, mobile picker
sheet, reconnecting state.

Then critique as a product designer who will rebuild it with a proper design-token system and
standard accessible components. List concrete visual/interaction defects and inconsistencies:
spacing scale, type scale, color usage (contrast checks for muted text on the panels; compute
ratios), radius inconsistencies, hit-target sizes (measure: are touch targets >=44px?),
mixed light-sheet/dark-app treatment, focus rings, hover-only affordances, empty/loading/
error states missing, tab pill legibility, icon sizes, alignment of rows, dense desktop.
Keep Jimmy's fixed choices out of scope (no Files in terminal +, no intermediate menu, no dot
markers or separators, no custom keyboard strip). Report the defects as a table:
element, what's wrong (measured where possible), suggested fix. Include the screenshot paths.
Write nothing in the repo.
