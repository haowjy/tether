# Slice 5 fix round 1

You built `6ee6f52` and `31cb04e`. Review p354 (not fit to push):
`/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p354/report.md`; harness probe
p355: `.../p355/report.md` (screenshots `.meridian/work/tether-mvp/redesign/s5/`). Read
both in full. One or two local commits on top; do not push; stage only your files.

Fix all p354 findings, as the class where it names one:
- **#1 (High)** one owner for the window's appearance on the SwiftUI side:
  `preferences` published, `.preferredColorScheme(...)` on `TetherRootView` (nil for
  System), delete `applyAppearance`, the `viewWillAppear` override and the
  `shell?.applyAppearance` call. Verify on a Simulator the way p354 did: system Light,
  stored `dark`, cold launch → dark web, dark lock screen; and the reverse.
- **#2** relock elapsed time on a clock that counts through sleep and can't be set back
  (`ContinuousClock`); lock when elapsed exceeds the delay **or is negative/unknown**.
- **#3** `Preferences.init(from:)` decodes each field on its own: missing or unreadable →
  that field's default, except `relock`, which falls back to the strictest choice (5 min);
  encode with `try`, never write nil.
- **#4** refuse `setPreference` while locked (same guard as `token(for:)`). **Lead
  decision:** a change that loosens relock (to a longer interval or At launch) needs a
  fresh native Face ID evaluation before it is applied; tightening applies at once; a
  cancelled or failed evaluation leaves the setting unchanged and the web's control shows
  the stored value. Log it in `decisions.md` (2026-10-27, lead; rejected: any web request
  applies, since relock is a security control the web alone shouldn't weaken) and in
  `auth.md` "When the app asks for Face ID".
- **#5** make the terminal sizer current while the terminal is hidden (the class: any
  sizer input changing while hidden), so a return sends the one `watch` at the right
  size and no extra `resize`. Prefer measuring the cell from the font in an always
  laid-out probe; verify on the real stack (`TMPDIR=/tmp`, tmux 3.4) that a text-size
  change then a tab show sends exactly one claim at the new size.
- **#6** relock can't be set on a platform that has no relock (type it so).
- **#7** `Choice`: either the ARIA radio pattern with roving tabindex and arrows, or
  `role="group"` with `aria-pressed` buttons.
- **#8, #9** as written.
- **p355:** the `settingsApp` fixture has no Face ID relock section: find whether the
  fixture lacks native preferences or the code hides it, fix the cause; and the
  segmented control clips its focus ring (2 px ring, 2 px offset must show whole).

No UI tests; code structure over if statements. Gates: `pnpm --dir web run check`,
`ios/scripts/check.sh`, `scripts/preflight.sh full`. Report SHAs, what you ran and saw
(Simulator steps included), and what stays device-unverified.
