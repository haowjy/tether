# W2 requests for W0-owned files

Each request names the file, the change, and why. W2 works against the stand-in named under it.

## 1. `screens/shell/Shell.tsx`: keep the terminal mounted under an admission problem

The `blocking` branch renders only `<Enrol>` or `<HostProblem>`, so `TerminalScreen` unmounts
whenever a host needs enrolment and mounts again afterwards. Change: render
`<TerminalScreen active={false} />` in that branch too, hidden beside the problem screen (or hoist it
out of the `if`).

Why: §6.5 says the terminal is mounted once and hidden, never unmounted.

Stand-in: nothing is lost today. The renderer, its element, every tab's driver and tmux's size live in
`screens/terminal/terminals.ts`, outside Preact, and `TerminalScreen` only places that element, so a
remount re-appends the same element with the buffer intact. The change would save the re-placement and
keep `TerminalScreen`'s own hooks alive; it is not urgent.

## 2. `TabHandle.insertPath` and `AppController.insertPath` (app/controller.ts)

W3's request #1, unchanged. W2 already registers `insertPath` on every handle it passes to
`attachDriver` (typed `TabHandle & { insertPath(path: string): void }` until the interface gains it), so
the request needs only the controller side. When it lands, change that intersection to `TabHandle`.

## 3. `platform/test`: `FakeLink` answers `watch`

`createTestPlatform`'s socket welcomes and answers `listSessions`, never `watch`, so a `harness/`
fixture cannot show a tab live, reconnecting or limited without a spec driving the link by hand
(`window.__harness.platform.links`, which W2's visual checks did). Wanted: a `FakeDaemon.watch?:
"ok" | { limit: string } | "never"` that answers `watching` plus a snapshot, `watchEnded { limit }` or
nothing. Then `harness/terminal/` can ship fixtures for each state and `e2e/shared/routes.spec.ts` can
run axe over them in every scenario.

Stand-in: none shipped. The states were checked in Chromium by driving the link from a throwaway spec
(screenshots in the report), and the real-daemon spec covers `limited` end to end.

## 4. `playwright.config.ts`: a per-port `outputDir`

Four lanes run Playwright from one `web/` directory, and each run empties `web/test-results/`
under the others. W2's runs failed with `ENOENT .../test-results/.playwright-artifacts-N/...zip` while
another lane's run started. Wanted: ``outputDir: `test-results/${String(PORT)}` `` (the port is already
per lane).

Stand-in: W2 passes `--output /tmp/tether-meridian-501/w2/results`.

## 5. `web/AGENTS.md`: the `native/bridge.ts` line

W2 retargeted `tabs/driver.ts`, `tabs/input.ts` and `term/size.ts` and its test to
`platform/types.ts`. Nothing imports `native/bridge.ts` any more (only `lint/rules.test.ts` names the
path, inside a string). The line saying it is "kept only until W2 retargets" can say it waits for W5 to
move it, or W5 can delete the v1 types as it moves the file.
