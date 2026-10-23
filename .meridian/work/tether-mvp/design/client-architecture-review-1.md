# Review 1: client-architecture.md

Reviewed: `client-architecture.md` (status "design for review, 2026-10-23") at commit
`71c07a0`. I read it against the code in `web/`, xterm 6.0.0's source in
`web/node_modules/@xterm/xterm/src`, `plan.md` ("Reconnect"), `ios-shell.md`
("Keyboard geometry", "Focus", "The bridge", "Lifecycle"), `daemon-core.md` (§3.4,
§5.3, §6), `resource-limits.md` §3.6, `browser-auth.md` rev 4 and
`docs/design/client/` (contract, terminal-interaction-design, README). Design only: no
source exists yet, so the checks below are reading checks: quoted passages, code reads
and xterm source.

## Verdict

**Request changes.** The overall shape is sound: one Preact app, a Platform seam,
pure cores and kept protocol and reconnect code. Eight High findings each block a lane
from starting:

- The sizing rule breaks native.
- The native borrow model races the focus guard.
- The desktop key handler as described double-delivers keys.
- The dev workflow can't authenticate under auth rev 4.
- The lane plan can't work in one shared checkout.
- Touch gestures, scrolling and selection have no design.
- The service worker's navigation strategy undoes "update only on tap".
- The owned phone input's delete semantics can't be computed from an element that is
  emptied after every commit.

None of these means the approach is wrong. Each has a local fix.

---

## High

### H1. Sizing tmux "from the terminal box" breaks native and any in-flow keyboard UI

**Location.** §5.4, first bullet. §3.1 `term/size.ts` row.

**Problem.** In native, the terminal box shrinks with the keyboard, because native
resizes the web view to end above the keyboard (ios-shell "Keyboard geometry": "native
moves the web view's bottom edge to the top of the keyboard"). That is why today's
sizer uses `collapsedHeight` and never the live height (`web/term/size.ts`). A
`ResizeObserver` doesn't know why the box changed. The design's escape hatch, "a change
whose reason is `keyboard` never resizes tmux", then has two bad readings:

- The sizer ignores box changes while `keyboard` is true. A rotation with the keyboard
  up is then lost, or worse, measured from the shrunken box. ios-shell sends the
  collapsed safe area in every message for exactly this case.
- The sizer applies them. tmux then resizes on every keyboard show.

The same thing happens in the phone browser if anything that appears with the keyboard
takes layout space in the terminal screen: the draft editor "available while the
software keyboard is open" (§7.4), or a toolbar that isn't absolutely positioned. iOS
Safari's `innerHeight` also changes when its toolbars collapse, so `stableHeight =
innerHeight` isn't stable.

**Fix.** Make tmux size a function of a *stable* box, never the visible one:

- **Native:** rows come from `collapsedHeight − safe-area insets − chrome heights`, as
  today. Keep `TerminalSizer`'s geometry input and add only the desktop and browser
  variants.
- **Browser:** lay out the terminal container against a stable height, for example the
  root at `100svh` with the toolbar and draft editor as overlays that never take flow
  space while the keyboard is up. Measure that container.
- State the invariant in the spec: "the observed box excludes the keyboard and
  everything that appears with it". Add a probe line to §11: open the draft editor and
  check that tmux size is unchanged.

### H2. Native "borrow on pointer-down, release on blur" races the focus guard and raises the wrong keyboard

**Location.** §3.3 rule 3, §5.3 `borrow`/`release`, §5.9.

**Problem.**

- **The borrow arrives too late.** ios-shell's guard makes `canResignFirstResponder`
  return false in `terminal` and `hidden`, so WebKit can't take first responder. The
  spec therefore sends `focus webText` *when the surface opens, before the tap*. A
  `postMessage` sent on `pointerdown` is asynchronous: native may receive it after
  WebKit has already tried, and failed, to focus the field on the same touch. Then the
  keyboard doesn't come up and the user must tap twice.
- **Release raises the terminal keyboard.** `release` on blur maps to `focus terminal`
  (§3.3), so blurring Home's search raises the terminal keyboard while Home is on
  screen.
- **Two APIs for one state.** `setFocus` and `borrow`/`release` drive the same native
  focus mode through two calls.

**Fix.** Make the resting native focus mode a function of what is on screen, sent by
`app/focus.ts` on every destination or overlay change:

- Terminal destination with no overlay: `terminal` or `hidden`.
- Home, Files or any dialog: `webText`, with the guard down, so any field can take
  focus on the tap with no handshake.

Fold `borrow`/`release` into `setFocus(mode)` with `webText` added. Leaving a field
then changes nothing, and returning to Terminal sends `terminal`. Add "tap Home search
from Terminal with the keyboard up" to the G3 checklist.

### H3. The desktop `attachCustomKeyEventHandler` path double-delivers and leaks browser defaults

**Location.** §7.2, first and third bullets.

**Problem.** In xterm 6.0.0 (`CoreBrowserTerminal.ts:1021–1027`, `1139–1150`), a
handler that returns `false` on `keydown` makes xterm return early *without*
`preventDefault`.

- **Shift+Enter is sent twice.** The browser still fires `keypress` for Enter, and
  xterm's `_keyPress` calls the handler again. If the handler routes only `keydown`,
  xterm then sends `"\r"` through `triggerDataEvent`. Shift+Enter therefore sends the
  CSI-u bytes *and* a carriage return.
- **Tab and Shift-Tab move focus out of the terminal**, because the default action
  isn't cancelled.
- **F-keys trigger browser actions:** F5 reloads, F11 goes full screen, F12 opens
  devtools.
- **IME composition breaks.** The handler runs before `CompositionHelper.keydown`
  (line 1029). Routing arrows, Enter or Escape by name during composition steals the
  keys an IME uses to choose and commit candidates.

**Fix.** Specify the handler contract:

1. If `event.isComposing` or `keyCode === 229`, return `true` and route nothing.
2. For a key it routes: call `preventDefault()` on `keydown`, which suppresses
   `keypress` and `input`, and return `false` for that event *and* for the matching
   `keypress`/`keyup`.
3. Give an explicit F-key policy: send F1–F12 except those the browser reserves, or
   all of them, with the trade-off logged.

Add "Shift+Enter in `cat -v` shows exactly `^[[13;2u`" and "Japanese IME candidate
selection with arrows" to W2's checks.

### H4. The owned phone input's delete semantics can't be computed from an emptied element

**Location.** §7.3, "Commit-only semantics".

**Problem.** "After each commit the element is emptied", together with
"`deleteContentBackward` → `BSpace` (one per deleted character)", is self-defeating:

- With an empty element there is nothing to delete, so `getTargetRanges()` is empty
  and "per deleted character" has no source.
- Held backspace and word delete (`deleteWordBackward` → `C-w`) depend on platform text
  that no longer exists.
- `insertReplacementText` "sends `BSpace` × the replaced length". After emptying, the
  replaced text isn't in the element either.
- `insertFromPaste`, `insertFromDrop`, `insertFromYank`, `historyUndo` and
  `deleteContentForward` aren't mapped. If they aren't cancelled, they edit the element
  and nothing is sent, or they send through an unmapped path.

**Fix.** Keep a fixed sentinel in the element, for example two spaces with the caret
at the end, restored after each commit and *never* during composition. Then:

- A delete always has a target: one `BSpace` per `deleteContentBackward` event. The OS
  repeats the event for a held key.
- `deleteWordBackward` → `C-w`.
- `preventDefault` every `inputType` not in the mapping table.
- Paste reaches the capture `paste` listener (§7.5).

Put the full `inputType` → item table in the spec, including the "anything else:
cancel, send nothing" row. Whether iOS fires `beforeinput` on an empty textarea is
listed under Hypotheses. The sentinel removes the question either way.

### H5. "Development without a shim" can't authenticate under auth rev 4

**Location.** §5.10. §3.1 `vite.config.ts` row ("the dev proxy forwards Serve's headers
instead of inventing a login").

**Problem.** Rev 4 replaces header identity:

- The Vite proxy connects to the daemon's Unix socket as a local peer, and "as a local
  peer it can never use the node lane". It must present a native token (browser-auth.md
  ios-shell edits, line 769; §3.5 "Which process connected").
- "Forwarding Serve's headers" admits nothing: the daemon ignores `Tailscale-User-Login`
  for browsers and admits nodes only from tailscaled peers.
- The browser adapter's boot compares `/auth/info.browserOrigin` with
  `location.origin`. At `localhost:5173` it shows "Open tether at …" and opens no
  socket (§3.6).

So the browser adapter, unchanged, can't run against Vite, and W0 through W3 have no
development loop.

**Fix.** Choose one and write it into §5.10:

- **(a)** The proxy injects a native token server-side: `Authorization` on HTTP and an
  added `tether.auth.<token>` subprotocol on `/ws`. Vite's dev server answers
  `/auth/info` with `browserOrigin` set to its own origin. This touches only proxy
  code, not the adapter.
- **(b)** Develop against `vite build --watch` served by the daemon at the canonical
  origin through Serve, with no HMR.

(a) keeps HMR and keeps the adapter free of a dev mode. Log the choice in decisions.md.
Either way, the proxy must also refuse callers that didn't come through Serve (rev 4's
L5).

### H6. The lanes are not disjoint, and one checkout makes every lane's WIP block every push

**Location.** §10, the lanes table and "Shared-file rules".

**Problem.**

- **Unowned files every lane needs:**
  - `web/package.json` and `package-lock.json`: Playwright, an import-boundary lint
    plugin, a font-subset tool, possibly a service-worker build helper.
  - `web/index.html`: manifest link, `theme-color` and `apple-touch-icon` meta (W4);
    viewport meta and mount points (W0).
  - `web/tsconfig.json`: `include: **/*.ts` with `lib: DOM` type-checks `sw/sw.ts`
    against the wrong globals. The worker needs its own tsconfig with `WebWorker`.
  - `net/` (`host.ts` takes the transport, `hosts.ts` is new): no lane.
  - `proto/link.ts`: the token becomes optional, `kind: "web"` (M1); no lane.
  - `ui/hostProblem.ts`, `term/prompt.ts`: no lane.
  - `tests/fixtures/proto/keys.json`: W2's keymap adds names the Rust tests check.
  - The Playwright test directory and its fixtures.
  - `docs/design/decisions.md`, `browser-behaviors.md`, `CHANGELOG.md`: every lane
    writes them.
- **Inside W0's directories:**
  - `platform/browser/` is W0's, but W3 needs `uploads`, W2 and P3 need input and
    focus, and W4 owns `platform/browser/pwa.ts` inside it.
  - `workspace/status.ts` needs W2's `limit` copy.
  - `app/` (the controller that executes effects) must be extended by every screen
    lane: creation, upload, insert path, `draftInsert`.
- **Image paste has two owners.** §7.5 puts it in W2's terminal surface; the table
  gives it to W3.
- **One working tree.** `scripts/preflight.sh full` runs `tsc`, ESLint and Vitest over
  the *whole* tree, so one lane's half-written file fails another lane's pre-push.
  Plain `git add` also sweeps up another lane's files.
- **Daemon dependencies are missing from the DAG:**
  - W0's enrol screen and boot need `/auth/info.browserOrigin` and `/auth/node/*`
    (rev 4, unbuilt).
  - W2's "4th session refused" check needs resource-limits' `watchEnded { limit }`.
    `WatchEndReason` is `"detached" | "error"` in `proto/generated/messages.ts` today.
  - §7.4 needs L4's `pasted`.

**Fix.**

1. Give every shared file an owner. Simplest: W0 owns all repo-level config,
   `index.html`, `package.json`, `net/` and `proto/link.ts`, and lands every dependency
   any lane will need *before* the lanes fork.
2. Split `platform/browser/` into per-capability files, each owned by its consuming
   lane (`uploads.ts` W3, `input.ts` W2/P3, `pwa.ts` W4). Have W0 add the `app/`
   extension points (one effect handler per screen module) so lanes don't edit the
   controller.
3. Give image paste to one lane (W2, calling `platform.uploads.send`).
4. Add the daemon prerequisites (auth rev 4 routes, the `limit` reason, L4 `pasted`)
   as DAG nodes, with what each lane stubs until they land.
5. Add a working-tree rule: lanes keep the tree compiling at every save, commit with
   explicit pathspecs, and the lead serializes pushes. Otherwise, ask Jimmy for a
   worktree exception for this build.

### H7. Touch scrolling, selection, copy and tap-versus-gesture arbitration have no design

**Location.** Missing. Only §7.3 "a tap on the terminal … focus[es] the owned input
synchronously" touches it, and §6.5's `select` mode is never used.

**Problem.** The client README says "layout approval does not settle … touch gesture
implementation". terminal-interaction-design.md requires:

- one gesture owner (tap / long-press selection / scroll / `pointercancel`);
- a mouse-mode-aware tap that sends a remote click only after the gesture resolves;
- `touch-action` declared up front;
- a bounded selection snapshot for copy;
- scrollback through `history` requests.

The architecture has no module, Platform capability, lane or probe gate for any of
this, and native's `focus select` has no web caller. Worse, "every tap on the terminal
focuses the owned input" conflicts directly with gesture arbitration. A long-press to
select, or a drag to scroll, would raise the keyboard on touch-down.

**Fix.**

- Add a `term/gesture.ts` sans-IO recognizer (pointer events in; `tap | scroll(dy) |
  selectStart | …` out) and a `term/selection.ts` snapshot. Focus the input only on a
  resolved tap.
- Add a selection-mode route to `setFocus("select")`.
- Own it in W2 for scrolling, and in a gesture lane after W2 for selection and copy.
  Add the interaction-design gates to §11.
- If selection is deliberately out of the minimal pass, say so in §1, and still define
  tap versus scroll, because the keyboard behaviour depends on it.

### H8. Network-first navigation updates the page without the tap, and old pages lose lazy chunks

**Location.** §9.2, the navigation row and lazy-chunk rows. §9.3, step 4.

**Problem.**

- **Reload installs the new version.** Navigation goes to the network first. After a
  daemon upgrade, any reload or relaunch therefore gets the *new* `index.html`, which
  references assets outside the active worker's precache. These are fetched from the
  network, so the page runs the new version with no Update tap. This contradicts §1
  and §9.3 ("swaps versions only when Jimmy taps Update") and mixes a new page with an
  old worker.
- **Every launch on a weak link waits.** It waits up to 4 s before the cached shell
  shows, against "usable on spotty connections".
- **Old pages lose their lazy chunks.** The daemon embeds only the current build. An
  old page that first opens the Markdown or code viewer after the upgrade gets a 404
  for a chunk never cached "on first use", and the viewer fails.
- **Other tabs break on activation.** With two tether browser tabs open, Update in one
  calls `skipWaiting`. Activation deletes the old `tether-shell-*` cache under the
  other tab, whose lazy chunks then vanish.
- **Reload alone can't fix a protocol mismatch.** It never fetches the new worker
  unless `registration.update()` runs first.

**Fix.**

1. Serve navigations cache-first from the active worker's precache, with network only
   when nothing is cached. The worker version *is* the page version.
2. Precache every JS and CSS chunk of the build: the ≤ 1.5 MiB shell budget bounds it.
   Keep "cache on use" only for the lazily loaded Nerd symbols font and grammars if
   their size requires it, and have the page treat a failed dynamic import as "Update
   required".
3. Delete old caches only when no client still uses them: on activation, after
   `clients.matchAll()` shows no old-version clients, or on the next activation. On
   `controllerchange`, other tabs show "Reload to finish updating" and never reload
   themselves.
4. On a 4001 incompatible close, call `registration.update()` before offering Update.

---

## Medium

### M1. The transport interface can't be implemented as written on native, and the kept link can't do the browser's job

**Location.** §5.2. §3.1 rows `proto/` "Keep, unchanged", `net/host.ts` "Keep".

**Problem.**

- **Native.** `openSocket(…): Link | { refused }` is synchronous, but native's token
  comes from an async bridge request (`token { host }` → promise; ios-shell "The
  bridge"). `Host` calls `opts.open` synchronously and can't consume a `{ refused }`
  value.
- **The link.** `HostLink` requires `token` and always offers `tether.auth.<token>`
  (`web/proto/link.ts:52`), so `proto/` doesn't survive unchanged.
- **The browser.** §4 says the browser "opens `/ws` with no subprotocol". Rev 4 requires
  `tether.v1` to be offered on the node lane (`browser-auth.md` line 545), and the
  daemon answers `tether.v1` (`src/http/ws.rs:38`).

**Fix.** Make `openSocket` return a `Link` at once that internally awaits the token and
closes with a synthetic code (`locked`, `notEnrolled`) that `Host` maps to a halt, the
same path as 4401. In `HostLink`, make `token` optional and always offer `tether.v1`.
Mark `proto/link.ts` and `net/host.ts` "revise" and give them an owner (H6).

### M2. The admission model doesn't match auth rev 4, and rev 4's UI has no home

**Location.** §2 "admission", §4, §5.1 `enrol?`, §9.4, §3.1 `files/browser.ts`
("drops the Settings place").

**Problem.**

- **The routes already exist.** "The exact route and fields belong to auth rev 4" is
  stale: rev 4 names `GET /auth/info {hostId, name, daemonVersion, protocol,
  browserOrigin, browserRefused}`, `GET /auth/node/session`, `POST /auth/node/enroll
  {code, deviceName}` and `POST /auth/node/remove`.
- **States are missing from `Admission`:**
  - wrong origin ("Open tether at `<browserOrigin>`", §3.6);
  - `browserRefused` (`ambiguous_origin` …);
  - `node_refused` with its reason (§3.8);
  - `503 identity_unavailable` / close 4503, which keeps state and retries.
- **The enrol call is incomplete.** The enrol screen lacks rev 4's device-name field
  (prefilled with the node name) and its warning ("This lets every browser and app on
  <node> use tether"). `enrol?(code)` has no `deviceName`.
- **4401 needs a follow-up call.** Mid-session, rev 4 asks `/auth/node/session` *why*
  first, because the node may be refused rather than not enrolled.
- **Two actions have no screen.** "Remove this device" (D3) and "Clear local data"
  (§5.6, §7.4) have no screen, because Settings is dropped.
- **§9.4 is wrong.** "Safari and an installed PWA have … separate enrolments" is false
  under rev 4: an enrolled *node* admits every browser and the PWA on it. Storage is
  separate; enrolment is not.

**Fix.**

- Write `Admission` as `admitted | notEnrolled{nodeName} | nodeRefused{reason} |
  wrongOrigin{origin} | originRefused{reason} | identityUnavailable | unreachable`, and
  map each rev 4 status to it in a table.
- Change the call to `enrol(code, deviceName)`.
- Add `removeDevice()` to the browser Platform, and a minimal Settings overlay (Home
  overflow) holding "Remove this device", "Clear local data" and "Add to Home Screen".
- Correct §9.4.

### M3. Restore semantics leave tabs stuck or resize tmux to a default size

**Location.** §6.2.

**Problem.**

- **Input rules conflict.** Step 1 disables input on `restoring` tabs, while step 2
  binds the active tab's watch before the listing. Is input enabled once `watching`
  arrives? The text doesn't say. `watching` is itself proof that the daemon located
  that window.
- **A failed listing is never retried.** "Tabs stay `restoring` until one succeeds",
  but `HostSync.list()` drops a failed listing and lists again only on the next
  `linkUp` or `sessionsChanged` (`web/app/sync.ts:53–55`). A timed-out or `busy`
  listing on a live socket leaves every tab on "Checking…" indefinitely.
- **The first watch can carry a guessed size.** "Watch as soon as the socket is up"
  sends `TabDriver`'s `size()`, which is `DEFAULT_SIZE` 80×24 until the cell and box
  are measured (`term/size.ts:10`). That resizes Jimmy's real tmux window to 80×24 and
  then back. Today `main.tsx` waits for the font before creating the renderer.
- **Other servers get pruned.** plan.md says "the listing covers the `main` tmux server
  only, so it never prunes scratch tabs". Step 3, "closed otherwise", would prune any
  tab whose server isn't the listing's.

**Fix.**

- `watching` moves that tab to live and enables input. The listing decides only tabs
  still `restoring`.
- `HostSync` retries a failed listing with the host's backoff while any tab is
  `restoring`.
- The first `watch` waits for the first measured size (font loaded, box observed).
- Step 3 judges only tabs whose `server` is the listing's, or whose server is gone per
  plan.md's rule.

### M4. Paste has no size check, its refusals are invisible, and interception must stop propagation

**Location.** §7.4, §7.5, §6.4 ("`busy` retries soon and silently, as today").

**Problem.**

- **No size check.** A `paste` over 256 KiB gets `error { inputTooLarge }`, and a fifth
  concurrent paste gets `busy` (daemon-core §6). Both errors carry no `req`, and `Host`
  drops errors that carry no `req` (`net/host.ts:290`, "has nobody waiting on it"). A
  large clipboard paste therefore vanishes silently. "As today" is not true for paste:
  nothing retries it. The draft cap (64 KiB) is fine, but terminal paste has no cap.
- **L4 must cover refusals.** L4's `pasted { req }` must also make refusals carry
  `req`, or `failed` can never be shown. `Host.request`'s 5 s timeout would mark a
  256 KiB paste over a slow link as a timeout, which must be `uncertain`, not `failed`.
- **The capture listener must stop propagation.** xterm listens for `paste` on both its
  textarea and `term.element` (`CoreBrowserTerminal.ts:343–344`). The capture listener
  only stops xterm's own paste if it calls `stopPropagation()` and `preventDefault()`.
  The spec says only "before xterm's own handler".

**Fix.**

- Check UTF-8 size before sending: over 256 KiB shows "Too large to paste (N KiB; the
  limit is 256 KiB)". Never split a paste, because splitting breaks bracketing.
- Specify that `paste` and its refusals carry `req` in L4.
- Paste timeouts become `uncertain`.
- Write "capture phase, `stopPropagation` + `preventDefault`" into §7.5.

### M5. Focus from a gesture: effect timing, mount timing, and `<dialog>` autofocus

**Location.** §6.5, §3.3 rule 2, §8.2 `Dialog`/`Sheet`.

**Problem.**

- **Effects may run too late.** Focus requests are reducer effects executed by the
  controller. If the controller runs effects after a Preact render (`useEffect` runs
  after paint) or in a microtask chain, iOS doesn't raise the keyboard.
- **The element may not exist yet.** The owned input must already be mounted when the
  tap happens. A terminal surface mounted on navigation can't be focused in the same
  tap.
- **The picker raises the keyboard.** `showModal()` focuses the dialog's first
  focusable element. If that is the picker's `SearchField`, opening the picker inside
  the + tap raises the keyboard on iOS. The contract says "Search is not auto-focused
  on mobile".
- **Focus calls have no home.** Rule 2 allows `.focus()` only in `app/focus.ts` and
  `Dialog.tsx`. The owned input (`term/input/`), xterm's `term.focus()` (`term/`) and
  the browser adapter's `setFocus` all call `.focus()`.

**Fix.**

- Specify that focus effects run synchronously inside `dispatch`, in the event
  handler's call stack.
- The owned input and terminal surface are mounted once, outside routed screens, and
  hidden rather than unmounted.
- On `touch` density, dialogs set `autofocus` on the dialog element or close button,
  never a text field.
- Rule 2 lists the actual files that may call `.focus()`.

### M6. A width-only layout puts a landscape phone in the desktop layout

**Location.** §5.4 `layout: width ≥ 720 px → desktop`; §2.

**Problem.** An iPhone in landscape is about 844–932 px wide, so rotating switches to
the rail, the centred dialog picker and desktop Home, at touch density. If the
terminal screen is a different component tree per layout, xterm is disposed and
recreated, losing its buffer and costing a re-watch and snapshot.

**Fix.** Choose the layout from width *and* height, for example phone when `min(width,
height) < 600`. Require one persistent renderer instance that moves between layouts,
and never re-create it on a layout change.

### M7. Capabilities the Platform interface lacks

**Location.** §5.1, §5.8.

**Problem.**

- **Video.** Native plays it through `playVideo` (AVPlayer, ios-shell "Video"); the
  browser uses `<video src=/fs/raw>`. Files needs it.
- **Restart.** `onStuck` (§5.2) and Update need a restart (`recreateWebView` versus
  `location.reload()`), but the interface has none.
- **Live updates.** Native `hosts` and `lock` messages have no subscription, and
  `directInput` is "chosen again on a `pointer` media change" but sits only in the
  static `BootResult`.
- **Clipboard in native.** `navigator.clipboard.writeText` in WKWebView on the
  `tether-app://` scheme is unverified. ios-shell says native can write `UIPasteboard`
  without a gesture.

**Fix.**

- Add `playVideo(host, path)`, `restart(reason)`,
  `subscribeHosts`/`subscribeLock` (native; static in the browser) and
  `onDirectInputChange`.
- Route the native adapter's clipboard through the bridge, or add a probe to §11.

### M8. The "cores import no DOM" rule fails on modules the design keeps

**Location.** §3.2 dependency rules; `import/no-restricted-paths`.

**Problem.** These kept modules use the DOM:

- `files/code.ts` (`document.createElement`, a `DocumentFragment`);
- `files/markdown.ts` (DOMPurify);
- `tabs/driver.ts` (`atob`), `tabs/input.ts` (`TextEncoder`);
- `proto/link.ts` (`WebSocket`, `setInterval`);
- `ui/theme.ts` (canvas).

The rule as written is violated on day one. Also, `eslint-plugin-import` isn't
installed, and its ESLint 10 support should be checked.

**Fix.**

- Restate the rule as "no Preact, no `window`/`document` in `workspace/`, `sessions/`,
  `drafts/`, `tabs/`".
- Move `files/code.ts` and `files/markdown.ts` (DOM renderers) under `screens/files/`
  or a `files/render/` exempt from the rule.
- Allow `proto/link.ts` its `WebSocket`, or move socket creation into the transport.
- Enforce it with core ESLint's `no-restricted-imports` and `no-restricted-globals` in
  per-directory `files:` blocks, which need no plugin.

### M9. The browser's `onStuck` reload can loop on a weak link

**Location.** §5.2.

**Problem.** Two consecutive 5 s connect timeouts (`proto/link.ts:7`) trigger a page
reload. On a slow cellular link, real handshakes (TLS through Serve, then the upgrade)
can exceed 5 s repeatedly. Each reload re-fetches the navigation and loops, which is
the opposite of "every byte costs the user".

**Fix.** Allow at most one automatic reload per 10 minutes (a `sessionStorage`
timestamp). After that, halt with "Can't reach pop-os" and Retry.

### M10. The "browser-reserved shortcuts" list takes core terminal keys away on macOS

**Location.** §7.2, third bullet.

**Problem.** "No interception of Cmd/Ctrl+T, W, L, N, Tab" lumps the two modifiers
together. On macOS the browser's keys are Cmd+T/W/L/N, while Ctrl+W (delete word),
Ctrl+L (clear), Ctrl+N (next history) and Ctrl+T (transpose) are everyday shell keys
and must reach tmux.

**Fix.** Reserve `metaKey` combinations on macOS, and Ctrl+T/W/N (which browsers don't
deliver anyway) elsewhere. Ctrl+letter on macOS always goes to the terminal. Also state
Ctrl+V on Linux and Windows (xterm sends `^V`; the browser paste is Ctrl+Shift+V) and
the macOS Option-as-Meta choice (`macOptionIsMeta`).

### M11. Draft persistence: the debounce versus "already saved at `pagehide`", and native drafts unspecified

**Location.** §5.5 (last sentence), §5.6, §7.4.

**Problem.**

- **The debounce leaves a gap.** Drafts save "debounced 300 ms", yet §5.5 says "on
  `pagehide` … drafts are already saved, so nothing is written". iOS can suspend the
  page inside that window.
- **Native drafts have no spec.** "Native's compose field owns drafts" with "the same
  semantics" leaves undefined:
  - per-tab-key storage, when native "doesn't know about tabs" (ios-shell);
  - the 64 KiB and 32-draft caps, and eviction;
  - survival across `recreateWebView`.
- **Eviction can run out of candidates.** Past 32 drafts, it evicts only drafts of
  windows with no open tab, which is undefined when all 32 have open tabs.

**Fix.**

- Flush pending draft and workspace writes on `visibilitychange → hidden`, and correct
  §5.5.
- For native, have the web own drafts in both platforms (`DraftStore` over the bridge,
  which persists to native storage). Native compose then reads and writes through it,
  and one rule set serves both. Otherwise, write native's rules out.
- Define the full case: refuse a new draft with a message.

---

## Low

- **L1. `term/prompt.ts` (`PromptTracker`) becomes dead code.** Its only consumer is
  `app/app.ts`'s suggestion strip (`grep`: `app/app.ts`, `term/index.ts`,
  `term/xterm.ts`). Fix: delete it with `complete/`, and drop `onPromptLine` from
  `TerminalRenderer`.
- **L2. "Protocol range" isn't on the wire.** `welcome` and `/auth/info` carry a single
  `protocol`; the range arrives only in `incompatible { min, max }` before close 4001
  (`proto/generated/messages.ts:45–46`). Fix: say "a 4001 close or an `/auth/info`
  protocol outside the client's range".
- **L3. The `platform/test` string check proves nothing.** Minified Vite output contains
  no module paths. Fix: a Rollup plugin, or a check of the build's `manifest.json`
  module graph, that fails if any module id is under `platform/test/` or `harness/`.
- **L4. The router has two homes for phone Files.** `#/files` versus `homePane:
  "files"`. Also, closing an overlay by an action (picking a window) must
  `history.back()`, which is async `popstate`, before the tab switch's `replaceState`,
  or the two race. Fix: one representation (`#/files` means Home's Files pane on phone),
  and the controller defers the `replaceState` until `popstate`.
- **L5. The workspace's `watch`/`unwatch` effects duplicate `TabDriver`'s own watch
  state** (`watchIfReady`, `cover`/`uncover`). Fix: the reducer emits only "tab on
  screen" (`cover`/`uncover` per tab). Also state whether the active tab stays watched
  on Home or Files. It shouldn't: unwatching returns tmux its size.
- **L6. `TabKey.window` is typed `string`; `WindowRef.window` is a `number`.** Fix:
  derive the key from `WindowRef`.
- **L7. `uploads.pick` can hang.** It must call `input.click()` synchronously in the
  tap; an async generator that starts on the first `next()` is fragile. It must handle
  the file input's `cancel` event, or the iterable never ends. There is no
  `AbortSignal`. Fix: `pick(host, signal)` returns synchronously after `click()`, and
  `cancel` ends the iteration.
- **L8. The font budget may not fit.** A Nerd Font symbols file is roughly 1 MB of
  WOFF2, which gzip can't shrink. Against "whole shell ≤ 1.5 MiB gz" that leaves
  little room. Fix: subset the fallback to the glyph ranges Jimmy's prompt and status
  line use, measured in W0, and commit the subset files with the script that made them,
  so the build needs no Python.
- **L9. Dragging a desktop window resizes tmux repeatedly.** The `ResizeObserver`
  sends a tmux `resize` for every cell-count change. Fix: apply only the trailing size,
  about 150 ms after the last change.
- **L10. Home with zero tabs gets no live updates.** No `TabPort` holds the socket, so
  each Home entry pays a WebSocket handshake plus a whois for one listing, then closes
  (`Host.closeIfUnused`), and `sessionsChanged` never arrives. Fix: either accept it
  and say so, or have visible Home join the host. The second costs one of the 3
  sockets.
- **L11. The `index.html` viewport has `maximum-scale=1, user-scalable=no`**, while
  §5.4 reasons about pinch zoom. Fix: decide whether zoom is allowed, and add
  `interactive-widget=resizes-visual` for Android Chrome.

---

## Hypotheses (not verified)

- **iOS and an empty textarea.** iOS Safari may not fire `beforeinput` (or `keydown`
  with a usable `key`) for Backspace in an empty textarea. H4's sentinel fix stands
  either way. Blocked on a real device.
- **Native clipboard.** Whether `navigator.clipboard.writeText` works in WKWebView on
  a `WKURLSchemeHandler` custom scheme, which WebKit may not treat as a secure context
  for the Clipboard API. Blocked on a Simulator or device.
- **Bridge timing.** Whether WebKit's tap-to-focus on iOS 26 runs before a `pointerdown`
  bridge message reaches `FocusController` (H2). I reasoned from the asynchronous
  bridge; it needs a device probe. The fix (destination-driven `webText`) avoids the
  race either way.
- **iOS 26 Safari toolbars.** How far `innerHeight` changes when the compact toolbar
  collapses. This decides whether `100svh` (H1) is needed or only advisable. Blocked on
  a device.
- **Font size.** The Nerd symbols WOFF2 size (L8) is an estimate; I didn't measure a
  symbols-only subset.

## Checks performed

- **xterm 6.0.0 source.** `_keyDown`, `_keyPress` and `_inputEvent` in
  `CoreBrowserTerminal.ts:1021–1210`; the paste listeners at 342–344 and
  `handlePasteEvent` in `Clipboard.ts:43–56` (H3, M4).
- **Kept code.**
  - `web/net/host.ts`: drops errors with no `req`; `open` is synchronous.
  - `web/proto/link.ts`: token required; subprotocols.
  - `web/app/sync.ts`: no retry.
  - `web/term/size.ts`: `DEFAULT_SIZE`, `collapsedHeight`.
  - `web/tabs/driver.ts`, `web/files/*.ts`: DOM use.
  - `src/http/ws.rs:38`.
- **Shared files.** `web/package.json`, `tsconfig.json`, `index.html`,
  `eslint.config.js`, `vite.config.ts` and `scripts/preflight.sh` (whole-tree
  `npm run check`).
- **Spec passages.**
  - browser-auth rev 4: §3.5 (local peer), §3.6 (`browserOrigin`), §3.8 (statuses),
    §3.9 (enrol body), §3.14 (`/ws` offers `tether.v1`), D2 (a node admits every
    browser and the PWA).
  - ios-shell: "Keyboard geometry", "Focus" (borrow before the tap; the guard),
    "The bridge" (async `token`).
  - plan.md "Reconnect" (scratch servers aren't pruned).
  - daemon-core §6 (paste 256 KiB, 4 slots).
  - The contract (no search autofocus on mobile).
  - client README (touch gestures unsettled).
