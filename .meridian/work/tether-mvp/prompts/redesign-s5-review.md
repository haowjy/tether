# Review slice 5 (`6ee6f52`, `31cb04e`): preferences and Face ID relock

Read the frozen export `/tmp/tether-rev-s5/` (= `31cb04e` of `/Users/jimmyyao/repos/tether`),
not the live checkout. Diffs: `git log -p fddb534..31cb04e` in the repo. Writer's report:
`meridian spawn show p353`.

`6ee6f52`: listing overlays refresh only the hosts they show; `LineDrafts` registers a
clearer with `Persist`; Home cards render their own host banners; `Pill` carries host and
kind. `31cb04e`: `BootResult.preferences`, `Platform.setPreference`, a `preferences`
event; browser preferences in wrapped `localStorage` folded into `Viewport.scheme`;
native preferences in UserDefaults, `overrideUserInterfaceStyle` set in `viewWillAppear`;
relock choice sets the foreground delay (5 min / 1 h default / At launch); bridge v7
(`preferences` in Boot, `setPreference` replying with every preference); Settings
sections with a new `Choice` primitive; true-black dark terminal and hue-free greys.

Intent: `docs/design/client/browser-behaviors.md` (Visual treatment, Home),
`docs/design/auth.md` "When the app asks for Face ID", `docs/design/ios-shell.md`,
plan D5 (`.meridian/work/tether-mvp/redesign/plan.md`). Jimmy: no UI tests; code
structure over if statements.

Check, beside anything else:
- **Relock security**: can any path skip the Face ID check it should run (a preference
  write racing a foreground, At launch with a token item expected, a corrupt or unknown
  UserDefaults value, the web setting relock while locked, the background timestamp
  missing after a crash or a kill)? Unknown values must fail toward locking. Does the web
  ever learn tokens it shouldn't, or can it change relock without the user's tap?
- one owner per preference per environment; native applies appearance before the web
  paints and the effective scheme reaches the web through `Viewport.scheme` only;
  browser storage failure falls back honestly.
- text size: one resize, a deliberate claim, no resize while Home shows; cell measure.
- the bridge v7 contract consistent across `bridge.ts`, Swift DTOs and fixtures; v6↔v7
  mismatch behaviour.
- `/thermo-nuclear-review` and `/react-architecture` on the new code (`Choice`, Settings,
  theme, platform shape), and the commit-0 fixes from p352.

Edit nothing. Findings ranked by severity with path:line, a concrete failure and the
structural fix. Say whether it is fit to push.
