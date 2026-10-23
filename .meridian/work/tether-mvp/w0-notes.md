# W0 notes: the client skeleton and design system

For the lead to fold into `docs/design/decisions.md`, `browser-behaviors.md` and plan.md, and
for the next lanes. Design: [client-architecture.md](design/client-architecture.md) rev 4.
Screenshots of every route in both layouts, themes and the two admission families:
[evidence/w0/](evidence/w0/).

## Departures from the spec

1. **`native/bridge.ts` stays** (§3.1 moves it to `platform/native/`). `tabs/driver.ts`,
   `tabs/input.ts`, `term/size.ts` and its test import `InputEvent`/`Viewport` from it, and
   those files belong to W2 (and the daemon fixer). It carries a lint exemption for the
   `webkit` rule only. W2 retargets the imports to `platform/types`; W5 moves the file.
2. **The module-graph check is a Vite plugin, not a preflight read of `manifest.json`**
   (§5.11). A manifest lists entry chunks, not the modules inside them, so it can't see a
   module under `platform/test/` or `harness/` bundled into the shell. `vite.config.ts`
   fails the build on `getModuleIds()` instead (proved by a seeded import).
3. **`light-dark()` carries the two themes** (§8.3 "each semantic colour has a dark and a
   light value"), selected by `color-scheme`, which the platform's `data-scheme` on `<html>`
   overrides. One block instead of two, and no flash. Needs Safari 17.5, Chrome 123, Firefox
   120.
4. **`ui/focus.ts` is a port the primitives use; `app/focus.ts` implements it.** Primitives
   can't import `app/`, and only the controller may call `.focus()`; the port keeps both.
5. **The workspace reducer has no `drop`/`attach` effects.** The effect list stays the spec's
   (`cover`, `uncover`, `save`, `focus`, `notice`). The terminal lane registers each
   `TabDriver` with `app.attachDriver(id, { cover, uncover })`, which aligns it with the tab
   on screen at once. Created drivers must start `covered` unless they are the shown tab.
6. **`listing` prunes more than restoring tabs, and decides by endpoint.** A listing from
   the same tmux *endpoint* with a different run (`<endpoint>:<pid>-<start>`) closes that
   host's tabs for it (a restarted tmux); another endpoint (scratch) is never touched; a
   null listing (no tmux server) decides nothing. One notice reports closures.
7. **`sessions/` isn't created.** It is W1's. `app/listing.ts` exposes `subscribe(event)`
   (`listed`, `failed`, `renamed`), `refresh(handle)`, and the controller feeds the reducer;
   W1's `sessions/` is the cache over those events.
8. **`platform/browser/uploads.ts` is a stub** (W3 owns it) so `createBrowserPlatform` is
   complete. The brief named three stubs; this makes four.
9. **`tabs/status.ts`** has `limitedStatus()` but no `limited` branch in `describe`: the
   `limited` connection state is W2's (the driver and `connection.ts` are not W0's).
10. **Dev proxy** reads the token from `TETHER_DEV_TOKEN`, targets `TETHER_SOCKET` or
    `TETHER_PORT`, and refuses requests without Serve's `Tailscale-User-Login` header. It
    was not run against a live daemon here (the daemon's local socket is in flight).
11. **`preflight.sh`** accepts `--commit <sha>` before or after the mode. In an export it
    does not `npm ci` over the shared `node_modules`; `web/scripts/check-install.mjs` fails
    instead if the linked install differs from the commit's lockfile. `TETHER_PREFLIGHT_E2E=1`
    adds Playwright to `full`; CI would need browsers installed first, so it is off by default.
12. `@playwright/test` is pinned to 1.54.2 (the Chromium build already on the box) with a
    `playwright-core` override so `@axe-core/playwright` shares it.

## Mockup departures (for decisions.md)

Applied from §8.5: one scale per property (spacing, radius, type, icon sizes 16/20/24);
the phone picker sheet follows the theme; 44 px targets in `touch`; window part first in
pills with a fade mask at the scrolling edge; a focus-ring token; Tooltip on rail and
toolbar icons; desktop Home column `min(720px, 100% - 2 gutters)`; loading, empty, offline,
error and Enrol states designed. Added in W0:

- **Accent is blue, not green.** The mockup's selected rail icon and open-tab text are
  green, but green is the connected status colour and §8.3 keeps status and selection on
  separate channels. Selection is fill and weight; `--color-accent` is blue.
- **Selected rows use a blue-tinted fill, not green text.**
- **Phone toasts sit above the bottom toolbar** (`--toast-offset`), so they never cover tabs.

## plan.md "Code structure and standards" (W0's spec edit, for the lead)

Replace the `web/` tree with §3.2 of the design; replace the Frontend bullet with the five
rules of §3.3 (they are `web/lint/rules.js`, each proven by `web/lint/rules.test.ts`); add to
the Tests bullet: Playwright on Chromium and WebKit against the harness (`web/e2e/`,
`npm --prefix web run e2e`), axe on every route in both themes and densities, plus
`scripts/checks.mjs` (shell budgets, the copy rule, the colour-token rule).

## For the next lanes

- Fixtures: add yours in `harness/<lane>/index.ts` (`{ options?, daemon?, render? }`);
  open `/harness/index.html?fixture=<name>&layout=…&scheme=…&density=…#/route`. The shared
  matrix in `e2e/shared/routes.spec.ts` shows how to run axe over yours. `gallery` is the
  primitives page.
- `useApp()` gives `platform`, `hosts`, `router`, `focus`, `persist`, `listing`, `dispatch`,
  `attachDriver`, `notify`, `applyUpdate`; `useAppView()` the re-rendering view state.
- A screen asks for an overlay with `router.openOverlay({ screen, name, params })` and
  renders it by reading `nav.entry.overlay`; the router owns history. Close it with
  `router.closeOverlay()`.
- Dialog focus: pass `returnFocusTo` (a registered name: `terminal`, `draft`, `homeSearch`,
  `plus`). Register elements with `focus.register(name, el)` or the `focusTarget` prop.
- `files/kinds.ts` still lists 28 Shiki grammars; only the 13 in `vite.config.ts` `GRAMMARS`
  are chunked without stubs. W3 trims it, or the shell budgets fail (cpp alone is 800 KB).
- Fonts: the core faces are 18 KB each; the symbols fallback is 126 KB of the 150 KB budget
  and holds Powerline, Seti, Devicons and Octicons only. Font Awesome and Codicons did not
  fit; the §12 prompt probe decides whether Jimmy's prompt needs them.
