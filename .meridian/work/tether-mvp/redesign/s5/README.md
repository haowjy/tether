# Slice 5 harness — p355

Frozen export `/tmp/tether-rev-s5/` (31cb04e), 2026-10-27. Installed with `pnpm --dir /tmp/tether-rev-s5/web install --frozen-lockfile`; served with `pnpm --dir /tmp/tether-rev-s5/web exec vite --configLoader runner --mode harness --port 5251`. Server and named browser session stopped afterward. Screenshots are viewport captures in Chromium, not a real iPhone.

The matrix `{phone,narrow,desktop}-{dark,light}-{settings,settingsApp,dock,homeTabs,sessions,files}.png` uses `/harness/index.html?fixture=NAME&layout=phone|desktop&scheme=dark|light`; phone is 390×844, narrow 320×844, desktop 1280×800. The sessions fixture forces the phone sheet even at desktop width. The separately captured `desktop-*-popover.png` uses dock fixture and the desktop Open another session button. `phone-dark-to-light.png`, `phone-light-after-switch-home.png`, `phone-switch-light-terminal.png` and `phone-switch-light-sheet.png` show appearance switch and subsequent navigation. `phone-focus.png` shows keyboard focus on System. Appearance state is initialized by each fixture; switch captures are the same running page.

## Results

- Appearance and terminal size: present in both fixtures. System and Default selected initially, visibly blue and bold. All seven radio buttons measured 44 px high in the 320 px browser and app fixtures; widths exceed 44 px.
- Face ID relock: **missing** from settingsApp (and rightly absent from settings); no 1 hour selection exists. The harness app fixture exercises managed mode, not real native authentication.
- Focus: computed outline is 2 px solid with 2 px offset, but the segmented control clips the ring at its top, bottom and outside edge; only a short line is visible in `phone-focus.png`.
- Switching Dark-system to Light updates Settings, Home, terminal and sheet in the same session. Captured dark terminal is black; dark non-accent surfaces appear neutral, light surfaces legible. Screenshots of both schemes cover dock, cards, sheet, Files and desktop popover.
- At 320 px, each of six fixtures in each scheme had `documentElement.clientWidth == scrollWidth == 320`; no visible document text contained U+00B7. These checks do not cover every possible dynamic state.
- Comparison with `../before/phone-dark-settings.png` and `../before/phone-dark-terminal-dock.png`: Settings is now a full screen with appearance and text size controls instead of a modal, and the previously blue-black terminal is now black. The UI's sheets and cards use blue selection and neutral dark surfaces.

Limitations: no native iPhone, actual Face ID, persistence across real platform launches, or real OS keyboard was tested. The test platform's connection notice in the switch-to-terminal capture reflects the harness, not a production network check. Screenshot matrix is captured at rest after a 300 ms pause; no performance comparison was made.
