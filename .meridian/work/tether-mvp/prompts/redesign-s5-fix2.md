# Slice 5 fix round 2 (sizer chrome, WebGL rounding, Face ID reason)

Re-check p359 of your `330b389`:
`/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p359/report.md`. Security holds.
Fix its three findings; one local commit on top; do not push; stage only your files.

- **#1 (Medium, second round of the class "sizer inputs changing while the terminal is
  hidden"):** make a hidden chrome change one-shot: `openChromeWindow` records that the
  chrome is pending when the element isn't laid out; `measure()`, at its first laid-out
  run with chrome pending, calls `setChrome` and closes the window there, so the window
  can never outlive its first laid-out measure and a later keyboard can't be read as
  chrome. Check every sizer input (text size, chrome, density, safe area) goes through
  the same pending-until-laid-out rule, so this class has one mechanism.
- **#2:** in `onContextLoss`, `webgl = undefined` before `attachWebgl()`, so the font-cell
  rounding follows the renderer that actually draws.
- **#3:** the Face ID reason names the target choice (e.g. "Ask for Face ID only when
  tether starts", "Ask for Face ID after an hour away").

Verify on the real stack (`TMPDIR=/tmp`, tmux 3.4, Chromium and WebKit, phone viewport):
rotate (change viewport orientation) while on Home, return to the tab (one claim at the
right size), then raise the keyboard (no `resize` sent; `tmux display -p
'#{window_height}'` unchanged); and the text-size case still sends one claim. Gates:
`pnpm --dir web run check`, `ios/scripts/check.sh`, `scripts/preflight.sh full`. Report
the SHA and what you saw.
