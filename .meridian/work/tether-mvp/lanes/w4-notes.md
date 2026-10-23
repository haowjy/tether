# W4 notes: the PWA

For the lead: fold into `decisions.md`, `browser-behaviors.md`, `plan.md`, and the CHANGELOG.

## CHANGELOG (`[Unreleased]`)

- Added: tether installs as an app from Chromium and Safari, opens Home offline from the cached shell, and
  offers "Update ready" on Home. A new version waits for your tap, and only the tapped window reloads.

## Decisions to log

1. **The worker is built by the Vite plugin's `closeBundle`, with a nested `vite build`, not as a second
   rollup input.** It needs the finished file list and its content hash, which exist only after the main bundle
   and `public/` are written. Rejected: a second input in `build.rolldownOptions` (the precache list is not
   known yet), and a post-build script (preflight would need a second step to remember).
2. **Cache name = `tether-shell-<12 hex of sha256 over every precached file's path and bytes>`.** Not the Vite
   manifest hash, so an icon or manifest change also makes a new version. The same hash makes `sw.js`
   byte-different for every build, so the browser's own update check needs no version endpoint.
3. **The build fails if `dist/` holds a file the daemon doesn't route** (`SERVED` in `sw/vite-plugin.ts`
   mirrors `routes()` in `src/http/shell.rs`). A precached path the daemon 404s would fail every install.
   It must change with `routes()`.
4. **`updates.apply()` does the check-first rule itself** (§9.3 step 5): no waiting worker, so it asks
   `registration.update()`, waits (15 s at most) for an installing one, and reloads if there is still none.
   The Update button on the protocol-mismatch screen therefore needs no extra wiring.
5. **A cache miss for a shell path answers 404, not the network.** §9.2 says cache only. A page two builds
   behind gets a failed chunk and the designed "Update required".
6. **The worker looks in its own cache first and falls back to every `tether-shell-*`** (spec: across every
   cache). Unhashed files (`/icons/*`, the manifest) could otherwise come from the older build, because
   `caches.match` walks caches in creation order.
7. **A failed install deletes its half-filled cache.** Otherwise a later activation could keep it as "the
   replaced build".
8. **`createPwa(emit)` repeats the current state on every `check()`.** Events raised before the controller
   subscribed (the worker registers after `load`) are not lost: the launch check re-announces them.
9. **`install.installed()`** is `display-mode: standalone` or iOS's `navigator.standalone`.

## Departures from the spec and mockup

- **No "Add to Home Screen" work here.** Settings (W1) owns that copy; `platform.install.installed()` is what it reads.
- **Icon:** a `>_` prompt (blue chevron, light cursor) on the dark surface. `icons/icon.svg` is the source;
  `sw/render-icons.mjs` renders the PNGs and `favicon.ico`. The "any" icons keep rounded corners; the maskable and
  Apple icons are full-bleed (the OS rounds them). Colours are hex copies of `--color-bg` dark/light and
  `--blue-9`, because a manifest and `theme-color` cannot read a token.
- **The lazy-viewer gate uses the entry script.** No lazy chunk is in the bundle until W3's viewers land, so the
  gates ask the worker for another page's hashed entry script instead. Same code path, same outcome (200 from the
  kept build, 404 from a build two behind). Re-point it at the Markdown chunk when it exists.
- **The drafts in the gate are IndexedDB records written directly**, since the draft editor is P3a's. The gate
  checks that they survive and that the page is not reloaded, not the editor.

## What still needs Jimmy's box (daemon plus Tailscale Serve)

The e2e runs the same worker against a stand-in for the daemon's shell. Still to do through the real shell and
Serve's HTTPS origin, from a second enrolled machine:

1. `cargo build` embeds `web/dist` (`build.rs` runs `pnpm build`). Open the Serve URL in Chromium: `/sw.js` is
   `no-cache`, the manifest `name` is "tether <host>", DevTools > Application > Manifest shows no errors and three icons.
2. Install from Chromium's address-bar button; the installed window opens standalone at `/#/`.
3. Offline launch: stop the daemon, launch the installed app: Home opens from cache with the host banner.
4. The precache against the daemon's real caps (4 at once, 16 queued, `503 Retry-After: 1`): first visit installs
   all 46 files. Verified here only against a stand-in that refuses worker fetches with the same 503.
5. Update through Serve: ship a second build in the daemon binary, tap Update in one of two windows; repeat for
   the two-updates gate with real builds.
6. Cache Storage after a session with a terminal open holds no `/auth`, `/ws` or `/fs` entry (here: after `/auth`
   traffic; `/ws` and `/fs` are never intercepted by construction).
7. iPhone Safari and the installed PWA: Add to Home Screen shows the icon and "tether <host>"; standalone launch; offline launch.

## Observations outside W4

- Offline Home says "Can't reach the server", not "Can't reach pop-os" (§9.4): the banner has no host name once
  `/auth/info` fails. The saved workspace could carry the last known name (W0 `ui/hostProblem.ts`).
- Open tabs offline read "Checking...", where §9.4 says "reconnecting" (W0 `screens/home` / W1).
- `eslint .` currently fails in `e2e/terminal/` (W2's `scratch.spec.ts`, `stack.ts`).
- Chromium once logged a 500 for a harness module while another lane was mid-edit; it did not repeat.
