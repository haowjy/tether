# Tether approved mockup — visual and interaction critique

## Summary

The prototype establishes the approved navigation and has generally strong text contrast, but its visual language is not yet systemized: spacing/type/radius/icon values are scattered, the mobile picker changes to a light surface against a dark app, and mobile tab overflow clips the next tab label. Search and dialog controls also fall just short of the touch-target floor. This is a critique of the static presentation, not a change to Jimmy's fixed product choices.

Contrast checks use WCAG relative luminance (sRGB): muted `#a9b0c2` on panel `#1d2030` is **7.43:1**, and on terminal `#151725` is **8.19:1**. The mobile picker muted text `#536574` on its sheet `#edf1f3` is **5.31:1**, and on its input fill `#e1e7eb` is **4.83:1**. These sampled text pairs pass 4.5:1 AA; contrast is not the primary defect. (The mobile input has little margin over AA.)

## Defects and recommendations

| Element | What's wrong (measured where possible) | Suggested fix |
|---|---|---|
| Spacing system | There is no spacing token scale. The CSS mixes 4, 5, 8, 10, 12, 14, 16, 18, 20, 24, and 25px paddings/gaps/margins. For example, Files uses 25px outer padding, Home uses 20/24px on desktop and 12/16px on mobile, rows use 10/12px, and picker content uses 16px. The variation reads as hand-tuned rather than rhythmic. | Establish a small spacing scale (e.g. 4/8/12/16/24/32) and semantic layout tokens; align the Home, Files, preview, and dialog gutters to it. |
| Type scale | Text runs from 11px captions through 12/13px metadata, 14px body, 16px brand, 17/18px dialogs, and 20px Files heading with no clear scale. Mobile terminal output drops to **12px**; window counts and host context are also small. | Define a compact type ramp with body and metadata roles; keep terminal text comfortably readable on phone and reserve the smallest role for nonessential metadata. |
| Color tokens | Core colors are partly variables, but many nearby colors are hard-coded: active tab/row greens, scrims, hover fills, reconnect amber, focus blue, and input/surface colors. The same connection state is encoded through several unrelated literals. | Use semantic role tokens for surface, border, text, focus, connected, reconnecting, and hover, with explicit dark/light theme mappings. Preserve current contrast-tested values where they work. |
| Mobile picker sheet | The phone picker is a pale blue-gray `#edf1f3` sheet with dark text, while the terminal/app behind it is near-black `#151725`. It reads as a different product/system and is a sharp treatment change from the dark desktop picker. The text contrast passes (5.31:1), so this is a coherence issue rather than a contrast failure. | Either make the sheet a dark tonal layer within the app, or deliberately define a platform-owned light sheet treatment and carry its input, borders, icons, scrim, and focus states through consistently. |
| Radii | Radius values are un-tokenized and inconsistent: app 12px, cards/inputs/buttons mostly 7–8px, desktop picker 20px, mobile sheet 24px top corners, dialog 12px, circular picker close button. | Set semantic radii (control, card, dialog, sheet) and use them consistently; retain a larger sheet radius only if it is a deliberate platform convention. |
| Touch targets | Most mobile rows and toolbar buttons meet 44px: session/file rows 48px, bottom nav 52px, toolbar controls 44px, New session 44px. But Home and picker search fields are **42px** high; dialog inputs are 42px and Cancel/Create buttons compute to about **41px** (21px line + 20px vertical padding). The platform selector itself is 40px. | Raise all phone-interactive controls to at least 44px; keep the desktop-only demo selector out of the shipped component system. |
| Tab overflow / tab hierarchy | In the 393px mobile terminal screenshot, the next inactive pill is visibly clipped to `notes /` before the `+` control; the window name is hidden even though the spec prioritizes the window portion. The pills also give session and window equal visual weight. | Preserve the window/index before truncating the session; use a deliberate compact tab layout or visible scroll affordance/peek, and distinguish session/window with weight or tone without reducing legibility. Keep the full accessible label. |
| Desktop density and use of width | Desktop Home puts all sessions, open tabs, filter, and creation into a **640px max-width** column, leaving broad unused space across the 1440px workspace. Vertically, rows are packed with 4px margins while the page-level demo annotation and explanation sit outside the app and consume viewport height. | Let the Home list use a wider but bounded measure and a more consistent vertical rhythm; keep explanatory prototype copy outside the production workspace. Do not add an expanded sidebar or extra navigation. |
| Creation affordance | “New session” and “New window” are bare, muted text rows with a plus icon; they have less visual weight than existing-session cards, even though creation is a distinct and consequential action. | Give creation actions a clear but restrained button treatment and consistent target size, while keeping them separate from opening existing sessions. |
| Connection notice | The reconnect notice is absolutely positioned over the terminal at `top: 8px` on mobile / `60px` otherwise. In the reconnect screenshot it covers the terminal's top context/output instead of reserving space. | Reserve a compact status band or reposition the notice so terminal output remains readable; retain the visible Retry action and tab-level status. |
| Focus states | A global 2px blue `:focus-visible` ring exists and has strong contrast (sampled blue on terminal: **8.53:1**), but it is a single un-tokenized treatment for every control and is not shown as part of the visual system. | Keep visible keyboard focus, promote its color/width/offset to tokens, and visually verify it on the active tab, compact rail, modal/sheet controls, and edge-adjacent controls. |
| Hover affordance | Most button hover feedback is a generic background fill; disclosure summaries have only a pointer cursor, while icon-only desktop navigation depends on title tooltips for visible names. Tooltips are not a reliable touch discovery treatment. | Define coherent hover and focus states for rows and disclosures; ensure icon-only destinations have an explicit, usable label treatment at the intended platform breakpoint and on keyboard focus. |
| Icon sizes | Icon dimensions are scattered: default 21px, row icons 20px, create/search 18px, chevrons 16px, tab close 15px. Close controls are especially small visually inside their hit area. | Adopt a small 16/20/24px icon scale and standardize stroke/optical alignment; distinguish icon glyph size from the 44px interactive target. |
| Empty/loading/error states | The mockup includes “no open tabs” and “no matching sessions” copy, but no server/list loading or failure state, no unavailable host/retry state, no empty folder state, and no Files read/permission error. Empty arrays can look like blank content. It only demos reconnecting, not a terminal error. | Add clearly distinct loading, empty, and error examples for sessions and Files, with explicit retry/recovery actions; preserve the existing empty-tab and no-match examples. |
| Row alignment / semantics | Session and file rows share a useful 48px height and aligned leading icon/text positions. However, the metadata varies by surface (`2 windows`, `Open`, `Folder`/`File`), and nested window rows use a different indented treatment, so their alignment needs to be treated as deliberate hierarchy rather than merely visually similar. | Lock common row slots (leading icon, primary label, metadata, trailing action) and baselines; specify the nested-window indent separately and check long labels/counts at narrow widths. |

## Screenshots

All captures are under `/tmp/tether-mockup-shots/`:

- Desktop Home — `/tmp/tether-mockup-shots/desktop-home.png`
- Desktop terminal with tabs — `/tmp/tether-mockup-shots/desktop-terminal-tabs.png`
- Desktop picker open — `/tmp/tether-mockup-shots/desktop-picker-open.png`
- Desktop Files list — `/tmp/tether-mockup-shots/desktop-files-list.png`
- Desktop Files preview — `/tmp/tether-mockup-shots/desktop-files-preview.png`
- Desktop New session dialog — `/tmp/tether-mockup-shots/desktop-new-session-dialog.png`
- Mobile Home with one group expanded — `/tmp/tether-mockup-shots/mobile-home-expanded.png`
- Mobile Files — `/tmp/tether-mockup-shots/mobile-files.png`
- Mobile terminal — `/tmp/tether-mockup-shots/mobile-terminal.png`
- Mobile picker sheet — `/tmp/tether-mockup-shots/mobile-picker-sheet.png`
- Reconnecting state — `/tmp/tether-mockup-shots/reconnecting-state.png`

## Verification and limitations

Read `docs/design/client/browser-behaviors.md` before reviewing. Captured the requested platform/state combinations in `/tmp/tether-mockup-shots/`. The requested HTTP server command was started and stopped. In this environment, browser and curl requests to `http://127.0.0.1:5175/mockups/` timed out even while the local server process was running, so the same static `mockups/index.html` was opened with `/agent-browser` via `file://` for inspection and screenshots. No repository source files were modified.
