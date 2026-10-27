# Decision log cleanup

- **Lines:** 5,071 → 3,483 (1,588 fewer).
- **Entries:** 299 → 225. The original 273 third-level entry headings become 205; the count also includes 26 → 20 standalone second-level decisions. Section headings are not counted as entries.
- **Scope:** retained all 15 decisions dated 2026-10-27 and the 2026-10-27 host-origin amendment. Consolidated partial supersessions into the rules in force; retained Jimmy’s words, material rejected alternatives and external evidence. Removed build/review bookkeeping and provenance IDs.
- **Links:** changed the link in `docs/design/research/one-keyboard.md` from the removed dock entry to the surviving one-keyboard decision. Removed an internal link to the merged shutdown entry.
- **Verification:** `meridian kg check docs/design --strict` passed (37 files, 719 links); `grep -rn "decisions.md#" docs AGENTS.md` and an independent fragment-to-heading audit found no broken decision anchors. Heading inventory confirms every removed or renamed original heading is listed below. `git diff --check` passed. This is documentation-only; no runtime tests or changelog entry were required.
- **Bell correction:** the current 2026-10-27 entry accepts limited local `list-sessions` polling; its contradictory old rejection of the same polling was removed without changing the accepted rule.

## Removed, merged and renamed headings

Every original heading no longer present is listed in its original order. A merged heading names the surviving decision that received its remaining material; a renamed heading preserves its current rule under a clearer name.

- **Tabs: one per tmux window** — Merged → One tab per session, like `tmux attach`: Replaced by session-following tabs.
- **Scope: no agent status or notifications** — Renamed → Scope: no agent dashboards or notification service: The current bell attention dot is not an agent dashboard or notification service.
- **AGENTS.md states principles; the specs hold the rules** — Merged → Invariants are separate from decisions; test tmux 3.4 and 3.8: The current invariants and product rules are recorded in the redesign decision.
- **Completion is HTTP, and cwd comes from tmux** — Merged → The request is `{before, after, cwd}`, and a chip only extends what is typed: The later request contract retains HTTP and tmux fallback.
- **A Release invalidates snapshot attempts** — Merged → A released snapshot is answered `Released`: The later answer contract retains invalidation and gives every attempt an answer.
- **Locate and a single owner per watched window** — Merged → The daemon follows the window; the client never re-watches: Window-owned views were replaced by session-owned views.
- **How ownership and Locate interact** — Merged → The daemon follows the window; the client never re-watches: Window rebinding was replaced by a fixed session owner.
- **The pump's file is `pump.rs`** — Removed: One-off filename reconciliation with no independent tradeoff.
- **The listing and creation formats** — Merged → One-shots are arguments, not command lines; `NewWindow` carries the server instance, and tmux checks it: The current listing format preserves tmux name constraints and creation checks the server instance.
- **Sizing: client size at attach, a vote per watched window** — Merged → The client size is set at startup; Whoever acted last gets the window's size: The attach-size rule stays; standing per-window votes were replaced by acted-last claims.
- **Watches: client-chosen ids, targeting a window** — Renamed → Watches use client-chosen ids and target a session: The session target replaced the window target; id reasoning is unchanged.
- **Backpressure: one budget, starve every watch, pull snapshots** — Merged → Credit-based flow control per connection: Replaced by per-connection byte credit and per-watch starvation.
- **Wedged closes with 4002** — Merged → Credit-based flow control per connection: The credit decision already specifies this close and the condition.
- **Paste buffers: a window check first, a separate delete on failure** — Renamed → Failed paste groups clean up tmux buffers: The proposed leading window check was rejected, not retained.
- **`Session::new()` takes no session id** — Removed: The current constructor requires the attached session id.
- **Notification choices in `Session`** — Renamed → A zoomed pane uses the visible layout: Keep the tmux layout constraint, not the build-era notification list.
- **Caps sized for the memory ceiling** — Merged → One memory budget sizes daemon caps, checked against the unit: Fixed caps were replaced by a user-selected, measured budget.
- **A window binds only from its owner's own Locate answer** — Merged → The daemon follows the window; the client never re-watches: The ordering constraint applies to the session owner, not a moving-window owner.
- **One reporter per endpoint for renames and session changes** — Merged → One reporter per endpoint coalesces session-change hints: Merged with the per-input listing hint; renames are no longer broadcast.
- **The stream is part of the window; `state.rs` is split three ways** — Renamed → The stream is part of the session view: Keep the state-ownership tradeoff after the move to session views.
- **Connection API details** — Merged → Credit-based flow control per connection: The discarded-frame credit rule belongs with flow control; the remaining items are API bookkeeping.
- **One generated TypeScript file, rendered by a test** — Merged → ts-rs for TypeScript, hand-written Swift: Type generation belongs with the choice of ts-rs.
- **Two watches on one connection snapshot one at a time under load** — Merged → Credit-based flow control per connection: Consequence of the credit and reservation sizes, not a separate choice.
- **An unwatched window's close broadcasts `sessionsChanged`, once per input** — Renamed → One reporter per endpoint coalesces session-change hints: Express the current session-view reporter, not the obsolete watched-window distinction.
- **`Starting` is folded into `Locating { after, on }`** — Removed: The session-view state model replaced these window phases.
- **Other moves of the hub refactor** — Merged → Reconcile runs only after inputs that may change desired state: The measured snapshot-spacing timer tradeoff is retained; pure moves are bookkeeping.
- **`dir` on `newWindow` and `newSession` passes through until `src/fs/` exists** — Merged → `dir` on `newWindow` and `newSession` is checked for shape, not roots: Temporary pass-through was replaced by a directory shape check.
- **`tether serve` is Linux-only for now (superseded)** — Merged → A Mac can host tether, behind a path secret: Replaced by the Mac front; the unauthenticated Mac alternative remains rejected.
- **Shutdown waits for the hub's pumps** — Merged → `main` stops the hub explicitly at shutdown: The explicit stop decision includes waiting for the pumps.
- **The paste directory is emptied after the port is bound (superseded)** — Renamed → Paste cleanup follows the runtime lock and socket binds: Keep the paste-file safety rule, expressed with the current runtime.
- **Bridge cleanup** — Removed: Obsolete bridge and module-change inventory; current input and upload paths have separate decisions.
- **Native input and accessory** — Merged → One keyboard: native owns line editing, web mirrors it: Native line editing and the web dock replaced the accessory and bare-input design.
- **Native keeps the saved tab list** — Renamed → Native persists the web-owned workspace: The current bridge saves a workspace rather than a window-tab list.
- **A host entry carries its base URL** — Merged → iOS Link resolves the socket without exposing host routing in page state: Native stores the URL privately; the web resolves the socket through native.
- **`boot.tabs` is `SavedTab`, and `settings` is a free record** — Removed: Old window-keyed boot shape is replaced and the initial untyped-settings pick is bookkeeping.
- **Native persists which tab was active** — Merged → A clean launch opens Home: The redesign opens Home on a clean launch, rather than restoring the active tab.
- **Tab titles follow `windowRenamed`** — Merged → The daemon follows the window; the client never re-watches: The session-following view reports its current window name in `watching`.
- **The keyboard pan belongs to the renderer and follows the cursor** — Merged → The keyboard pan keeps the terminal bottom visible unless that would hide the cursor: The bottom-first pan replaced cursor-only anchoring.
- **The suggestion strip pans the terminal like the keyboard and never resizes tmux** — Merged → The keyboard pan keeps the terminal bottom visible unless that would hide the cursor: The bottom-first pan retains the no-keyboard-resize rule.
- **Keychain: one item for every host** — Renamed → Keychain: one item for all hosts: The Keychain decision uses one item containing the host-token map.
- **The auth error codes and `/auth/info.name`, as built (error contract superseded)** — Merged → Shared HTTP error contract: Build inventory and superseded error contract; the shared contract is recorded separately.
- **The startup Funnel check reads LocalAPI (superseded)** — Merged → Browser authentication: enrolled tailnet nodes: Startup refusal was replaced by request-time canonical-origin admission.
- **The file API's limits, socket buffers, and the memory ceiling** — Renamed → Socket buffers are bounded on the local Serve hop: Keep the independently measured kernel-memory tradeoff; blocking limits live in their own decision.
- **Raw drops the page cache from the response start** — Merged → Raw: single Range, strong ETag from `stat`, exact length, no `304`: The later drop range and its measurement are part of the raw-response decision.
- **Uploads flush every 2 MiB, and the ceiling counts them** — Merged → Uploads: raw body, server-chosen UTC name, part file then no-replace rename: The current interval and measured reason belong with the upload decision.
- **Codes the file API's spec left open** — Merged → Uploads: raw body, server-chosen UTC name, part file then no-replace rename; Listings: one scan per page, sorted, paged by offset, nothing kept: The security-relevant no-replace and scan bounds belong with their decisions.
- **`fs::open` takes a `Scope`; `Want::Parent` waits for v2; `slots.rs` is a module** — Removed: Local type and file placement, including an unimplemented v2 case.
- **A symlink out of the roots is listed with its target's size and mtime** — Merged → Roots are a scope; the `$HOME` picker shows directory names only: The symlink listing decision is a consequence of roots being a scope.
- **macOS file paths are written but untested** — Removed: A build-status note without a design decision or rejected alternative.
- **Completion takes two blocking slots, and the unit pins glibc's mmap threshold** — Renamed → The unit pins glibc's mmap threshold: Keep the allocator constraint; blocking lanes own slot allocation.
- **Completion, as built** — Merged → carapace: run per stem, latest wins, 30-second cache: Build inventory; the meaningful cached-key behavior is folded into its runner decision.
- **History scores at most 12,000 distinct lines** — Merged → History: one file, parsed into a cached index, ranked by entry age: The memory cap and ranking proof refine the history index.
- **Parser errors are logged by kind and position, never by message** — Merged → Logs carry framing metadata only: The completion parser is another instance of the no-content logging rule.
- **Documentation** — Removed: Its only entry was removed; no separate section remains.
- **Specs state the current rule; this log keeps the history** — Merged → Decision log: The new header states the current-truth log rule.
- **No shared base32 helper** — Removed: A one-off helper placement choice without an enduring external constraint.
- **W0 design-system refinements** — Removed: Design-system build-round list; the current client spec holds the visual rules.
- **Home, picker and Settings details** — Merged → Home is server-first, with Settings behind a gear: Build-round list; the redesign makes Home server-first and owns the current interaction rules.
- **Add folder in Files** — Merged → Add folder becomes the path field: The path field replaces the dialog while keeping Jimmy's requirement to add roots in-app.
- **G2 fixes to the rebuilt web client** — Merged → Keep Mermaid in the Markdown viewer; The PWA is built by the Vite plugin; Input, paste and inserted paths name the window the tab showed; Terminal and desktop input details: Security, cache and request-deadline reasoning is retained with its owners; the review-fix list is removed.
- **Native screen coverage pauses the terminal watch** — Merged → Native lifecycle messages are full snapshots: The complete lifecycle snapshot carries coverage into the single watch predicate.
- **Phone input follows Termius: one keyboard toggle, a dock, a one-line field** — Renamed → Phone input and keyboard: The redesign has a keyboard control and compose layout, not the old one-row dock.
- **Only the keyboard toggle opens and closes the keyboard** — Merged → The terminal long-press selects at once; arrows are keys; a tap near the cursor opens the keyboard: Taps near the cursor now open the keyboard.
- **The phone dock: one row at rest, the key row with the keyboard** — Merged → Phone dock: current tab at rest, compose above keys when typing: The redesigned dock changes both resting and keyboard-up layout.
- **The key row's keys, and arrows by long-press** — Merged → The terminal long-press selects at once; arrows are keys; a tap near the cursor opens the keyboard: The arrow pad and omitted horizontal arrows were replaced by selection and arrow keys.
- **The tab chip opens one session switcher** — Merged → Sessions and tabs share the phone sheet; desktop uses a popover: The redesigned sessions sheet and desktop popover replace the old switch-and-dismiss sheet.
- **Two keyboard openers, one closer, with Termius's focus cues** — Merged → The compose box and terminal make focus visible and switchable: The redesigned compose field is not present with the keyboard down; current focus cues remain.
- **One code per phone: the browser enrols the node, the app mints a token** — Merged → A setup link belongs to the app, so Safari never enrols: The app now spends the code on node enrollment and then mints its token.
- **Add server separates the code and device name; the app handoff finishes itself (superseded)** — Merged → The app handoff prefills the form and waits: Automatic handoff was reversed; the manual two-step and native field remain.
- **No predictions on the line field** — Merged → One keyboard: native owns line editing, web mirrors it: The outcome is retained using native text-field traits, not WebKit overrides.
- **Line field auto-capitalization is off** — Merged → One keyboard: native owns line editing, web mirrors it: The native text-field decision retains the no-capitalization reason.
- **The dock is web, in every touch client** — Merged → One keyboard: native owns line editing, web mirrors it: The shared web dock and native editing split are one keyboard decision.
- **Native lends the line field to WebKit by touch location** — Merged → One keyboard: native owns line editing, web mirrors it: A single native responder replaced WebKit lending.
- **What the toggle raises, and where key-row keys go** — Renamed → Keyboard control and key-row routing follow the focus target: Retain the routing decision with the redesign’s compose and Escape behavior.
- **The keyboard spike is retired** — Removed: A build-spike deletion and verification checklist migration.
- **Vocabulary: dock, tab chip, line field, key row, keyboard toggle, switcher** — Removed: Terminology inventory restated by the client spec and partly replaced by the redesign.
- **A window sized for another terminal is clipped, not scaled** — Merged → The band shows whenever the window isn't at this screen's size: The current band covers both larger and smaller windows; clipping and renderer evidence are retained.
- **Restore the existing iOS auth and background policy** — Merged → Keychain: one item for all hosts: One Keychain item and the background lifecycle belong with the Keychain choice; relock timing is selectable.
- **P3b touch state is per shown tab, in one object** — Renamed → Touch state belongs to the shown tab: Keep the state-ownership decision without the build-round label.
- **P4a round-two review: gate focus, validate keys, and bind revocation to its token** — Merged → Track expected token-item state without storing credentials in app preferences; Native lifecycle messages are full snapshots; Input: hex for text, names for keys: The token race, native cover gate and key-name constraints are retained with their respective decisions.
- **P3b round 2: the snapshot window, anchors, one shown rule** — Merged → Touch state belongs to the shown tab: The history anchor and shown-tab ownership rationale are retained without the review-fix list.
- **tether never removes its Serve entry** — Renamed → The daemon never unpublishes; teardown removes its handlers: Separate daemon exit from the explicit teardown operation.
- **Automatic setup uses only `~/.cargo/bin/tether`** — Removed: Embedded service-file location and templating bookkeeping, with no independent product tradeoff.
- **Mac background setup refuses a second login account** — Merged → A Mac host has one user account, Jimmy's: Enforcement of the one-account Mac precondition.
- **`/auth/info` reports `browserPending`** — Removed: A field-level setup implementation choice restated in the spec.
- **Teardown removes tether's Serve handlers** — Merged → The daemon never unpublishes; teardown removes its handlers: Teardown and the daemon's non-unpublish rule are one publication-lifetime decision.
- **Setup's prompts, clipboard and QR** — Renamed → Setup prints privileged commands and copies links with OSC 52: The QR and code-bearing link live with the fragment decision.
- **Setup keeps platform policy behind one boundary** — Removed: Code-organization inventory from setup review.
- **A claim names a window and moves only by tether's own act** — Merged → Claim targets and shown windows have different lifetimes: The later claim-target model replaces a stored window while retaining acted-last and select-then-take.
- **The window switcher: the phone's session sheet, the desktop's active pill** — Merged → Terminal tabs continue to follow the current session window: The redesign keeps session window switching but makes the one-window control and exact UI open.
- **Protocol 2, bridge 3, and the old saved workspace is dropped** — Renamed → Session watches require protocol 2: Retain the protocol and workspace migration tradeoff without an obsolete bridge version.
- **New session-follow checks are temporary verification** — Removed: Task-specific test procedure, not a lasting system decision.

## Uncertain entries retained

- **launchd’s socket is taken by a local module, not the `raunch` crate** — near the line for implementation trivia, but it records an actual dependency alternative, ownership/`unsafe` constraints and an observed edge case.
- **How the composer is tested** — mostly test procedure, but the rejected single-oracle approach and the modes that `vt100` cannot observe explain why the xterm cross-check is required.
- **Reserved credit stays a counter, with a debug check** — implementation-specific, but measured hot-path costs explain why the simpler derived alternative lost; `daemon-core.md` links to it.
- **One real-daemon e2e stack** — test infrastructure rather than product design, but it records why the browser needs a Serve stand-in and why an identity override in production was rejected.
- **Defer the Debug dev-server asset source** — a deferral, but retaining it records the unreviewed origin, certificate and CSP boundary rather than implying the native development server is safe.
- **Native persists the web-owned workspace** — the custom-scheme storage-survival hypothesis remains unverified, so the recovery decision and uncertainty remain visible.
- **Tailscale first, public HTTPS follow-up** — retained as Jimmy’s earlier possible direction, not an approval of public access; the entry explicitly preserves the current tailnet-only boundary.
- **The unit caps CPU at half a core, metered every 10 ms** — overlaps the memory-budget entry, but keeps the measured latency tradeoff and Jimmy’s hard-cap product requirement together.

The original build records did not name an individual decision-maker for several P4a/P3b review choices; those entries retain their date without assigning an unrecorded owner.
