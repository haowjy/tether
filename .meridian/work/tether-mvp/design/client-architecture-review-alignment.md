# Alignment review: client-architecture.md

Reviewed: `.meridian/work/tether-mvp/design/client-architecture.md` (status "design for
review, 2026-10-23", untracked, on `main` at `71c07a0`). Checked against the D-lane
brief, `docs/design/client/browser-behaviors.md`, `terminal-interaction-design.md`,
`browser-setup.md` (PWA, drafts), `connection-roadmap.md`, `plan.md` "Code structure
and standards", `ios-shell.md`, and, where the design defers to them,
`design/browser-auth.md` rev 4 and `design/resource-limits.md`. I edited no source and
no design. Line numbers are the design's unless marked otherwise.

## Verdict

**Request changes.** The spec is strong where it is specific. The platform interface,
the workspace reducer, restore-by-listing, the history rules, the token tiers, the
paste route and the service-worker caching table all match their contracts, and the
alternatives-rejected log is thorough. It is not frame-rot: every gap below fits
inside the existing structure. Three problems block it:

1. **One whole source of truth is missing.** terminal-interaction-design.md's gesture,
   selection and copy rules have no section, no focus state and no lane (H1).
2. **It drifts from auth rev 4**, including D3, which Jimmy settled: separate
   enrolments per browser, an Enrol screen with no device name, no home for "Remove
   this device" (H2).
3. **The lanes can't run their own verification.** The dev and test admission path
   the design describes contradicts rev 4. A bundle served by the daemon can't be
   admitted from the dev box at all (H3).

**Does it name every ios-shell change? No.** §3.3 and §5.9 name five changes. At least
eleven more follow from the design and go unnamed (M3).

## Coverage matrix

### Brief

| # | Requirement | Status | Evidence / shortfall |
|---|---|---|---|
| 1a | What survives / what is deleted | Covered | §3.1 table, module by module, with reasons (l.100–124) |
| 1b | New module layout | Covered | §3.2 tree and lint-checked dependency rules (l.128–173) |
| 1c | Rescope the native-only no-focus lint | Covered | §3.3 three rules (l.175–192) |
| 2a | Adapter: boot + credentials | Partial | §4, §5.1. Admission states don't match rev 4's answers (H2) |
| 2b | Input + focus | Covered | §5.3, §6.5. The native release target is wrong (M6) |
| 2c | Viewport + keyboard | Partial | §5.4. A rotation with the keyboard up sizes tmux from the shortened box (M2) |
| 2d | Lifecycle (visible/online) | Covered | §5.5, one owner in `net/hosts.ts` |
| 2e | Storage | Partial | §5.6. Several pages writing at once isn't handled (M1). Native draft parity is unspecified (L10) |
| 2f | File pick + image paste | Covered | §5.7, §7.5 |
| 2g | Link opening, haptics | Covered | §5.1, §5.8. The haptic kinds diverge from ios-shell (M3) |
| 2h | Browser / native / test implementations | Partial | §5.8 table. No event exists for host-list, lock or admission changes after boot (M3) |
| 2i | Dev shim never becomes production auth | Partial | No dev mode, and a preflight string check (§5.10). The dev proxy mechanism contradicts rev 4 (H3) |
| 3a | Home / Terminal / Files | Covered | §6.1 `destination`, §6.6 routes |
| 3b | Tabs keyed by server+window identity | Covered | `TabKey (hostId, server, window)` (l.438–451) |
| 3c | Restore after reload, validated against a listing | Covered | §6.2. No same-name substitution; a refused listing decides nothing |
| 3d | Browser history rules from the contract | Partial | §6.6 matches the entry rules. Files folder and preview state doesn't fit the single `overlay` (M4) |
| 3e | Event-driven sessions refresh, no polling | Covered | §6.3 "Fetch on" list; search filters the cache |
| 4a | Primitive → semantic → component tokens in CSS vars | Covered | §8.3 table and read rules |
| 4b | Light / dark | Covered | §8.3 Theme, WCAG pairs |
| 4c | Density axis, 44 px targets | Covered | `[data-density]`, `touch` 44/48/52 |
| 4d | Type scale with terminal font | Covered | §8.3 Type, §8.4 font budget |
| 4e | Connected / reconnecting colours, no dot markers | Covered | §8.3 "Connection colour without dots" |
| 4f | Component approach (headless via compat vs owned): size, compat, maintenance | Partial | Size and compat weighed (§8.1). The maintenance cost of owning a11y behaviour isn't weighed against a library's upkeep (L12) |
| 4g | Component list | Covered | §8.2. But "Home's overflow" (l.773) implies a menu the list doesn't have (L7) |
| 4h | Mockup improvements | Covered | §8.5, ten rows, each marked for decisions.md and the contract |
| 5a | Desktop terminal input | Covered | §7.2 |
| 5b | Phone browser terminal input (xterm textarea vs owned) | Covered | §7.3 with upstream evidence and a probe gate |
| 5c | Local draft editor, Insert sends no Enter | Covered | §7.4. Insert states, protocol ack gap, bounds |
| 5d | Paste and image paste routes | Covered | §7.5 |
| 6a | Manifest | Covered | §9.1 |
| 6b | SW scope and update flow | Partial | §9.2–9.3. Update reloads every open window, not only the one that tapped (M1) |
| 6c | Caching | Covered | §9.2 table: no `/ws`, `/auth`, `/fs`, `/complete` |
| 6d | Offline drafts never queue input | Covered | §7.4 Offline, §9.4 |
| 7a | Build order as lanes, disjoint directories, one checkout | Partial | §10. Directories overlap. Browser uploads, clipboard and links have no owner. W5 has no gate. The touch and selection lane is missing (L11, H1) |
| 7b | What each lane verifies | Partial | §10 Verifies column. W4's daemon-served checks can't be admitted (H3) |
| F1 | Fixed: no Files in terminal `+` | Covered | Picker is "Attach-only" (vocabulary, l.86). Not stated as an invariant (L8) |
| F2 | Fixed: no intermediate menu | Covered | `+` opens the picker directly (contract). Not stated (L8) |
| F3 | Fixed: no dot markers or separators | Partial | Dots covered by §8.3. Middle-dot separators aren't stated or checked (L5) |
| F4 | Fixed: no custom browser keyboard strip | Covered | §7.3 "No key strip" |
| F5 | Fixed: Insert sends no Enter | Covered | §7.4 |
| A1 | Browser auth: enrolled tailnet node, no cookie | Covered | §4 l.212–217 |
| A2 | Boot reads enrolment state from the daemon | Partial | §4. It leaves the route to "auth rev 4", which already names `GET /auth/node/session` and `browserOrigin` (H2) |
| R1 | Default budget allows 3 sessions | Covered | §6.4, 72 MiB → 3 |
| R2 | A refused session gets a clear message | Partial | Message and Retry exist. The hint may not be actionable (L6) |
| C1 | Written for a cold reader | Partial | Vocabulary table is good. It uses p25/p36, L3/L4, G1–G3 and "rev 3 §5" without defining them, and Sources are unlinked (L9) |

### browser-behaviors.md

| Rule | Status | Evidence / shortfall |
|---|---|---|
| Desktop 56 px rail Home/Terminal/Files, labels and tooltips | Covered | `--rail-width` 56, §8.5 Tooltip row |
| Phone: Home bottom nav; full-screen terminal, bottom toolbar (back, tabs, +, keyboard) | Covered | §6.1 `homePane`, §3.2 screens, §7.3 toolbar |
| Measured visible viewport, safe areas, 44 px | Covered | §5.4, §8.3 |
| Home: Open tabs first, open/close semantics | Covered | §3.2 `screens/home`, §6.1 |
| Search by session or window, case-insensitive, collapsed by default, expansion survives, search temporarily expands | Covered | §6.3 Expansion |
| "N windows", "index: name", Open marker | Gap (low) | Not stated anywhere (L1) |
| attachedElsewhere copy | Covered | §6.3 |
| + New session / + New window, optional name and directory, server validation | Covered | §6.3 Creation; §8.5 restyle is logged |
| No tabs / no server / network failure distinct | Covered | §6.3 four states |
| Tab activation, close-neighbour rule, close never kills | Covered | §6.1 |
| Last tab closed → desktop focuses Home search | Covered | §6.1 |
| Creation-dialog cancel restores focus to the exact opener | Gap (low) | Not stated; §8.1 says only "focus return" in general (L1) |
| Desktop Terminal rail with no tab opens picker; dismiss → empty state "Open a window with + or from Home." | Gap (low) | Not stated (L1) |
| Plus opens picker directly, no Files, no menu | Covered | see F1/F2 |
| Connection colour on tab and host label, no dot; overlay with Retry | Covered | §8.3, §8.2 Overlay |
| Picker: dismiss by close, outside tap or Escape; desktop focus to terminal (or + if empty); mobile to + without keyboard; desktop autofocuses search, mobile doesn't; focus trapped | Partial | Trap and Escape covered (§8.1). The +-if-empty return, mobile return to +, desktop-only autofocus and outside-tap dismissal aren't stated (L1) |
| Files: folder list, parent control absent at root, path context, preview back to folder, context kept on return | Partial | Rows shared (§8.2). The state model can't hold a folder stack plus preview across destination switches (M4) |
| Session vs folder chevron semantics | Gap (low) | Not stated (L1) |
| Refresh on entry, debounced sessionsChanged, picker open, reconnect; prune only from authoritative listings | Covered | §6.3 |
| Restore validated; no same-name substitution | Covered | §6.2 |
| Keyboard button focuses browser input; no strip; draft while keyboard open; Insert via paste, no Enter; hide keeps draft | Covered | §7.3, §7.4 |
| Pill shows window part first, tooltip and accessible label give the full name, real index | Partial | Truncation order covered (§6.1, §8.5). Tooltip and accessible label for pills not stated (L1) |
| Disabled controls explain why | Partial | Insert "Not connected" given; not a general rule (L1) |
| Upload → completion offers preview and "Insert path into <active tab>" | Partial | §7.5 covers the insert. The completion offer, the label naming the tab and the disabled "Open a terminal tab first" are missing (L2) |
| Target captured on click; failure never retargets | Covered | §5.7, §7.5 |
| Image paste: capture target, upload, insert quoted path, failure keeps file, unsupported → explanation | Covered | §7.5 |
| Keyboard ownership: terminal only while focused; Escape to overlay only while open; desktop focus restore; never steal from a field | Covered | §6.5, §7.2 |
| Browser-reserved shortcuts not hijacked | Covered | §7.2 |
| History: transitions, drill-in, preview, modal push; tabs don't; Back closes top first; native same hierarchy | Covered | §6.6 (but see M4 for the Files state behind it) |
| Visual copy rule: no middle dots, no dot markers | Partial | see F3 (L5) |
| Terminal context: bold session, regular window, smaller muted host, no "on" | Gap (low) | Not stated (L1) |
| Text clipboard: logical copy, paste via paste route, no extra Enter | Partial | Paste covered. Copy has only a risk row (l.857) (H1) |
| Touch and clipboard research gate | Gap | H1 |

### terminal-interaction-design.md

| Rule | Status | Evidence / shortfall |
|---|---|---|
| One gesture owner; tap → remote click only in an app mouse mode; long-press → selection; pointercancel; no mouse-down on touch start | Gap | No section mentions gestures, mouse mode, long-press or pointer events (grep: none) (H1) |
| `touch-action` pan ownership; coordinates from real cell metrics and viewport offsets | Gap | H1 |
| Logical copy, selection snapshot layer bounded and freed on dismiss | Gap | H1 |
| Paste one path, pane mode authoritative, no double bracket | Covered | §7.5 |
| Copy in gesture with failure feedback | Partial | `clipboard.writeText` returns `denied` (§5.1); nothing uses it (H1) |
| Draft: native editing, settled input, Enter newline, Insert explicit | Covered | §7.4 |
| One focus owner: terminal, draft, selection UI, hidden | Partial | §6.5 has no selection owner. `setFocus("select")` exists but nothing enters it (H1) |
| Insert captures host/server/window and revision; never retargets; no claim before accept; no auto-retry of uncertain | Covered | §7.4 |
| Draft persistence per identity, bounded, failure shown, clearable; closed-tab retention to settle | Covered | §7.4, open question 1 |
| Retain after Insert (proposal) | Covered | §7.4 |
| Hide the compose surface when the keyboard closes; visualViewport + focus, exclude zoom; no polling | Covered | §5.4 detection rule; P3 prototype |
| Probe gates: copy, selection vs click, paste, draft, keyboard layout, clipboard permissions | Partial | §11 covers input, keyboard, sheet and paste ack. The selection-vs-click and logical-copy gates are absent (H1) |

### browser-setup.md (PWA and drafts)

| Rule | Status | Evidence / shortfall |
|---|---|---|
| Manifest fields, stable id, icons, apple-touch-icon | Covered | §9.1 |
| Usable uninstalled; install affordance with iOS steps, not forced | Covered | §9.1 |
| Standalone uses the same layout, safe areas, no fake keyboard | Covered | §5.4, §5.10 |
| SW shell-only, build-generated list, no API/file/credential caching, no Background Sync | Covered | §9.2, §9.4 |
| Versioned caches, install complete shell first, keep prior version working, reload only after draft persistence and explicit acceptance, no automatic reload mid-composition | Drift | §9.3 step 4 reloads on `controllerchange`, which fires in every controlled window, including ones that didn't tap Update (M1) |
| Multi-window update coordination tested | Gap | M1 |
| Protocol mismatch disables input, explains reload, no retry | Covered | §4, §9.3 step 5 |
| Lifecycle-triggered update checks, no polling | Covered | §9.3 step 1 |
| Offline launch shows Disconnected and drafts, no pretend terminal | Covered | §9.4 |
| IndexedDB, schema version, small records, show failure, Clear, persist() without promise | Covered | §5.6 |
| Safari vs PWA possibly separate stores; first-launch guidance explains | Drift | §9.4 says "separate enrolments". Under rev 4 one enrolment covers the node (H2) |
| One lifecycle owner; hidden releases watches; fresh snapshot before input; onLine is a hint | Covered | §5.5 |
| Browser direct input handles composition, input and paste; drafts never feed tmux | Covered | §7 |

### connection-roadmap.md

| Rule | Status | Evidence / shortfall |
|---|---|---|
| "Server" vocabulary; state and drafts scoped to stable server/window identity | Covered | §2 host row, TabKey with hostId |
| Credentials belong to their server, never the active profile | Covered | §5.2 per-host `openSocket` |
| Native: multiple profiles, connect only as needed, active machine clear before input or insertion | Partial | Tabs carry the host. Labels drop the host, so two hosts' `a1 / main` pills look identical (L1) |
| Browser: page URL selects the server; no URL setting | Covered | §5.1 `hosts` exactly one |
| Unreachable copy doesn't claim a cause | Covered | "Can't reach pop-os" |
| Endpoint, transport and credentials outside terminal components; no speculative plugin infrastructure | Covered | `Transport` is small and concrete |

### plan.md "Code structure and standards"

| Rule | Status | Evidence / shortfall |
|---|---|---|
| Pure cores, thin I/O | Covered | workspace, sessions and drafts reducers; controller executes effects |
| Bounded everything | Partial | Drafts (64 KiB × 32) and toasts are bounded. `uploads.send(files[])` takes any number of pasted files with no cap or queue bound, while the daemon allows 1 upload at a time (L13) |
| Tab state is an explicit state machine; TS strict | Covered | `TabDriver` kept, new `restoring` and `limited` states |
| One native focus controller | Covered | §6.5 |
| The spec's own text stays accurate | Gap | plan.md's `web/` layout tree and its Frontend bullet ("a lint rule bans `<input>`… short text entry asks native for a prompt") both become false. The design names neither edit (M5) |

### ios-shell.md: changes the design implies

| Change | Named by the design? |
|---|---|
| "No other web text inputs" rule replaced by `webText` borrowers | Yes (§3.3) |
| `prompt` removed | Yes (§3.3, §5.9) |
| `saveTabs` → `saveWorkspace` | Yes (§5.9) |
| `draftInsert` added | Yes, but incompletely: see M3 item c |
| `input` gains a target tab; `BRIDGE_VERSION` 2 | Yes (§5.9) |
| `boot` payload `tabs`/`active`/`SavedTab` → `workspace` ("Boot and host payloads") | **No** |
| Borrow timing moves from "when the surface opens, before the tap" to pointer-down, and release goes to `terminal` | **No** (M6) |
| Tmux sizing from a measured box instead of `collapsedHeight` ("Keyboard geometry") | **No** (M2) |
| `upload { tab }` changes from the web's tab id to a tab key; auto-insert on `path` becomes the contract's offered "Insert path into <tab>" | **No** |
| `window.__tether.activeTab()` kept or removed once `input` carries its target | **No** |
| `hosts`, `lock` and `hostRejected` reach the web how? `Platform` has no event for them | **No** |
| `playVideo` kept or dropped | **No** |
| Haptic kinds `tap/success/warning` replace the semantic table (selection changed, rigid impact) | **No** |
| Accessory text "Retention… remains to settle" settled by §7.4 / open question 1, and native draft bounds | **No** |
| Suggestion strip references in the native/web table, keyboard geometry and haptics ("chip accepted") | **No** |
| `web/native/bridge.ts` → `web/platform/native/bridge.ts`; `--safe-*` in `web/ui/tokens.css` (deleted) | **No** |

**Totals.** 130 items checked: 114 status rows (75 covered, 26 partial, 11 gap, 2
drift) and 16 ios-shell rows (5 named, 11 not). Counting the 11 unnamed ios-shell
changes as gaps gives 22 gaps.

## Findings

### High

**H1. Terminal touch interaction, selection and copy are unspecified.** *(One-off omission
of a whole source of truth.)*
- *Requirement.* terminal-interaction-design.md l.7–25: one gesture owner, a tap
  becomes a remote click only in an app mouse mode, long-press selection,
  `touch-action` and pointercancel, a bounded selection snapshot, logical copy. Its
  probe gates are at l.58–65. browser-behaviors l.110–118 (copy, touch gate). The
  build plan's P3 is "draft editor, touch scroll/selection/copy, paste + image paste".
- *Shortfall.* A grep of the design for selection, long-press, touch-action, mouse,
  scroll and gesture finds only the dialog/sheet scroll and TabStrip lines. The rest:
  - §6.5 has no `select` owner. `setFocus("select")` (l.288) is reachable from nothing.
  - `clipboard.writeText` has no caller.
  - Desktop mouse reporting, wheel scrollback and xterm selection aren't addressed.
  - §10's P3 delivers only the owned input and the draft.
  - §11 has no selection-vs-click gate.
- *Consequence.* Lanes W2 and P3 will each invent gesture handling, or ship none, and
  the copy gate in browser-setup's acceptance checks has no owner.
- *Fix.* Add a §7.6, "Gestures, scrollback, selection and copy". It names:
  - the gesture owner module in `term/`;
  - the mouse-mode source of truth;
  - the desktop path (xterm selection; logical copy once L3 lands);
  - the touch path (long-press → a selection layer with a capped snapshot);
  - a `select` focus owner;
  - its lane (split P3 or add P4-web);
  - the selection-vs-click and logical-copy gates in §11.
- *Check.* Grep (above) and the build-plan quote at `build-plan.md` l.57.

**H2. The design drifts from auth rev 4, including D3, which Jimmy settled.** *(A class:
the design was written against "rev 4 in progress" (l.910) and defers to it rather than
reading it. Fix by aligning §4 to rev 4 §3.8–3.11 in one pass.)*
- (a) §9.4 l.810: "Safari and an installed PWA have separate storage and separate
  enrolments; the Enrol screen and the install instructions say so." Rev 4 enrols the
  *node*: "One enrolment per machine, not per browser profile" (browser-auth l.789).
  The copy would tell Jimmy something false. Fix: separate drafts and storage, same
  enrolment.
- (b) Enrol screen (l.218–220, `enrol?(code)`). Rev 4 §3.9 step 3b specifies:
  - a device-name field, prefilled with the node name;
  - the warning "This lets every browser and app on <node> use tether on <host>";
  - `POST /auth/node/enroll {code, deviceName}`.

  Fix: add `deviceName` to `enrol`, and the field and warning to the screen.
- (c) Rev 4 D3, which Jimmy settled (browser-auth l.102, l.481): "Settings has 'Remove this
  device'" with a confirmation, plus a separate "Clear local data". The design has no
  Settings surface. Its destinations are Home, Terminal and Files only, and §3.1 drops
  `files/browser.ts`'s Settings place. §7.4 relies on "Clear local data" with nowhere
  to put it. Fix: name the surface (for example a Home "Settings" row or dialog), its
  route or overlay, and its lane.
- (d) Admission enum (l.89, l.212–222): `admitted | notEnrolled | refused | unreachable`.
  Rev 4's table (browser-auth l.410–416) also has `503 identity_unavailable /
  auth_unavailable / busy` and close 4503, meaning "keeps its state and retries".
  Mapped to `unreachable`, the page would show "Can't reach pop-os" while the daemon
  is up. `node_refused` carries a reason ("This device is a subnet router"). Fix: add
  a `pending`/`retrying` admission and a reason on `refused`.
- (e) l.203: "route named by auth rev 4". Rev 4 already names `GET /auth/info`
  (`browserOrigin`, `browserRefused`) and `GET /auth/node/session`. Name them.
- *Check.* Quoted passages above, read side by side.

**H3. The dev and test admission path can't work as written, and W4's checks can't be
admitted.** *(A class: the lanes' verification is designed around an admission path
that doesn't exist.)*
- §5.10 l.419–421 says the Vite proxy "forwards the headers Serve put on the request
  rather than inventing an identity". Rev 4 decides otherwise:
  - A connection from any uid other than tailscaled's (including "Jimmy's dev proxy, a
    test, Playwright") "may use the native lane, never the node lane" (browser-auth
    l.256).
  - Under "Dev mode", the Vite proxy "connects to the daemon's socket and presents a
    native token" (l.769).
  - D2 "refuse[s] the dev box's own node always" (l.101).
- The consequences:
  1. Under Vite, the browser adapter is admitted only because the proxy injects a
     native token. That's acceptable (the token never reaches JS), but `GET
     /auth/node/session` then reports native-lane state. So the Enrol and
     `notEnrolled` screens can't be exercised in dev, and the design doesn't say so.
  2. W4's "Built bundle served by the daemon (not Vite)" checks (l.837) need an
     admitted page for "upgrade with an open terminal and an unsaved draft". A browser
     on the dev box is refused, and a local Playwright is a local peer. W1's "against
     a real daemon" has the same problem unless it goes through Vite.
- *Fix.*
  - Restate §5.10 per rev 4: the proxy holds a native token, and JS never sees it.
  - Give the lanes a stated admission path. Either W4 runs from an enrolled second node
    (the laptop) through Serve, or preflight serves `web/dist` through the same
    token-injecting proxy. Note that the second option exercises neither node
    admission nor the Enrol screen.
  - Put the Enrol and refusal screens on the `test` adapter harness.
  - Keep the preflight check that the production build contains no harness.
- *Check.* Quoted passages above.

### Medium

**M1. A service-worker update reloads every open window, and concurrent pages overwrite
each other's storage.**
- §9.3 step 4 (l.799–800): "flush drafts, then tell the waiting worker to
  `skipWaiting`; on `controllerchange`, reload."
- The worker's activation changes the controller of every client of the registration,
  so `controllerchange` fires in every tether window or tab. Each then reloads without
  its own tap, and possibly mid-IME composition or inside the 300 ms draft debounce.
- browser-setup l.191–195 forbids "automatic reload mid-composition" and requires
  multi-window update coordination.
- Separately, §5.6 stores one workspace record per host. Two pages on the same origin
  (two browser tabs, or Safari plus a PWA if the stores were shared) save last-wins
  and clobber each other's tab lists. Drafts for the same tab key race too.
- *Fix.*
  - Coordinate through a `BroadcastChannel`. Update asks every client to flush and
    acknowledge, and a client in composition defers.
  - Only the tapping client reloads at once. Others show "Update ready, reload" and
    keep working, which requires keeping the old cache until no client uses it.
  - Hold workspace and draft writes under Web Locks, or define per-page workspace
    ownership.
- *Check.* The design and browser-setup passages are quoted. The `controllerchange`
  behaviour is from the Service Worker spec: activation updates `controller` for every
  client that uses the registration. I didn't run a two-tab probe.

**M2. A rotation with the keyboard up sizes tmux from the shortened box.**
- §5.4 l.314–318 sizes tmux from the terminal box measured by `ResizeObserver` and
  never resizes when `reason` is `keyboard`. On a rotation with the keyboard up, the
  measured box is the keyboard-shortened height, so tmux gets too few rows.
- This applies to native, whose web view ends above the keyboard (ios-shell "Keyboard
  geometry"), and to the browser, whose box sits above the visual viewport.
- ios-shell solves it explicitly: "Every `viewport` carries the full-screen layout's
  `safeArea`… so a rotation while the keyboard is up gives the rows the collapsed
  layout has". `web/term/size.ts` l.77 computes from `collapsedHeight`, and
  `size.test.ts` l.36–40 covers rotation. The revision drops that rule without naming
  it.
- *Fix.* Rows come from `stableHeight` (or native `collapsedHeight`) minus the measured
  chrome around the terminal box, not from the box itself. Keep the rotation case in
  the kept `size.test.ts`, and name the ios-shell change.
- *Check.* Read `web/term/size.ts` and `size.test.ts` alongside §5.4.

**M3. Eleven ios-shell changes are unnamed** (table above). Three of them hide open design
choices:
- (a) The boot payload shape. `boot { tabs, active }` and `SavedTab` become a
  workspace, and `SavedTab.name` is what lets restored tabs show labels before the
  listing.
- (b) `Platform` has no subscription for native `hosts`, `lock` and `hostRejected`
  after boot (`BootResult.hosts` is static), nor for browser admission changes.
- (c) `draftInsert` is a native → web request with a reply. The bridge's native → web
  direction (`receive(messages)`) has no replies today; only `activeTab()` returns a
  value. Name the mechanism (a `callAsyncJavaScript` entry point), or flip it to a
  web → native reply.

*Fix.* Add an "ios-shell.md changes" list to §5.9 covering every row marked No, each
with its decision. *Check.* Read the design against ios-shell "The bridge", "Boot and
host payloads", "Focus", "Keyboard geometry", "Haptics" and "The accessory".

**M4. Files navigation state doesn't fit the workspace model.**
- `WorkspaceState.overlay: Overlay | null` (l.443) is one slot. §2 and §6.6 class
  "a folder drill-in, a file preview" as overlays.
- A folder path is a stack, and a preview sits on top of it. The contract requires
  "Returning from terminal preserves folder/preview context" (browser-behaviors
  l.63, l.72).
- Rail Files → drill two folders → open preview → rail Terminal → rail Files: one
  overlay slot either loses the folder stack or carries Files overlays into Terminal.
  The picker can't be open over Terminal at the same time either.
- *Fix.* Give Files its own state in the workspace: current folder path and open
  preview, outside the URL. Keep `overlay` for the picker and creation dialogs. Then
  push history entries for drill-ins and previews with `parent` set from that state.
- *Check.* Read §6.1 and §6.6 against the contract lines.

**M5. plan.md "Code structure and standards" goes stale.**
- Its `web/` tree (`native/`, `app/` "the window sheets", `complete/`, `ui/`
  "Tappable, Sheet", `dev/`) and its Frontend standard ("no element takes focus except
  the v2 editor; a lint rule bans `<input>`, `<textarea>` and `contenteditable`
  elsewhere, and short text entry asks native for a prompt") are both contradicted by
  §3.
- AGENTS.md: "Keep `docs/design/` … accurate in the same commit as the code."
- *Fix.* List the plan.md edits (tree, Frontend bullet, the Tests bullet's Playwright
  scope) in §12 and assign them to W0.
- *Check.* plan.md l.600–653.

**M6. Native `release` → `focus terminal` raises the keyboard over Home.**
- §3.3 rule 3: "`release` on blur… The native adapter turns these into… `focus
  terminal`".
- ios-shell Focus: on `focus terminal`, "native makes `TerminalInputView` first
  responder again". In state `terminal` the keyboard is up.
- So blurring Home search, or cancelling a creation dialog, on native raises the
  terminal keyboard while Home is on screen.
- Moving the borrow from "when the surface opens, before the tap" to pointer-down also
  races WebKit's focus against an async bridge message while the guard
  (`canResignFirstResponder` false) is up. No §11 gate covers that race.
- *Fix.* `release` goes to `hidden` unless the destination is Terminal and the
  terminal owned focus before. Add a native probe in W5: Home search tap, type, blur,
  and the keyboard state after each.
- *Check.* Read §3.3 against ios-shell's Focus table and "Borrowing" bullet.

### Low

- **L1. Contract details the screens need but the spec omits.**
  - Home rows: "N windows" (singular), "index: name", the Open marker.
  - Creation-cancel focus returns to the exact opener.
  - Desktop rail Terminal with no tabs opens the picker; dismissing it gives the empty
    state "Open a window with + or from Home."
  - Picker focus: desktop autofocuses search, mobile doesn't; focus returns to `+`
    when no tab is open and to `+` on mobile without raising the keyboard; an outside
    tap dismisses.
  - Session versus folder chevron semantics.
  - Pill tooltip and accessible label give the full name.
  - Terminal context typography: bold session, regular window, muted host, no "on".
  - Disabled controls explain why, as a general rule.
  - Native pills from two hosts with the same `session / window` look identical.

  *Fix.* A short "screen rules" list in §6 or a pointer that W1 and W2 implement the
  contract sections verbatim. *Check.* Grep for each phrase: absent.
- **L2. Upload completion.** The contract says completion "offers a preview and
  'Insert path into <active tab>'". The disabled state reads "Open a terminal tab
  first". Native today auto-inserts on `upload.path` (ios-shell). Fix: state the
  offered action and the disabled copy for both adapters.
- **L3. Layout breakpoint vs column.** Desktop layout starts at 720 px (l.304), but
  desktop Home is a 720 px column (l.759) beside a 56 px rail. At 720–775 px the
  column overflows or shrinks. Fix: the column is `min(720px, 100% − gutters)`, or move
  the breakpoint.
- **L4. Lane overlaps.** The design states lanes own disjoint directories (l.815), but:
  - W0 owns `platform/browser/` and W4 writes `platform/browser/pwa.ts`;
  - W2 owns `term/` and P3 writes `term/input/owned.ts`;
  - the screens/terminal draft slot is "handed over".

  Fix: own by file, or move `pwa.ts` to `sw/` and owned input to its own directory.
- **L5. The visual copy rule.** The middle-dot ban is never stated. Add it to §8 and
  have preflight grep `web/` for `·` in copy.
- **L6. The `limited` hint.** "Close a tab from another session to open this one" may not
  be actionable. Lingering control clients close first and each page watches only its
  on-screen tab, so the cap usually binds because *other* windows or devices hold
  sessions (resource-limits §3.5). Fix: "…in this or another tether window or the
  app".
- **L7. "Home's overflow"** (l.773) implies a menu. §8.1 says no screen needs one, and
  §8.2 has no Menu primitive. Fix: make it a row or a Banner action.
- **L8. Fixed choices.** §8.5 says "None touches Jimmy's fixed choices" but never lists
  them. Add the five as invariants, so a later lane can't regress them silently.
- **L9. Cold reader.** p25, p36–p38, L3, L4 and G1–G3 are used undefined, and so is
  "browser-auth rev 3 §5" (l.732). Sources are plain text. Fix: a one-line gloss per
  lane and gate, and links.
- **L10. Native draft parity.** §5.6 says native compose "owns drafts", but the 64 KiB ×
  32 bound, closed-tab retention and survival across a content-process restart are
  specified only for the browser. The contract wants the same semantics. Fix: state
  the native store's rules or require parity in W5.
- **L11. Lane gaps.** W5 feeds no gate in the flowchart, and the build plan schedules
  native as P4 after P3. Browser `uploads`, `clipboard` and `links` have no owning lane
  (W0's list is boot, transport, lifecycle, storage and viewport). Fix: assign them and
  add W5 → G3.
- **L12. Maintenance.** §8.1 weighs bytes and compat but not maintenance: owning a
  dialog, sheet, roving list and focus return means owning their a11y regressions.
  Fix: one line naming the a11y test (axe and keyboard Playwright) that keeps that
  cost bounded.
- **L13. Pasted-image bound.** `uploads.send(host, files[])` has no cap, against plan.md
  "Bounded everything" and the daemon's single upload slot. Fix: take the first image
  only, or queue at most N with a stated refusal.

## Hypotheses (not verified)

- **iOS Backspace on an emptied owned textarea.** §7.3 empties the element after each
  commit and maps `deleteContentBackward` to `BSpace`. iOS soft keyboards may fire no
  `beforeinput` for Backspace in an empty field, which is why native uses `hasText`
  `true`. If they don't fire, Backspace stops working on the phone. *Blocked:* needs a
  real iPhone. Suggest adding "Backspace on empty" explicitly to the §11 gate, with a
  sentinel-character fallback.
- **Hardware key double delivery on phones.** §7.3 routes hardware keys through
  `keymap.ts` from `keydown` while `beforeinput` also handles text. If `keymap` doesn't
  stop printable keys, they could arrive twice. *Blocked:* the design doesn't say which
  keys `keydown` consumes, and it needs a device to test. Ask the design to state it.
- **What `/auth/node/session` answers on the native lane.** H3 assumes it reports
  native-lane state through the token-injecting dev proxy. Rev 4 doesn't say. *Blocked:*
  not specified and not built.
