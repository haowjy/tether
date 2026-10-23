# Tether browser and mobile interaction contract

Status: approved interaction contract; implementation is staged across browser and native lanes, and the device-specific gates below remain. This contract supersedes conflicting navigation/layout rules in the earlier plan. The local compose requirement is recorded; its visual design and touch implementation remain to prototype. See [README.md](README.md) for precedence and Mac setup.

Interactive mockup: [mockups/index.html](mockups/index.html). All sessions, terminal text, files, and creation are fictional; reload resets mock data. This mockup never connects to tmux. Do not use a live server with personal sessions for input probes.

## Product boundaries and vocabulary

- Phone browser must support installation as a PWA with standalone launch; installation is optional for use, not for implementation scope. It shares browser behavior, preserves local drafts offline, and never queues terminal commands for later execution. See [browser setup](browser-setup.md) for research and gates.
- Three environments: desktop browser, mobile browser, native iPhone app. Shared workspace behavior; platform-specific navigation and input. No three independent terminal implementations.
- Host is the server, e.g. pop-os. Session is a real tmux session, e.g. a1 or bio2. A session contains windows. A tether tab opens one tmux window, showing its active pane as in the existing daemon contract.
- Home and picker show actual session names grouped with their windows. Terminal tab label is `session / window` (include actual index when window names collide); host is separate context. Mock names tether, notes, website, scratch demonstrate hierarchy only.
- Minimal initial product. No custom shortcut system, command palette, expanded desktop sidebar, split-pane management, SSH/SFTP/serial connection choices, or app-drawn keyboard.
- Existing-session selection must be clearly distinct from session creation. Opening an existing window never creates another shell. Closing a tether tab never kills its tmux window, session, or process.
- Connecting may resize a real tmux window. The setup must not suggest tether is read-only or isolated when connected to the user's server.

## Platform layout

| Surface | Desktop browser | Mobile browser / iPhone app |
| --- | --- | --- |
| Primary navigation | Persistent 56px icon rail: Home, Terminal, Files. Active destination highlighted, titles and accessible labels. No expandable sidebar. | Home has bottom Sessions/Files navigation. Full-screen terminal has no rail or Home header. |
| Terminal navigation | Single top row: open tabs with close icons, +. No redundant back arrow or keyboard button. | Single bottom row: back arrow, horizontally scrolling tabs with close icons, +, keyboard icon. |
| Terminal area | All available space beside rail and below tabs. | Remaining area above the compact toolbar and any actual keyboard. |
| Session picker | Centered modal over current terminal. | Tall rounded sheet over current terminal. |
| Keyboard | Direct physical-keyboard input; no separate developer textarea. | Browser: ordinary system keyboard, accept browser limitations. App: native input integration; not built by this mockup. |

Safe areas and browser chrome are real platform constraints, not fake padding or simulated keyboards. Production must use measured visible viewport and prevent controls from being obscured. The mockup shows keyboard-hidden layout only. Mobile controls target at least 44px; current terminal row is 53px before device safe-area allowance. Names truncate rather than widening the screen; tab row scrolls horizontally.

## Visual treatment

- Semantic colours provide light and dark values. Dark is the default; light follows
  `prefers-color-scheme` unless the platform sets an explicit scheme on the document.
- Blue is the selection/accent channel; green is reserved for connected status. Selected
  navigation and rows use a blue-tinted fill and weight, not green text. Connection
  state remains visible on its own label and never relies on selection color.
- The phone picker sheet uses the current theme's raised surface: dark with the dark
  theme and light with the light theme. It is not permanently light.
- The phone toast floats above the bottom toolbar so it cannot cover the tabs.
- On desktop, Home is a centered column with width `min(720px, 100% - 2 gutters)`.
- Tab labels preserve the window portion before the session portion; a fade at the
  scrolling edge signals clipped content. Icon-only rail and toolbar controls have
  accessible names and tooltips on hover and keyboard focus.
- Interactive controls share a 2 px focus ring with a 2 px offset. Spacing, type,
  radii and icon sizes use one scale per property; icons are 16, 20 or 24 px.
- Loading, empty, offline, error, refused-session, enrolment and permission states are
  distinct; failures must not look like empty content. Reduced motion shortens the
  duration tokens. Do not globally force transitions to 1 ms, which animates theme
  changes and makes contrast checks timing-dependent.

## Home: Sessions

Initial entry opens Home. Sessions is the initial Home destination. Desktop Home icon selects this screen; mobile back from terminal selects it.

1. Open tabs appears first. Row label is session/window. Tap or click opens the existing tab, not a duplicate. Its close icon removes that tab only. No destructive tmux action is exposed. A tab restored from the saved workspace reads “Checking…” until a listing proves its window, or “Reconnecting…” while the host is unreachable.
2. Find a session filters available groups by session OR window name, case-insensitively. Groups start collapsed. Explicit expansion choices survive navigation and filter changes; matching only a window temporarily expands its parent and shows matching windows. Clearing search restores explicit expansion state. It does not hide Open tabs. Empty result says no matching sessions. Filtering is local; do not poll tmux per keystroke.
3. Existing sessions appear under host context, with name and window count. Session row toggles an accordion. Count reads “N windows” (singular for one), not a bare number. Windows are indented underneath as “index: name”, with no drill-in chevron. Home and picker use the same row renderer. Already-open windows are marked Open. When the server reports attachedElsewhere, show “Another terminal is attached. Opening may resize it.” Do not invent a device identity such as laptop. Selecting one opens or activates its tether tab and enters terminal view.
4. The labelled “+ New session” button next to the available-session heading creates a NEW session; it is a separate action from opening an existing window. Prompt for name, allow cancellation. Creation succeeds into its first window. Inside each expanded Home session, a text-labelled “+ New window” row creates a new window in THAT session. Both creation forms offer an optional start directory, defaulting to tmux’s default. Picker plus remains attach-only; creation stays on Home. Name is optional; blank lets tmux name the target. Mockup generates an illustrative unique name and rejects duplicates for its simplified name-keyed state; it does not impose production name validation. Real server validation remains authoritative. The new tab opens from the next listing that holds the created window; if it has not appeared after 5 seconds the form says it was created but is not in the list yet. A refused start directory shows the daemon's message in the form. Start directory is optional absolute-path text with feedback; production verifies existence and authorization, and blank uses tmux default. A roots picker is not needed for this minimal pass.
5. Settings is the last row of Home. It opens a dialog (a sheet on a phone) with Remove this device, only where the host admits this device as a tailnet node; Clear local data, which deletes drafts and the saved workspace on this device and leaves open tabs until they are closed; and, on a phone that has not installed the app, the Add to Home Screen steps. Each destructive action confirms in its own overlay, so Back returns to Settings.
6. No open tabs: show a short prompt to select an existing window, not a fake default session. No sessions/server: expose that state and retry; tether never starts the tmux server automatically. Network failure and empty server must be distinct in production.

## Terminal

- Selecting a tab activates it; other tabs remain open. Opening a window already represented by a tab activates that tab. Implementation identity must use server/window IDs, not mutable display names. Opening or activating a tab enters Terminal through the router; desktop focus lands on the terminal after that screen is rendered.
- Closing an inactive tab leaves the active tab unchanged. Closing the active tab activates its right-hand neighbour, or the left-hand neighbour if it was last. Only the active terminal pill shows a close icon; all tabs can also be closed from Home. Active pill is scrolled into view when activated. Closing the last tab returns Home. The close icon never sends a kill command. Closing the last tab focuses the Home search on desktop; creation-dialog cancellation/Escape restores focus to the exact control that opened it.
- Desktop Terminal rail icon returns to the last active tab. With none, it opens the session picker; dismissing leaves an explicit empty terminal state with the toolbar/+ still visible, and Home remains available. Empty copy says “Open a window with + or from Home.”
- Mobile back returns to Home, preserving open tabs and active selection. There is no desktop back arrow because the rail already provides Home.
- Plus directly opens Open session picker. There is NO intermediate menu and NO Files action in this picker. These were tried and explicitly removed.
- Files is reached from Home on mobile or the desktop rail. Returning to Terminal preserves active tab and the running process.
- Terminal output is not editable mock text masquerading as live input. The prototype says it is sample content and sends no input.
- Connection status uses color on the tab and host label, not a dot: green for connected and amber for reconnecting. Active-tab shape/background and accessible state labels remain distinct from connection status; visible reconnect/error text prevents color from being the sole signal. Active-tab reconnecting state also appears as a compact overlay on the terminal, with Retry, so it does not disappear when the pill is clipped. The mock connection-state selector is outside the app and only demonstrates this appearance.
- Real connection states inherit the existing reconnect contract: disconnect does not silently close tabs; reconnect/error appears with the affected tab; viewing Home/Files must not kill tmux.
- Scroll behavior, paste, mouse handling, focus delivery, reconnect, server identity, tmux geometry ownership, and keyboard viewport behavior require implementation-phase verification. No claim of those working is made from static mockups.

- Desktop keys go to tmux by name: Shift+Enter sends the modified-Enter bytes once, and IME composition sends nothing until it ends. Cmd combinations and F5, F6, F11 and F12 stay the browser's on every platform; Ctrl+Shift+C copies the selection as logical lines on every platform. Keystrokes are batched for 8 ms into one input message.
- Paste sends one paste message and is refused over 256 KiB, saying so. An image paste uploads, then types the quoted path into the tab it was pasted in, if that tab is connected when the upload ends; otherwise a notice says the file is in Files.
- A tab the daemon refused for its session limit reads “session limit” in the error colour, shows the daemon's message and Retry, and retries with a growing delay. Retry asks at once and keeps the delay.
- The terminal stays blank until the shown tab's own snapshot paints, so another tab's content never sits under a pill that is not its own. tmux is never sized before the renderer has measured a cell.

## Open session picker

- Opens above the current terminal, leaving terminal selection intact underneath.
- Shows heading, close icon, search, host context, and available session groups/windows using the same hierarchy as Home.
- Session accordion expands inline; window row selects/activates a tab and dismisses picker. Search filters session and window names using the same rules as Home. No matches has explicit feedback.
- Close icon, outside click/tap, or Escape dismisses without changing active tab. Desktop focus returns to terminal input (or + if empty); mobile focus returns to + without automatically raising the keyboard. Selecting a window focuses terminal input on desktop. Modal focus is trapped within picker.
- Desktop auto-focuses search. Search is not auto-focused on mobile so opening the picker does not immediately consume screen space with the keyboard. User taps it when needed.
- Existing tmux sessions are the default content; user need not create a new session to connect.

## Files

- Opens the current folder as a list. Returning from terminal preserves folder/preview context.
- Folders open their contents, not an accordion. A parent-folder control moves up; at the configured root it is absent. Path context identifies where the user is.
- Files open a preview. Back from preview returns to its containing folder. The prototype includes sample folders and text previews, not real FS access or format rendering.
- Matching navigation treatment: same row height, padding, leading icon position, text size, metadata alignment, trailing chevron, and hover/focus treatment as session rows.
- Different semantics remain visible: session disclosure chevron rotates down when expanded; folder chevron points right to drill in. Both share aligned leading icon/text/metadata positions, while indented window rows use a terminal glyph and no chevron. Files/folders are not falsely presented as expandable trees.
- Roots are listed first, each with a Remove button that asks first ("Remove this folder?", nothing is deleted from disk) and a Remove-less Uploads row. "Add folder…", under the list and in the empty state, opens a dialog (a sheet on a phone) that browses directories only from `$HOME`, one folder at a time with an Up button, "Show hidden folders" and Show more; "Add this folder" is disabled, with its reason, at `$HOME` itself (the daemon refuses it) and for a folder already added, and a daemon refusal (outside `$HOME`, a read-only `config.toml`) shows in the dialog in plain words. Both dialogs are router overlays: Back, Escape and the backdrop close them, and focus returns to the control that asked (Add folder… when a removed row's button is gone). Moving the uploads folder still happens in `config.toml` on the host; the list says so. The Files rail button and Home's Files tab return to the last folder or preview; the in-app back button goes up one place, and the browser's Back returns to the previous one without a new request when its folder is still loaded.
- Folder rows show an icon, name and chevron; file rows add a size. A link that cannot open says why (“Broken link”, “Not a file”) and is disabled. A folder past the daemon's scan cap says it is too big to list in full. Further pages load as the end of the list nears the screen, with “Show more” as the fallback. Hidden files are behind a quiet toggle under the list.
- Previews: code (14 grammars, plain text for the rest), Markdown (relative links open the file here, web links go to the browser, an address link hands off to the mail app; the document is cut down to an allowlist of prose, lists, tables, code, links and images, and no click inside it navigates the page itself), images (zoom and pan), video and audio (inline in the browser; native keeps its own player), and binary files (“Open as text”).
- Loading and failure never look like an empty list: a spinner with words, or the refusal in plain words with “Try again”.
- Root selection, permissions, size limits, and error handling remain governed by existing fs spec. Upload/path insertion route is specified below. They are not redesigned or claimed complete in these layout mockups. No delete/move/rename controls are added.

## Persistence and input

- Navigation between Home/Terminal/Files, sheets, and tabs preserves open tabs and process state. File context is retained within the preview session.
- Home/list refresh runs on entry and on debounced sessionsChanged while visible; there is no polling or network search per keystroke. Fetch on picker open and reconnect, and prune tabs only from authoritative listings for the matching host and tmux endpoint. A listing from the same endpoint decides all that endpoint's tabs, including live tabs: matching windows from the same tmux run remain; a different run at that endpoint closes the old run's tabs. A scratch endpoint is never touched by the main-endpoint listing, and a null listing (no server) decides nothing. One notice reports closures. The hub serializes one-shot requests and answers an overlapping request with `busy`, so a listing cannot straddle a window-creation reply. Explicit user retry handles list errors.
- Production restores tabs after reload using validated window identities. An unavailable window must not be silently replaced with a same-named window from another server.
- Mockup state is deliberately in-memory. Changing preview-platform selector is a presentation-only reset to Home, not a production control. Full reload returns fictional defaults.
- Mobile browser keyboard button focuses browser terminal input, relying on the ordinary keyboard. It does not add a custom keyboard, voice/AI controls, Esc/Ctrl/Alt, or shortcut rows. A separate ordinary multiline local draft editor is available while the software keyboard is open, in both mobile browser and native app. Enter edits the draft; explicit Insert sends it through the terminal paste route without an added Enter. Hiding the keyboard preserves the local draft. Native app keyboard ownership remains native. See terminal-interaction-design.md for persistence, target identity, focus, and device-verification requirements; the current mockup still shows keyboard-hidden layout only.
- Tab display keeps the window portion (plus index for duplicate window names) visible before spending width on the session portion; long session names truncate first. Full combined name is the tooltip and accessible label. Use the actual tmux window index, not array position; mock indices are illustrative. The server/window identity, not index or label, owns tab state through renames.
- Icon-only toolbar and rail controls have accessible names/tooltips. Home's two bottom destinations retain small Sessions/Files captions; data and menus use text. Disabled controls must explain why; loading/error states should not look like an empty list.

## File upload and path insertion

Keep the existing MVP outcome without adding Files to terminal +. In Files, upload uses the browser/native file picker into the configured uploads folder. Several files may be picked at once; one uploads at a time and at most four are held, and a fifth is refused with “Wait for the current uploads to finish”. A file over 128 MiB is refused before it is sent. Completion adds a row to the list, with progress while running, then the saved name, “Insert path into <active tab>” and Preview; the screen does not navigate away from the folder. A file preview has the same insert action for existing files. The action inserts a shell-escaped absolute canonical path into the named active tab without Enter, then returns to that terminal. It never executes the path.

When there is no eligible connected tab, insertion is disabled with “Open a terminal tab first”; files still remain accessible. If the target disappears or disconnects, insertion fails visibly without sending into a different tab: the action is disabled while the target is reconnecting, refused for the session limit or closed, and a path still waiting for its watch is dropped with a notice if the watch fails. A tab that is still connecting, or live but not on screen, takes the path and types it when it is watching; the one eligibility rule is the driver's, shared by Files and image paste. A name holding a control character (CR, LF, ESC, ^C) is never inserted, because typed into a pane it would submit or act as a key; the notice sends the user to the terminal. The target ID is captured on click, not selected by matching its name. User can return to Terminal to select a different tab and return to Files; preview context remains. Upload itself and actual bytes/path insertion are not implemented in this mockup; the existing-file preview action demonstrates the return route and reports simulated insertion.

Browser image paste into a focused terminal follows the same upload pipeline. Capture the exact target tab/window identity at paste start, upload supported image bytes into the configured uploads folder, then insert the quoted absolute canonical path into that same tab without Enter. If the target is gone or disconnected when upload completes, keep the uploaded file available in Files and report the insertion failure; never redirect to a different active tab. Ordinary text paste remains terminal paste. Clipboard access depends on a user paste gesture and browser capabilities; unsupported image clipboard access gets an explanation and the Files upload route. This preserves the photo-paste MVP; actual clipboard handling remains a real-browser verification gate, not simulated by this mockup.

## Offline and updates

The service worker serves the shell from its cache, so an offline launch opens Home: the host banner says “Can't reach pop-os” (the name is the last one saved), open tabs read “Reconnecting…”, and the listing shows its offline state. Nothing shows a pretend live terminal and nothing typed is queued. The worker never intercepts `/ws`, `/auth`, `/fs`, `/complete`, `/debug` or a non-GET request.

A new build installs in the background and waits. Home and Files show “Update ready” with Update, never over the terminal; only the window that taps Update reloads. Another window shows “Reload to finish updating” with Reload, and keeps running its own build until then. A window two builds behind fails to fetch a lazy chunk and shows the designed “Update required”.

## Keyboard ownership and navigation history

Desktop terminal focus owns keys only while terminal input is focused. Home search, creation forms, and Files controls own their own input. Overlay handling intercepts Escape only while an overlay is open; otherwise Escape belongs to terminal input. Tab activation, terminal return, and overlay dismissal restore terminal focus on desktop. Focus must not steal input from a focused text field. Only focus that must raise the software keyboard needs to happen synchronously inside the user's gesture. Other focus transitions may wait until navigation or the dialog has rendered; a phone dialog must not focus a text field and unexpectedly raise its keyboard.

Accept browser-reserved shortcuts rather than adding a custom shortcut system or promising interception. Which combinations reach the page must be probed in Jimmy’s browsers before shipping; this contract does not claim an exhaustive reserved-key list. Browser/site navigation must never be intentionally hijacked to mimic a native terminal.

The mobile browser’s ordinary on-screen keyboard may not expose Esc, Ctrl-C, Tab, or arrows. No custom strip is added in this pass. This limits terminal tasks from a touch-only browser; a physical keyboard or native app provides richer input. Do not claim it is impossible to interrupt a process on every browser/device, nor silently add controls against this scope decision.

Proposed browser history rule: Home/Terminal/Files transitions, folder drill-in, preview, and modal opening create reversible navigation entries; Back closes the top sheet/preview before leaving its parent destination. Opening or switching terminal tabs does not add browser history entries. Back must not kill a tmux session. Real history/swipe behavior remains an implementation gate; the static prototype uses explicit back/close controls only. Native shell follows the same logical hierarchy without browser URL history.

## Review scope and implementation gates

Review the whole proposed interaction system, including usefulness, visual consistency, accessibility, naming, navigation state, missing behavior, and conformance to Jimmy's reference screenshots. Do not mistake mockup code for the proposed production architecture.

This contract changes the original native-only product direction; plan.md and
decisions.md record the current direction. Browser admission and static-shell rules are
specified in [auth.md](../auth.md) and [browser setup](browser-setup.md). The web client
is being implemented in stages, so a mockup or skeleton does not certify production
behavior. Keep the dev proxy's injected owner identity out of production auth, and never
expose the test harness as a released client.

Mockup approval is not production verification. Test real desktop input, phone-browser
keyboard/viewport behavior, and the native app on hardware separately. Coherent reviewed
commits go directly to `main` after the required preflight; there is no PR flow during
the initial build.

## Visual copy rule

Do not use middle-dot separators in app chrome, labels, headings, or descriptive copy. Separate metadata with layout/spacing or write a short phrase. Do not use dot-shaped status markers either. Use color on existing labels/tab surfaces, with text for reconnect/error states and accessible connection labels.

## Text clipboard behavior

Proposed browser copy preserves logical line breaks, not terminal soft-wrap boundaries. Paste preserves multiline clipboard text through the existing paste protocol; it is not converted into a sequence of Enter key events, and plain paste does not append an extra Enter. The daemon already uses load-buffer then paste-buffer -p -d. tmux adds bracketed-paste markers only when the receiving application requests that mode. Without bracketed-paste handling, embedded newlines can execute shell commands; no blanket “paste never executes” guarantee is made. Real browser clipboard/line-wrap behavior must be tested during implementation.

Terminal context uses a bold primary session name, regular window name, and smaller muted host separated with spacing, without literal “on” or dot separators.

## Touch and clipboard research gate

The researched interaction direction is in [terminal-interaction-design.md](terminal-interaction-design.md). Tap-to-click must respect application mouse mode and not fire during long-press selection or scrolling. Copy must preserve logical newlines, not visual wraps. L3 fixes snapshot restoration by replaying mapped wraps in daemon restore bytes, and history chunks carry their own map for copy; mobile selection still needs an app-owned interaction layer, not CSS selection on a canvas. Real iPhone Safari and native selection/keyboard/clipboard probes remain required.
