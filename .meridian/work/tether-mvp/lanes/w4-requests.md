# W4 requests for W0-owned files

W4's code works against the stand-ins below; each stand-in is deleted in W4's next commit once its request lands.

1. **`web/platform/browser/index.ts`: pass `emit` to the PWA capability.** Change `...createPwa()` to
   `...createPwa(emit)`. `createPwa(emit)` is already the signature (the default `emit` is a no-op, so the
   file compiles today). Why: `updates` raises `update` events through the platform's one change channel, and
   `emit` is built inside `createBrowserPlatform`. Until it lands the real app never shows "Update ready".
   *Stand-in:* `e2e/pwa/vite.build.config.ts` rewrites that one line while building the bundle the PWA gates run on.

2. **A third update state, `reload`.** `web/platform/types.ts`: `UpdateState = "none" | "ready" | "reload"`
   (doc: "reload: another page applied an update; this page keeps running the previous build").
   `web/app/App.tsx` `AppBanners`: for `update === "reload"` show
   `<Banner tone="warning" title="Reload to finish updating" action={{ label: "Reload", onAction: () => { app.platform.restart("update"); } }} />`
   on every destination except the terminal, like "Update ready" (the spec's §9.3 step 4 offer to the other
   pages). Why: the existing "Reload to finish updating" banner is bound to `storageClosed`, whose copy says
   changes are kept in memory, which is not true after a plain worker takeover; `UpdateState` has no value for
   it. *Stand-ins:* `pwa.ts` emits `"reload" as UpdateState`; the e2e build config inserts the banner.
   Delete `RELOAD` in `pwa.ts` when this lands.

3. **`web/playwright.config.ts`: a per-port `outputDir`.** Add ``outputDir: `test-results-${PORT}` ``
   (and gitignore `web/test-results-*`). Why: every lane writes `web/test-results/` and Playwright empties it at
   the start of a run, so one lane's run deletes another lane's traces mid-test (seen: `ENOENT ... .playwright-artifacts-6`).
   W4 runs with `--output /tmp/tether-meridian-501/w4/pw-out` meanwhile.

No change needed for the protocol-mismatch Update button (§9.3 step 5): `updates.apply()` already checks for a
new worker first and reloads when there is none, so `HostProblem`'s `app.applyUpdate()` is correct as it is.
