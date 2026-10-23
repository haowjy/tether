# Review 3: client-architecture.md, revision 3

Reviewed: `client-architecture.md` revision 3, as committed in `a24ba4d` (`main` at `6798ad4`). Read against reviews 1, 2 and the alignment review; against
`browser-auth.md` rev 4 (§3.8, §3.14, static shell), `resource-limits.md` (shell slots), the
build plan, and the code in `web/` (`net/host.ts`, `tabs/driver.ts`, `tabs/connection.ts`,
`app/hosts.ts`, `app/sync.ts`, `files/browser.ts`, `files/code.ts`, `term/*`, `native/bridge.ts`,
`ui/store.ts`, `eslint.config.js`, `vite.config.ts`), `scripts/preflight.sh` and
`.githooks/pre-push`. This round's lens is the one the brief asked for: would another developer
want to build on this? Module boundaries, state ownership, the adapter's shape, the lane plan.

## Verdict

**Request changes. Not frame-rot.** The frame is right: keep the UI-free core, put the
environment behind one adapter, use owned primitives on native HTML, give the touch input one
owner, and size tmux from a stable box. Revision 3 applied every review-2 fix locally. Twelve of
thirteen hold. The thirteenth, N3 (the service worker across versions), is still wrong, for the
third round running.

What's left is structural, and most of it is resolved by deleting things:

1. **Duplicate state owners.** Two modules fetch the sessions listing on the same triggers. Two
   modules hold the Files position. Overlays live in both `history.state` and the reducer.
   (F2, F3)
2. **Mechanisms that buy nothing, or sit in the wrong layer.**
   - The update roll call protects nothing (F1).
   - The adapter carries admission logic that is daemon protocol, not environment (F4).
   - The adapter has five different change channels (F4).
   - `platform/browser/focus.ts` is a second DOM focus owner in the browser (F7).
3. **The lane plan's guarantees are weaker than stated.**
   - Pre-push runs preflight on the working tree, so the commits being pushed are never checked
     as committed (F5).
   - Disjoint directories still leave shared hot spots (F6).

Recurring concerns are F1 (R1 H8 → R2 N3 → now), F6 (R1 H6 → R2 N9 → now) and F8 (R1 H1 → R2
N1 → now). Each recurrence has the same cause: a mechanism is patched where it should be
deleted. The fix direction given for each makes the deleting move.

## Answers to the brief's questions, in one line each

| Question | Answer |
|---|---|
| Module boundaries | Sound at the top level (cores, `platform/`, `screens/`, `ui/`). Weak at `workspace/`: it is called pure, yet it holds `HostSync` (timers, I/O) and the Files and overlay state that other modules also hold (F2, F3) |
| Platform adapter | The right shape: one capability port per environment concern, and most ports are deep. Three things erode it: logic that isn't environment-specific (admission mapping, draft revision checks), five change channels, and browser-only optional methods plus a `kind` field that invites `if (native)` branches. It is also missing one capability, updates (F4) |
| State ownership | The listing, the Files position and overlays each have two owners (F2, F3). Lifecycle flushes are spread across `net/hosts.ts`, the transport and `pwa.ts` (F9) |
| Owned primitives vs a library | **Agree.** About 18 small widgets, none of them a combobox, grid or menu, behind an axe and keyboard suite. Two notes: `Sheet` can be a variant of `Dialog`, and the token-tier rule as written forbids screens the spacing scale (F11) |
| Lint rules | Leaky. `no-restricted-globals` misses `window.navigator`, `globalThis.indexedDB`, `window.matchMedia`, destructuring and `document.visibilityState`; probed (F7) |
| Bundle budget | Credible. Today is 2.49 MiB gzipped (5.1 MB raw), so the "5.1 MB vs 3 MiB" comparison mixes units. The 1.5 MiB / 64-file target fits the allowlist with room to spare (F12) |
| Phone input path | The owned input and the recognizer are well specified. The remaining structural gap is lane-level: P3 needs changes in W2's `term/` and `tabs/keymap.ts` (F6) |
| PWA update flow | The roll call is a mechanism with nothing to protect and a counting bug. Cache cleanup across versions is still unreliable. The real cross-version hazard, an IndexedDB schema upgrade, is not addressed (F1) |
| Disjoint lanes in one checkout | Disjoint directories, yes. Disjoint change surfaces and verified commits, no (F5, F6) |

## Review-2 fixes

| R2 finding | Status | Evidence |
|---|---|---|
| N1 phone rows under toolbar/keyboard | Held | §5.4: the toolbar has a resting slot in flow, `cursorPan` reads the pan area, and detection follows `owned`. New gap in the `Viewport` type: F8 |
| N2 precache burst | Held | §9.2: registers after `load`, keeps 4 requests in flight, bounds its `503` retries, and copies unchanged assets |
| N3 cross-version SW | **Not held** | `clients.matchAll` from a waiting worker returns no windows, and in-memory hash reports don't survive worker restarts (F1) |
| N4 native draft rules | Held, with a small residue | `draftEdit`/`draftChanged` were added. Who compares `baseRevision` for native `draftPut` is unstated (F13) |
| N5 owned-input gaps | Held (text) | The composition row, the replacement policy, Ctrl/Alt from `keydown`, and the gate row |
| N6 F6 | Held | §7.2 routes F1–F4 and F7–F10 |
| N7 copy keys | Held | A capture-phase `copy` listener; Ctrl+Shift+C |
| N8 `theme.ts` | Held | `Viewport.scheme` |
| N9 unowned files | Held for the files listed. New cross-lane surfaces: F6 |
| N10 two visible windows | Held | `document.hasFocus()` |
| N11 key names | Held | |
| N12 touch details | Held | |
| N13 `hello.client.kind` | Held | §3.1 `proto/link.ts` row |

## Findings

### High

**F1. The update roll call protects nothing, and its counting is broken. Cache cleanup across
versions still deletes caches that live pages use.** *(A recurring class: R1 H8, R2 N3, and
now. Each round patched the mechanism, and each patch added state. The fix deletes the
mechanism.)*

- *Where.* §9.2 "Caches"; §9.3 step 4.
- *Problem.*
  1. **The roll call guards nothing.** After `skipWaiting`, only the tapping page reloads.
     Every other page keeps running with its old assets, its IndexedDB connection and its IME
     state, and shows "Reload to finish updating". Activation doesn't touch a page's drafts or
     composition, so asking other pages to "flush drafts and reply `ready`", waiting out a
     composition, and the 5 s timeout protect nothing. They add a cross-version message
     protocol on `BroadcastChannel`, which every future build must keep understanding.
  2. **The count is zero.** `clients.matchAll({ type: "window" })` without
     `includeUncontrolled: true` returns only the clients the calling worker controls. A
     *waiting* worker controls none, so the expected reply count is 0. The tapping page
     proceeds immediately, which the roll call was meant to prevent.
  3. **Cleanup deletes live caches.** Pages report their build hash to the worker, and the
     worker deletes "caches whose hash no live window client has reported". Those reports
     live in worker memory. At activation, the new worker has received no reports yet. Later,
     the browser terminates idle workers (after about 30 s), and the reports go with them.
     **Scenario:** window A runs build h1 after an update and shows "Reload to finish". The
     worker restarts. Window B, on h2, posts h2. The worker deletes `tether-shell-h1`. A then
     opens a Markdown file, the lazy chunk misses in every cache, and A shows "Update
     required".
  4. **The real hazard goes unaddressed.** A new build that bumps the IndexedDB schema
     (`tether` v1 → v2) opens the database while old pages hold v1 connections. The upgrade
     is `blocked` until those pages close their connections. Nothing in §5.6 or §9 handles
     `versionchange`.
- *Check.* I read §9.3 step 4 and §9.2 against the Service Worker spec. `Clients.matchAll`
  includes uncontrolled clients only with `includeUncontrolled`. Workers are stateless across
  termination. Activation doesn't unload controlled pages. §5.6 says "schema version 1" and
  never mentions `versionchange`.
- *Fix (deletion).*
  - **Update.** Drop the roll call, the `update` and `ready` messages, the composition wait
    and the 5 s timeout. The tapping page flushes its own drafts, calls `skipWaiting`, and
    reloads on `controllerchange`. Other pages show "Reload to finish updating", as they do
    now.
  - **Cleanup.** Drop build-hash reporting and per-client version tracking. Use one rule: on
    `activate`, keep the new cache and the one it replaced, and delete older
    `tether-shell-*` caches. A page two builds behind already has a designed outcome: a lazy
    chunk miss shows "Update required". Alternatively, a single asset cache with pruning by
    the current and previous precache lists removes the cross-cache copy step too.
  - **IndexedDB.** Add one rule to §5.6: every page handles `versionchange` by flushing,
    closing the database, and showing "Reload to finish updating".

**F2. Two modules fetch the sessions listing on the same triggers, and `workspace/` is not
pure.** *(One-off. The fix leaves one listing owner.)*

- *Where.* §3.1 `app/sync.ts` row; §3.2 `workspace/ … sync.ts (HostSync)`; §6.2 step 4; §6.3
  "When it fetches".
- *Problem.*
  - **Two fetchers.** `HostSync` (kept, moved to `workspace/sync.ts`) lists on every `linkUp`
    and on a debounced `sessionsChanged` (`app/sync.ts:31–39`). `sessions/` fetches on "every
    socket `linkUp`" and "a `sessionsChanged` hint, debounced 300 ms". Every reconnect and
    every tmux change therefore costs two `listSessions` round trips on a weak link. That is
    a cost paid per event on the network path the principles single out.
  - **Two caches.** Pruning (§6.2) acts on `HostSync`'s listing while Home renders the
    `sessions/` cache, so the two can disagree for a round trip.
  - **Not pure.** `HostSync` owns timers and joins `Host` as a `TabPort`. Placing it in
    `workspace/` breaks §6.1 ("`workspace/` is a pure reducer") and blurs lint rule 5's
    sans-IO line.
- *Check.* Quotes: §3.1 "Lists on connect and on a debounced `sessionsChanged`, and prunes";
  §6.3 "every socket `linkUp`; a `sessionsChanged` hint, debounced 300 ms". Code:
  `app/sync.ts` arms `setTimeout` and calls `host.request`.
- *Fix.* Keep one listing fetcher, beside `sessions/` on the I/O side (an `app/` effect
  runner, or `net/`). It feeds the pure `sessions/` cache, and the same result reaches the
  workspace reducer as its existing `listing` event, which drives pruning. `HostSync`'s
  rename routing becomes a `renamed` event on the same path. Delete `workspace/sync.ts`. The
  retry-while-`restoring` rule moves to the fetcher.

### Medium

**F3. Files position and overlays each have two owners.** *(The same class as F2: state is
copied instead of owned.)*

- *Where.* §3.1 `files/browser.ts` "Keep … navigation state"; §6.1
  `files: { folders, preview }`; §6.6 "Overlays and the Files position live in
  `history.state` and the workspace".
- *Problem.*
  - **Files position.** `FileBrowser` already holds `place` (`roots | dir | file`,
    `files/browser.ts:17–22`) and is kept. The workspace adds a second copy,
    `files.folders` and `files.preview`.
  - **Overlays.** They live in `history.state` and in the reducer.
  - **The symptom.** §6.6's ordering rule ("applies the tab switch only after the resulting
    `popstate`") exists because two stores must be kept in step. Every new overlay or Files
    step means a write to both, and the bug class is "they disagree after Back".
- *Check.* Read `files/browser.ts`, §6.1 and §6.6.
- *Fix.* Give each piece one owner and one direction.
  - `history.state` is the navigation stack (overlay, folder, preview), and the reducer
    receives it only as `navigated`.
  - `FileBrowser` is the only holder of the Files place. It is seeded from the saved
    workspace on boot and saved through it.
  - Drop `files` and `overlay` from `WorkspaceState`, or derive them from the stack. Either
    way they are never written independently.

**F4. The `Platform` interface is the right shape, but it holds daemon-protocol logic, five
change channels, and browser-only escape hatches. It also lacks the update capability that W4
needs.** *(A class: concerns that aren't environment-specific drift into the adapter. The fix
moves them out.)*

- *Where.* §5.1, §5.9, §4.1–4.3, §9.3.
- *Problem.*
  - **Admission is protocol, not environment.** The browser adapter's `boot`, `enrol` and
    `removeDevice` do three things: `/auth/info` and `/auth/node/session` calls, the origin
    comparison, and the mapping to `Admission`. The 4401 recheck and the `deciding` backoff
    need the `Host`'s backoff and its close codes, which live in `net/host.ts`
    (`onRejected`). Admission is therefore split across `platform/browser/boot.ts`, the
    transport, `net/host.ts` and a `PlatformChange`. The harness replaces all of it with
    fixtures, so the real mapping is never unit-tested.
  - **Five change channels.** `subscribe(PlatformChange)`, an undefined `ViewportSource`,
    `lifecycle.subscribe`, `input.onInput` and `drafts.onChange`. Some of their contents
    belong elsewhere:
    - `lock` is lifecycle. `HostRegistry.apply` already runs sockets on
      `active && !locked`.
    - `directInput` is the pointer, the same media query as `density`, so it belongs in
      `Viewport`.
    - `admission` belongs to the host.
  - **Escape hatches.** `enrol?` and `removeDevice?` are optional, and `kind` is exposed.
    Settings, the host banner and the problem copy will branch on `platform.kind`, the
    `if (native)` pattern decision 2 rejects.
  - **The missing capability.** Nothing in `Platform` or `PlatformChange` lets a screen learn
    "Update ready" or ask for the update. The Home banner (W1, screens) can't import
    `platform/browser/pwa.ts` (rule 4). §4.1's protocol-mismatch Update needs
    `registration.update()`, and `restart("update")` doesn't cover it. W4 owns `pwa.ts` but
    not `types.ts`, so W4 can't add the capability itself.
- *Check.* I read §5.1 against §4.2, §9.3 and rule 4. `PlatformChange` has `hosts`, `lock`,
  `admission` and `directInput`, and no update. `ViewportSource`, `HapticKind` and
  `Admission` are named but never defined.
- *Fix.*
  - **Admission.** Move it into `net/admission.ts`: a pure `(authInfo, sessionReply,
    pageOrigin) → Admission`, plus a per-host admission state in `net/hosts.ts`. The browser
    supplies `location.origin` and `httpBase`. Native supplies the token reply
    (`notEnrolled`, `locked`). `enrol` and `removeDevice` become two POSTs through
    `httpBase`, and both leave `Platform`.
  - **Change channels.** Fold `lock` into `LifecycleSource` and `directInput` into
    `Viewport`. Admission leaves `PlatformChange`, which then carries only `hosts`.
  - **Updates.** Add `updates?: { state, subscribe, check(), apply() }`. That is the one
    browser-only capability, and its presence replaces `kind` checks. Do the same for
    `installPrompt`, and drop `kind` from the public interface.
  - **Types.** Define the named types in §5.1, since W0 freezes `types.ts` for every lane.

**F5. Pre-push runs preflight on the working tree, so the commits being pushed are never
checked as committed.** *(One-off for the lane plan, but it voids the repo's main gate.)*

- *Where.* §11 "Working in one tree"; `scripts/preflight.sh`; `.githooks/pre-push`.
- *Problem.*
  - **What the hook checks.** It runs `scripts/preflight.sh full` in `$ROOT_DIR`, which is
    the working tree, including every other lane's uncommitted files.
  - **What §11 adds.** Lanes commit with explicit pathspecs.
  - **The result.** A W1 commit that imports a W0 helper, still uncommitted in the tree,
    passes preflight and lands a `main` that doesn't build. In the other direction, a clean
    commit is blocked by another lane's half-saved file. §11 sees only the second case.
  - **The cost.** Each push also reruns `cargo clippy`, `cargo test` and the release build
    while daemon lanes edit `src/`. The commits on `main` are not bisectable, which defeats
    AGENTS.md's "`scripts/preflight.sh full` passes before every push".
- *Check.* `pre-push` ends with `exec "$ROOT_DIR/scripts/preflight.sh" full` with no
  checkout of `$local_sha`. `preflight.sh` does `cd "$ROOT_DIR"` and runs the checks there.
- *Fix.* Pick one and state it in §11:
  - (a) The lead's push verifies a clean export of the commit being pushed:
    `git archive <sha> | tar -x -C $tmp`, with `node_modules` linked in, then preflight in
    `$tmp`. That is a disposable check directory, not a lane worktree.
  - (b) Each commit lands only from a tree where `git status --porcelain` outside the lane's
    paths is empty, which serializes lanes.

  (a) keeps parallel lanes honest. Make it the default in `preflight.sh` (a `--commit <sha>`
  mode) rather than a lead habit.

**F6. Disjoint directories, shared change surfaces.** *(Recurring: R1 H6, R2 N9. Each round
listed more files. The remaining overlap is in what lanes must change, not in which files they
are allowed to write.)*

- *Where.* §11 ownership table; §3.2.
- *Problem.* Each of these is owned by one lane and must change for another:
  - **`workspace/` (W0).** It carries W2's `limited` event, W3's Files position (F3), W1's
    overlay kinds (the `Overlay` union is closed), and the `focus owner` field every screen
    sets. A new overlay or event means a request to the W0 writer.
  - **`harness/` (W0).** Every lane's Playwright needs its own fixtures there: a fake host
    sending `limit`, scripted uploads, admission states.
  - **`vite.config.ts` and `index.html` (W0).** These carry W4's service-worker entry, the
    precache-list generation, and the manifest link and `theme-color` meta, all things W4
    iterates on.
  - **`term/` and `tabs/keymap.ts` (W2).** P3a needs owned-mode keymap rules (Ctrl/Alt
    printable) and the pan area with the draft editor. P3b needs buffer text, mouse mode and
    cell geometry from the renderer, which only `term/` may touch (rule 4).
  - **Timing.** W5 runs in parallel after W0, while the build plan sequences native as P4
    after P3.
- *Check.* Cross-read the §11 Owns column against §6.1, §6.4, §7.3, §7.6, §9 and rule 4, and
  against `build-plan.md` lines 53–58.
- *Fix.*
  - Shrink `workspace/` to tabs and active (F3), so lanes extend their own state.
  - Give each lane `harness/<lane>/` fixtures, registered from a W0-owned index of stubs.
  - Have W0 create `sw/vite-plugin.ts` (owned by W4), which `vite.config.ts` imports.
  - W2 delivers the renderer API P3 needs. Name it now: `bufferText(rows)`, `mouseMode()`,
    `cellAt(x, y)`, and `setPanArea(px)`. W2 also delivers the owned-mode keymap branch.
  - Align W5 with the build plan, or update the plan.

**F7. The lint rules leak, and the browser has two DOM focus owners.** *(One-off.)*

- *Where.* §3.3 rules 2 and 3; §5.3; §3.2 `platform/browser/focus.ts`.
- *Problem.*
  - **Rule 3 misses member access.** It names only `no-restricted-globals` for member-style
    APIs. I probed ESLint 10 with `no-restricted-globals` on `navigator`, `indexedDB`,
    `matchMedia` and `visualViewport`. Only bare `navigator.clipboard` was flagged. These
    passed: `window.navigator.clipboard`, `globalThis.indexedDB.open()`,
    `window.matchMedia()`, `const { visualViewport } = window`,
    `document.visibilityState` and `window.webkit`.
  - **Rule 1 has no exemption for uploads.** `platform/browser/uploads.ts` creates an
    `<input type="file">` (§5.7), but rule 1 doesn't exempt it.
  - **Two DOM focus owners.** Rule 2 allows `.focus()` in both `app/focus.ts` and
    `platform/browser/focus.ts`. §6.5 says focus effects run synchronously in `app/focus.ts`,
    so the browser's `setFocus` has nothing left to do. Two files moving DOM focus is two
    focus controllers, which §6.5 forbids.
- *Check.* Scratch probe in `/tmp/rv3probe` with web's ESLint: one error, on line 1 only.
- *Fix.*
  - Add `no-restricted-properties` (`window`/`globalThis`/`self` × each name, and
    `document.visibilityState`/`hasFocus`).
  - Add a `no-restricted-syntax` selector for `MemberExpression[property.name='webkit']`
    and for destructuring from `window`.
  - Seed each with a violation in W0's tests.
  - Exempt `platform/browser/uploads.ts` from rule 1.
  - Make the browser `setFocus` a no-op, and delete `platform/browser/focus.ts` from §3.2,
    rule 2 and W0's list.

**F8. The sizer still has three paths, and the new `Viewport` lost `width`.** *(Recurring with
R1 H1 and R2 N1. The fix lets the per-environment difference live only in the adapter.)*

- *Where.* §3.1 `term/size.ts` "three ways to produce the stable box"; §5.4 `Viewport`.
- *Problem.*
  - **No width.** `TerminalSizer` today needs `viewport.width` (`term/size.ts:78`). The new
    `Viewport` has `visibleHeight`, `stableHeight` and `safeArea`, but no width. Layout's
    `min(width, height)` needs it too.
  - **Branching in `term/`.** The adapter already computes `stableHeight` per environment
    (native: `collapsedHeight`). Yet `size.ts` keeps one branch per environment, plus a
    `ResizeObserver` path for the browser.
  - **`reason` exists only for the sizer.** Its job is to ignore `keyboard` events, and an
    unchanged `stableHeight` already does that.
- *Fix.*
  - Add `width`.
  - Make the sizer one formula: `(width − horizontal insets, stableHeight − vertical insets −
    measured chrome)` from `Viewport`, recomputed whenever those inputs change. The browser
    adapter defines `stableHeight` as its `100svh` root minus the toolbar slot, or the
    container on desktop.
  - Delete `reason`, and delete the per-environment branches in `size.ts`.

### Low

- **F9. Lifecycle flushing has three owners, one in the wrong layer.** §5.5 has `net/hosts.ts`
  "flush pending draft and workspace writes", which means `net/` importing persistence. §5.2
  has the transport's `onStuck` flush drafts before reloading, and §9.3 has `pwa.ts` do it.
  *Fix:* one `app/` function, "persist now", called by the controller on hidden, before
  restart and before update. `net/hosts.ts` only closes sockets.
- **F10. "Overlay" names two concepts.** §2 defines an overlay as a modal surface (the
  picker, a dialog, Settings). The §8.2 primitive `Overlay` is a status band over the
  terminal, and §6.4 says "the terminal overlay shows the daemon's message". *Fix:* rename
  the primitive `StatusBand` and fix §6.4's wording.
- **F11. The token rule forbids screens the spacing scale, and nothing enforces it.** §8.3
  says "Screens read only semantic tokens". The spacing, radius and type scales are
  primitive-tier, and the semantic tier offers only `--space-gutter`, `--size-target`,
  `--text-body` and `--text-meta`. Screens will either alias every step or break the rule,
  and no CSS lint exists. The spec also never names how screen CSS is scoped, though five
  lanes write CSS at once. *Fix:* scope the rule to colour (screens never read `--gray-*`,
  `--green-*` and the other colour scales), allow the space, radius and type scales
  directly, and add a preflight grep for the colour case. Choose Vite's built-in CSS modules
  (`*.module.css` beside each screen) in W0. Make `Sheet` a `Dialog` variant rather than a
  primitive.
- **F12. The budget statement mixes units.** "Today's build is 5.1 MB" is raw. Gzipped it is
  2.49 MiB (2,614,021 bytes across 52 files), already within 0.5 MiB of the 3 MiB cap. Vite
  emits re-export stub files (13 of today's 52 are 44-byte stubs such as `cpp-DzjeI0uH.js`),
  and they count toward the 64-file target. *Fix:* quote the gzipped figure, and count stubs
  in the file budget, or set `output.inlineDynamicImports`/`manualChunks` so the stubs
  disappear.
- **F13. Native `draftPut`'s revision check has no stated home.** `DraftStore.put(record,
  baseRevision)` returns `conflict`, and "Swift holds no draft rules". *Fix:* the native
  adapter compares revisions in JS against its cached record before `draftPut`. Native has
  one page, so that is safe. Say so in §5.6.
- **F14. Screen `effects.ts` hooks are indirection for the lane plan.** §3.2 gives each screen
  an `effects.ts` "so a lane can add effects without editing `app/`". No effect type, emitter
  or registration contract is given, and the mechanism outlives the build. *Fix:* define the
  contract in one paragraph (effect union per screen, controller dispatches by tag). Or drop
  it, and let screens call their own cores and platform capabilities through a context
  provided by `app/`.

## Hot paths

- **Listing.** It is fetched twice per reconnect and per tmux change (F2). Once fixed, it is
  one request per event, with no timer.
- **`visualViewport` resize and scroll.** These fire every frame during the keyboard
  animation. The keyboard test and the pan are O(1) per event, and the sizer is
  debounced 150 ms. Fine.
- **Draft persistence.** A 300 ms debounce, one record per write. On native, every edit is
  two bridge hops (`draftEdit` → `draftPut`), which is acceptable at 300 ms.
- **Service worker update.** It downloads only changed assets (R2 N2 fix). Fine.

## Hypotheses (not verified)

- **Preact 11 support for Radix, React Aria and Ariakit.** I took p36's finding as given. It
  doesn't change the verdict, because the owned set is small either way.
- **Focus in `pointerup` raising the iOS keyboard.** Already a G3 gate row. Not probed: no
  device.
- **Firing of `versionchange` across Safari and the installed PWA.** These have separate
  storage partitions on iOS, so it likely affects only same-context windows. Not probed.
