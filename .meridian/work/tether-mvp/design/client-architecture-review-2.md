# Review 2: client-architecture.md, revision 2

Reviewed: `client-architecture.md` revision 2 (untracked, on `main` at `71c07a0`), against
[review 1](client-architecture-review-1.md) and the
[alignment review](client-architecture-review-alignment.md). Sources read: `web/` (`term/size.ts`,
`term/xterm.ts`, `ui/theme.ts`, `proto/link.ts`, `files/code.ts`, the current `dist/`),
xterm 6.0.0 (`CoreBrowserTerminal.ts`, `Keyboard.ts`), `ios-shell.md` ("Keyboard", "Focus",
"Keyboard geometry", "The bridge"), `daemon-core.md` §3.4 key-name regex,
`tests/fixtures/proto/keys.json`, `browser-auth.md` rev 4 (§3.6–3.8, §3.14, §5) and its rev 3
static-shell text (`git show 07c4357`), and `resource-limits.md` §3.6. All checks are reading
checks: no client code exists yet, and L2 isn't built, so nothing could be probed.

## Verdict

**Request changes, narrowly.** Revision 2 resolves most of what the two reviews raised, and
resolves it in the right place. Screen-driven native focus, the key-handler contract, the
dev proxy, rev 4 admission, restore, paste, gestures and lane ownership all hold up against
the sources. The two reviews raised 28 High and Medium findings. The table below has 26 rows, because
two alignment findings duplicate review 1's. Of the 26, 21 are resolved and 5 partially;
none is unresolved.

Two new High findings would cause a wrong build. Both have local fixes:

- **N1.** In the phone browser, the stable-box layout hides tmux's bottom rows. They sit under
  the resting toolbar, and with the keyboard up, the cursor row sits under the keyboard. The
  kept `cursorPan` reads a container height that by design never shrinks.
- **N2.** Precaching the whole build in one burst collides with the daemon's shell caps (4
  slots plus 16 waiters, then `503`). The service worker's install would then fail every time.

Three Medium findings leave an implementer guessing:

- the service worker's cache lookup and cleanup across versions (N3);
- who applies draft rules to native compose edits (N4);
- three gaps in the owned-input table (N5).

None of this is frame-rot.

## Status of each High and Medium finding

| Finding | Status | Evidence |
|---|---|---|
| R1 H1 sizing breaks native | **Partially** | Native is fixed: `collapsedHeight` is kept, matching ios-shell "Keyboard geometry" and `size.ts:77`. The browser variant is new and has its own hole (N1) |
| R1 H2 native borrow race | Resolved | §6.5 sends the resting mode per screen; `borrow`/`release` are gone; the G3 row covers it. This matches ios-shell's states (`webText` lowers the guard) |
| R1 H3 key handler double delivery | Resolved | §7.2 rules 1–3 match `CoreBrowserTerminal.ts:1021–1027` and `1140–1153`: `preventDefault` on keydown suppresses keypress; the handler returns `false` on keypress and keyup too. Two small slips remain (N6, N7) |
| R1 H4 owned input deletes | **Partially** | The sentinel gives deletes a target. Replacement, composition and hardware Ctrl are still underdefined (N5) |
| R1 H5 dev can't authenticate | Resolved | §5.11 matches rev 4: the token goes on the native lane (ios-shell edit, rev 4 l.769), and `/auth/node/session` with a token is `400` (§3.14 l.543). The proxy answers it and rewrites `browserOrigin` |
| R1 H6 lanes not disjoint | Resolved | W0 owns every shared file, dependencies are installed before the fork, the browser adapter is split per file, image paste belongs to W2, and §10 lists daemon prerequisites and working-tree rules. A few files are unlisted (N9) |
| R1 H7 / A H1 gestures missing | Resolved | §7.6 adds the recognizer, the mouse-mode tap, `touch-action`, the bounded snapshot, logical copy, the `select` owner, P3b and the gates |
| R1 H8 SW navigation | **Partially** | Navigation is now cache-first and the whole build is precached. How the new worker serves an old page's chunks, and how it knows which version a client runs, is unspecified (N3). The precache burst fails against the shell caps (N2) |
| R1 M1 transport | Resolved | `openSocket` returns a `Link` at once and refusals arrive as a synthetic close. `token` is optional and only `tether.v1` is offered. `hello.client.kind = "web"` is not stated (N13) |
| R1 M2 / A H2 admission vs rev 4 | Resolved | The §4.2 table matches rev 4 §3.8 row by row. The device-name field and warning, Settings, Remove this device, per-machine enrolment and the 4401 follow-up are all present |
| R1 M3 restore | Resolved | §6.2 steps 2–4: `watching` decides, the listing retries, the first watch waits for a measured size, and only the listing's server is judged |
| R1 M4 paste | Resolved | §7.5 has the 256 KiB check, capture with `stopPropagation`, timeout as `uncertain`, and `req` on refusals in L4 |
| R1 M5 focus timing | Resolved | §6.5: effects run synchronously, the input is mounted once, and touch dialogs never focus a field. Rule 2 lists the real files |
| R1 M6 landscape phone | Resolved | `min(width, height) < 600`, and one renderer instance is reparented. The iPad case is in N1 |
| R1 M7 missing capabilities | Resolved | `playVideo`, `restart`, `subscribe`/`PlatformChange` and native `copy` are added |
| R1 M8 cores and DOM | Resolved | Rule 5 is restated, `files/render/` is added, and only core ESLint is used. `ui/theme.ts` now breaks rule 3 (N8) |
| R1 M9 reload loop | Resolved | At most one reload per 10 min, then a halt with Retry |
| R1 M10 reserved shortcuts | Resolved | Cmd is reserved on macOS only, Ctrl goes to the terminal, Ctrl+V sends `^V`, and `macOptionIsMeta: false` |
| R1 M11 draft persistence | **Partially** | The browser is fixed: flush on hide, and a full store refuses with a message. For native, "the web owns rules" contradicts "native compose reads and writes them" (N4) |
| A H3 dev/test admission | Resolved | Enrol and the problem screens run on the `test` harness. W4 runs from an enrolled second machine through Serve, and its served checks wait for L2 |
| A M1 multi-window | **Partially** | Only the tapping page reloads, drafts carry revisions, and `BroadcastChannel` coordinates. "All have replied" has no membership (N3). Two visible desktop windows still overwrite each other's workspace (N10) |
| A M2 rotation with keyboard up | Resolved | Native uses `collapsedHeight`. The browser root is `100svh`, which ignores the keyboard, and `size.test.ts`'s rotation case is kept |
| A M3 unnamed ios-shell changes | Resolved | The §5.10 table covers every row the alignment review marked No, including the boot payload, `PlatformChange`, the `draftInsert` reply via `draftResult`, haptics and `activeTab` |
| A M4 Files state | Resolved | `files: { folders, preview }` lives in the workspace, separate from `overlay`, and §6.6 sets the Back order |
| A M5 plan.md stale | Resolved | The §13 spec-edit list assigns each edit to a lane |
| A M6 release raises keyboard | Resolved | Covered by R1 H2 |

## New findings

### High

**N1. The phone-browser stable box hides tmux's bottom rows: under the toolbar at rest, and
under the keyboard when it's up.** *(One-off; it comes from moving to a box that never shrinks.)*

- *Where.* §5.4 "Browser, phone layout"; §3.1 rows `term/size.ts` and `term/xterm.ts`; §11 P3a.
- *Problem.*
  - **The toolbar covers the bottom rows.** The toolbar is "positioned over [the container],
    never in its flow", and the container's box is the stable box. tmux therefore gets rows
    that sit permanently under the bottom toolbar, keyboard or not. That is where the shell
    prompt is. Native doesn't have this problem: its rows are `collapsedHeight` minus the
    insets *and the tab bar* (ios-shell "Keyboard geometry").
  - **The keyboard covers the cursor row.** Native keeps the cursor row in view with the pan:
    `xterm.ts:97` calls `cursorPan(..., container.clientHeight)`. That works only because
    native shrinks the web view above the keyboard. In the browser, the `100svh` container
    deliberately doesn't shrink, so `clientHeight` stays full height and the pan never moves.
    With the keyboard up, the prompt is under the keyboard, plus the translated toolbar and
    draft editor. The §3.1 row for `term/xterm.ts` doesn't mention changing the pan's input.
  - **iPad.** "Browser, desktop layout … keyboard is always `false`." An iPad without a
    trackpad gets the desktop layout (744 px or wider) with a coarse pointer, so `owned` input
    raises a software keyboard. Nothing tracks that keyboard, and nothing pans.
- *Check.* I read §5.4 against ios-shell "Keyboard geometry" (the rows subtract the tab bar,
  and the pan uses the shrunken area), `web/term/xterm.ts:97` and `web/term/size.ts:27`. A grep
  of the design for "pan" or "cursorPan" finds only §7.6's coordinate note.
- *Fix.*
  - **Stable box.** It is the `100svh` root minus the toolbar's resting height. The toolbar
    keeps a reserved slot in flow, and only its keyboard-time translation is out of flow.
  - **Pan area.** It is `visualViewport.height` minus the translated toolbar and the draft
    editor. `Viewport.visibleHeight` already carries the first part. Feed that number to
    `cursorPan` instead of `container.clientHeight`, and state it in the `term/xterm.ts` row.
  - **Keyboard detection.** It follows density or `directInput === "owned"`, not layout.
  - **P3a gate.** Add: with the keyboard up, type at a prompt on the last row; it stays
    visible above the editor and toolbar.

**N2. Precaching the whole build at once exceeds the daemon's shell waiters, so the service
worker never installs.** *(A class: client behaviour designed without the daemon's admission
caps. The fix bounds the client, which ends the class for the shell.)*

- *Where.* §9.2 "The precache list"; §8.4 "Whole embedded shell ≤ … 64 files".
- *Problem.*
  - **The caps.** The static shell serves 4 at once and queues 16. "A burst past 16 waiters
    gets 503, and a service-worker update that meets it fails as a whole and leaves the old
    version active" (rev 3 "One rule bounds HTTP"; rev 4 keeps the text).
  - **The burst.** The usual precache, `cache.addAll` or a `Promise.all` of fetches, sends every
    request at once. Browser to Serve is HTTP/2, and Serve opens one backend request per
    stream, so more than 20 shell files means guaranteed `503`s.
  - **The file count.** Today's `dist` has 52 files. The new build has a lazy chunk per Shiki
    grammar (13), plus markdown, viewers, fonts, icons and the manifest, so it is well over 20.
  - **The result.** The install fails at first launch and at every update. Offline launch and
    Update never work.
- *Check.* I counted `web/dist` (52 files) and read rev 3's shell row and burst paragraph via
  `git show 07c4357`. The HTTP/2 fan-out through Serve is reasoned, not probed; G12 should
  confirm it.
- *Fix.* Specify in §9.2:
  - The worker precaches with at most 4 requests in flight.
  - It retries a `503` honouring `Retry-After`, a bounded number of times, before failing the
    install.
  - Registration waits for the page's `load`, so the precache never competes with first paint
    for the 4 slots.
  - **Efficiency, same section.** Hashed assets are immutable. On an update, the worker copies
    any URL already in an older `tether-shell-*` cache instead of fetching it. That way an
    update downloads only what changed, not the full 1.5 MiB, over a weak link.

### Medium

**N3. The service worker's cross-version behaviour is unspecified: an old page's chunks, cache
cleanup, and "all have replied".** *(One instance of R1 H8; this closes it.)*

- *Where.* §9.2 "Cache only" row and "Caches"; §9.3 step 4.
- *Problem.*
  1. **Old pages.** After activation, every open page is controlled by the *new* worker, even
     the ones that kept running old assets. "Cache only, all precached at install", read as a
     lookup in the worker's own `tether-shell-<new>` cache, misses an old page's lazy chunk.
     The viewer then fails, which is the exact case R1 H8 raised.
  2. **Cache cleanup.** "Deletes only caches that no open client still uses (checked with
     `clients.matchAll()`)": `matchAll` returns clients and URLs, not build versions. No
     mechanism says which client runs which build.
  3. **Roll call.** "When all have replied, or after 5 s": a `BroadcastChannel` has no
     membership, so the tapping page doesn't know how many replies to expect. As written,
     every Update waits the full 5 s, or doesn't wait at all.
- *Check.* I read §9.2 and §9.3 against Service Worker semantics: activation takes control of
  every client in scope, and `Clients` exposes `id`, `url` and `type` only.
- *Fix.*
  - The fetch handler uses `caches.match(request)` across all caches. That is still cache
    only, but any version's asset is found.
  - Each page posts its build hash to its controller on load. Activation deletes caches whose
    hash no live client reported.
  - The tapping page asks the waiting worker for `clients.matchAll({ type: "window" }).length`
    and waits for that many `ready` replies, or 5 s.

**N4. Native drafts: "the web owns draft rules" contradicts "native compose reads and writes
them", and the bridge carries no edits from native.** *(One-off.)*

- *Where.* §5.6 "Native"; §5.10 drafts row; §13 decision 13; §11 W5 and P3a.
- *Problem.*
  - **What the bridge carries.** The draft bridge is web → native `draftGet/Put/Delete/List`
    plus native → web `draftInsert`. Native compose is a `UITextView`, and ios-shell "The
    accessory" says its `compose` state is native-internal.
  - **Who applies the rules.** Native compose edits are written by native. The web's rules
    therefore never see them: the 64 KiB cap, revision conflicts, 32-draft eviction, the
    300 ms debounce, and `DraftStore.onChange` ("another page changed it"). The design never
    says native applies them. Either Swift reimplements the rules, which is what decision 13
    rejects, or they go unenforced.
  - **A hidden lane dependency.** `draftInsert` runs the Insert state machine in `drafts/`.
    P3a owns `drafts/` and starts only after W2, while W5 starts right after W0.
- *Check.* I read §5.6 and §5.10 against ios-shell "The accessory" and "The bridge" (native →
  web has no request/reply except `activeTab()`).
- *Fix.* Pick one and write it into §5.6 and §5.10:
  - **(a), recommended.** Native compose sends `draftEdit { tab, text, baseRevision }` to the
    web. The web applies the rules and persists through `draftPut`, and answers with
    `draftResult`, including over-cap or full. A native → web `draftChanged` feeds `onChange`.
  - **(b)** Native owns compose drafts outright, with the rules written in Swift. Revise
    decision 13 if so.

  Either way, the native draft work in W5 waits for P3a's `drafts/`.

**N5. The owned-input table leaves three cases to guesswork.** *(Same class as R1 H4: the
input's semantics must be complete. The fix states them; the G3 gate still decides whether
they work.)*

- *Where.* §7.3, the `inputType` table and "Hardware keys".
- *Problem.*
  1. **No composition guard.** The desktop contract has one (rule 1); this table doesn't.
     During composition, `deleteContentBackward` would send `BSpace` and cancel an IME's own
     edit. Safari's commit-time `deleteCompositionText` and `insertFromComposition` fall into
     "anything else: cancel". The second of those is cancelable, which changes how Safari
     commits text.
  2. **`insertReplacementText` has no target to measure.** `insertText` is cancelled, so the
     element never holds committed text, only the sentinel and live composition text.
     "`BSpace` × the replaced range's length within the last commit" can't be computed from
     `getTargetRanges()`. A replacement that targets the sentinel would send `BSpace` into
     real terminal text.
  3. **Hardware Ctrl and Alt combinations are lost.** `keymap.ts` consumes "only the routed
     set in §7.2" (named keys). Ctrl+C on a Bluetooth keyboard paired to an iPhone fires
     `keydown` and no `beforeinput`, so `^C` never reaches tmux. The G3 gate tests "no doubled
     characters", not Ctrl.
- *Check.* I read §7.3 against §7.2 rule 1 and against Input Events Level 2's
  cancelability of composition input types.
- *Fix.*
  - Add a first row: while `isComposing`, or between `compositionstart` and `compositionend`,
    send nothing and never cancel.
  - Define replacement precisely. Either send nothing and cancel when the target lies outside
    live composition (autocorrect is already `off`), or keep the current word after the
    sentinel so replacements have a real target. Let the gate choose, and say which one ships
    first.
  - In owned mode, `keymap.ts` also maps Ctrl+printable to `C-x` and Alt+printable to `M-x`
    from `keydown`, with `preventDefault`.
  - Add hardware Ctrl+C to the G3 gate.

### Low

- **N6. F6 is both routed and the way out.** §7.2 routes "F1–F4 and F6–F10" with
  `preventDefault`, then says "keyboard users leave the terminal with the browser's own focus
  keys (F6, Cmd+L)". *Fix:* drop F6 from the routed set, or name another exit. Ctrl+L goes to
  the terminal, so the only exit off macOS is F6.
- **N7. The copy keys aren't in the key-handler contract.** On Linux and Windows,
  Ctrl+Shift+C isn't consumed by xterm (`Keyboard.ts:308` requires `!shiftKey`), so Chrome
  opens the DevTools inspector. On macOS, Cmd+C fires xterm's own `copy` listener
  (`CoreBrowserTerminal.ts:334`), which writes xterm's selection, not the logical text §7.6
  promises. *Fix:* the handler takes Ctrl+Shift+C with `preventDefault` and calls
  `platform.clipboard`, and a capture-phase `copy` listener on the surface supplies the
  logical text, mirroring paste.
- **N8. Kept `ui/theme.ts` breaks lint rule 3.** It calls `matchMedia(...)` (`theme.ts:43`),
  and `Platform` has no colour-scheme source. *Fix:* add `scheme: "light" | "dark"` to the
  viewport or to `PlatformChange`, and have `theme.ts` take it.
- **N9. Unowned or cross-lane files.**
  - `screens/shell/` and `screens/enrol/` aren't in W0's Owns list, though W0 delivers them.
  - `screens/terminal/selection/` (P3b) isn't excepted from W2's `screens/terminal/`.
  - `DraftEditor.tsx` sits in W0's `ui/` yet is owned by P3a, while W0 "delivers every
    primitive".
  - P3a's "a tap on the terminal raises the keyboard" needs P3b's recognizer.

  *Fix:* list these explicitly. Make P3a's tap gate wait for P3b, or have P3a verify with
  the keyboard button only.
- **N10. Two visible desktop windows still overwrite each other's workspace.** "The page
  that was visible most recently" doesn't separate two windows that are visible side by side.
  *Fix:* only the page with `document.hasFocus()` writes, or accept last writer wins and
  log it.
- **N11. Key-name spelling.** §7.2 says Escape, Tab and Shift-Tab take "`C-`, `M-` and `S-`
  modifiers", but the daemon regex allows `S-` only before navigation and F-keys, and
  Shift+Tab is `BTab`. *Fix:* state Shift+Tab → `BTab` (`C-BTab`, `M-BTab`), and that `S-` is
  dropped on Escape and Enter. W2's `keys.json` test then catches the rest.
- **N12. Touch details.**
  - `touch-action: none` on the surface disables pinch zoom over the terminal, while §5.4
    says "pinch zoom stays allowed".
  - iOS shows its long-press callout and text selection on the surface unless that is
    suppressed.

  *Fix:* say zoom is unavailable over the terminal, and set `-webkit-touch-callout: none;
  user-select: none` on the surface (the selection layer excepted).
- **N13. `hello.client.kind`.** Rev 4 §5 says the browser sends `kind = "web"`, but
  `link.ts:58` defaults to `"ios"`. Add it to the `proto/link.ts` row.

## Things an implementer would still have to guess

These are covered by the findings above:

- the browser pan input (N1);
- precache concurrency and retry (N2);
- the cross-version cache lookup, the client-version mechanism and the roll-call count (N3);
- where native draft rules run (N4);
- the replacement target and the composition guard (N5);
- the copy keys (N7);
- the colour-scheme source (N8).

Smaller ones:

- the `EnrolResult` mapping for a `503` from `/auth/node/enroll`;
- whether the web or native restores `terminal` after `select` ends (ios-shell says native;
  §5.10 says the web sends a mode on every screen change).

## Hypotheses (not verified)

- **The precache burst (N2).** Whether Serve fans HTTP/2 streams out to concurrent daemon
  connections with no limit. I reasoned from Go's default `Transport` (no `MaxConnsPerHost`).
  *Blocked:* L2 isn't built; G12 should record the peak.
- **The owned input on iOS (N5).** Whether iOS fires `insertReplacementText` at all for an
  element whose committed text was cancelled, and whether Korean syllables form when the IME
  sees only the sentinel. *Blocked:* needs a real iPhone; it belongs to the G3 gate.
- **Cache Storage and gzip.** Whether precached responses count against storage quota
  decoded or encoded. This doesn't change a decision. *Not checked.*
