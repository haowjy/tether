# Tether browser and mobile interaction contract

Status: interaction contract for the client redesign; implementation and device-specific gates remain. This contract supersedes conflicting navigation and layout rules in the earlier plan. The phone dock and sessions sheet are specified below; their touch implementation remains to verify on an iPhone. See [README.md](README.md) for precedence and Mac setup.

Interactive mockup: [mockups/index.html](mockups/index.html). It predates this redesign; where its navigation or layout differs from this contract, the contract wins. All sessions, terminal text, files, and creation are fictional; reload resets mock data. This mockup never connects to tmux. Do not use a live server with personal sessions for input probes.

## Product boundaries and vocabulary

- Phone browser must support installation as a PWA with standalone launch; installation is optional for use, not for implementation scope. It shares browser behavior, preserves local drafts offline, and never queues terminal commands for later execution. See [browser setup](browser-setup.md) for research and gates.
- Three environments: desktop browser, mobile browser, native iPhone app. Shared workspace behavior; platform-specific navigation and input. No three independent terminal implementations. The native app has a host registry; a browser/PWA is currently bound to its page origin. A unified multi-server browser workspace and its Add server route need an origin/auth design before implementation; do not relax the existing browser boundary ([connection roadmap](connection-roadmap.md)).
- Host is the server, e.g. pop-os. Session is a real tmux session, e.g. a1 or bio2. A session contains windows; one of them is its current window. A terminal tab opens one tmux session, as `tmux attach` does: it shows the session's current window (that window's active pane) and follows it when the current window changes, whichever client changed it. A Files tab holds one folder or file preview on a host.
- Session lists use actual session names. A terminal tab's label is the session name, then the current window's name in regular weight; a Files tab uses its current folder or file name. Host is separate context.
- Minimal initial product. No custom shortcut system, command palette, expanded desktop sidebar, split-pane management, SSH/SFTP/serial connection choices, or app-drawn keyboard: the dock's key row supplements the system keyboard and never replaces it.
- Existing-session selection must be clearly distinct from session creation. Opening an existing session never creates another shell. Closing a tether tab never kills its tmux window, session, or process.
- Connecting may resize a real tmux window. The setup must not suggest tether is read-only or isolated when connected to the user's server.

## Platform layout

| Surface | Desktop browser | Phone browser / PWA / iPhone app |
| --- | --- | --- |
| Primary navigation | One top row: Home, terminal and Files tabs, +, and server context. No rail. | Home is server-first. Terminal, Files and previews use the current-tab button to reach the sessions sheet; Home has no tab strip. |
| Tabs | Top row, with × on the active tab only. + opens the session picker and creation actions. | With the keyboard down, the bar has the current-tab button and keyboard control. The open tabs and + are at the bottom of the sessions sheet, not on the terminal. |
| Terminal | All available space below the top row. Direct physical-keyboard input; no dock. | Full-bleed above the dock. With the keyboard up, the compose box and key row replace the resting bar. |
| Sessions | + opens a popover with search, sessions and New session / Browse files. | A half-height sheet over the current tab, or a full-height sheet with Back when entered from Home. |

Safe areas and browser chrome are real platform constraints. Use the measured visible
viewport and keep controls unobscured. Mobile controls target at least 44 px of touch
area; the dock's visible controls may be smaller. Seat the resting bar at the bottom
safe area without a blank band; add that inset only while the keyboard is down. The key
row and the sheet's tabs scroll horizontally. Names truncate rather than widening the
screen. Safari's own toolbar remains below the resting bar, and its form accessory sits
between the key row and keyboard. Standalone PWA mode has no Safari toolbar.

## Visual treatment

- Settings offers System / Light / Dark on every surface. System follows the system
  appearance; Light and Dark override it. Dark uses a true-black terminal and neutral
  greys rather than blue-tinted terminal surfaces. Native and web appearance agree.
- Blue is the selection/accent channel; green is reserved for connected status. Selected
  rows use a blue-tinted fill and weight. Connection state is distinct from selection.
- The phone sheet uses the current theme's raised surface. A toast floats above the dock
  without covering its controls.
- Home is a centered column on desktop, with width `min(720px, 100% - 2 gutters)`.
  Phone screens use a single 44 pt header row, a back icon where the screen has a parent,
  and a 17 pt title; no large titles.
- A terminal tab's session name is bold and its current window name regular, separated
  by spacing, including for a one-window session. Truncate the window name first. A Files
  tab is labelled by its folder or open file. When multiple hosts are available, keep host
  context accessible for otherwise ambiguous tabs. Icon-only controls have accessible
  names and tooltips on hover and keyboard focus.
- Interactive controls share a 2 px focus ring with a 2 px offset. Spacing, type, radii
  and icon sizes use one scale per property; icons are 16, 20 or 24 px.
- Loading, empty, offline, error, refused-session, enrolment and permission states are
  distinct; failures must not look like empty content. Reduced motion shortens duration
  tokens. Do not globally force transitions to 1 ms.

## Home

Home is a separate server-first screen, not a detent of the sessions sheet. It has no
phone tab strip. Each server card shows its name and status and its open terminal and
Files tabs; a row returns to that tab. “All N sessions” opens that server's sessions
sheet; “Files” opens a new Files tab at that server's folder list (its roots). One and several
servers use the same card; a single server does not auto-navigate past Home. Add server
leads to enrolment. An offline server shows when last reached and Retry, distinct from an
empty server; open tabs remain available as reconnecting. A restored terminal tab reads
“Checking…” until a listing proves its session or “Reconnecting…” while unreachable.
Phone Safari Home also offers Add to Home Screen instructions.

No servers shows enrolment instructions and Add server. A live server with no sessions
shows New session; if tmux is not running, say so and offer no action that starts it.
tether never starts Jimmy's tmux server. Server management includes adding, removing and
re-enrolling a server. Settings is a separate screen reached from the Home gear, with
appearance, terminal text size, this device/browser and local-data controls. The app also
offers the Face ID relock setting ([auth.md](../auth.md#swift-side-keychain-item-and-app-lock));
the phone browser has no Face ID setting. Clear local data deletes
drafts and the saved workspace on this device, leaving currently open tabs until closed;
destructive actions confirm independently. Remove this device is available only where the
host admits this device as a tailnet node. Settings has Back to Home.

A clean launch opens Home, even with saved tabs: Home is where an unreachable server or
stopped daemon is explained, and the saved tabs are listed on their server cards.
Returning from the background keeps the screen the user left.

## Terminal

- Selecting a tab activates it; other tabs remain open. Opening a session already represented by a tab activates that tab. Implementation identity must use server/session IDs, not mutable display names.
- **The tab follows its session.** When the session's current window changes (prefix-n on the laptop, the window switcher below, a window exiting, a script), the tab shows the new window: its snapshot replaces the old one in place and the label changes. The tab, its draft and its place in the tab order stay. Typing, the line field, paste and an inserted path go to the window the tab is showing on this screen, so keys sent just before a change made elsewhere still reach the window the user was looking at. Opening or activating a tab enters Terminal through the router; desktop focus lands on the terminal after that screen is rendered.
- Closing the active tab activates its right-hand neighbour, or the left-hand neighbour if it was last. Only the active tab shows ×, on desktop and in the phone sheet; it closes that tether tab, never its tmux session or process. Scroll the active tab into view. Closing the last tab returns Home. Creation-dialog cancellation/Escape restores focus to its opener.
- The phone sheet's Home button and system back gesture return to Home, preserving open tabs and active selection. Desktop Home is in the top row. Desktop + opens the picker with creation actions; the phone current-tab button opens the sheet, whose + offers New session and Browse files.
- Files opens as a tab from Home or the creation action; switching tabs preserves the terminal and running process.
- Terminal output is not editable mock text masquerading as live input. The prototype says it is sample content and sends no input.
- On the terminal, show connection status only when not live. Reconnecting/error is visible in text, with Retry, and is distinct from active-tab selection and the bell dot. Home server cards still show live or offline status.
- Real connection states inherit the existing reconnect contract: disconnect does not silently close tabs; reconnect/error appears with the affected tab; viewing Home/Files must not kill tmux.
- When the daemon refuses a socket for its connection cap (close code 4005), the host banner says “Too many connections to pop-os” with “Close tether in another browser or the app, then retry” and a Retry button, until a socket is welcomed. It is a host problem: the tabs keep their own “Reconnecting” state and the socket keeps its normal backoff.
- Scroll behavior, paste, mouse handling, focus delivery, reconnect, server identity, tmux geometry ownership, and keyboard viewport behavior require implementation-phase verification. No claim of those working is made from static mockups.

- Desktop keys go to tmux by name: Shift+Enter sends the modified-Enter bytes once, and IME composition sends nothing until it ends. Cmd combinations and F5, F6, F11 and F12 stay the browser's on every platform; Ctrl+Shift+C copies the selection as logical lines on every platform. Ctrl+Shift+F leaves the focused terminal for the tab strip (focus lands on the active tab; Enter returns), handled before the key is sent; Settings lists it under Keyboard. Keystrokes are batched for 8 ms into one input message.
- Paste sends one paste message and is refused over 256 KiB, saying so. An image paste uploads, then types the quoted path into the tab it was pasted in, if that tab is connected when the upload ends; otherwise a notice says the file is in Files.
- A tab the daemon refused for its session limit reads “session limit” in the error colour, shows the daemon's message and Retry, and retries with a growing delay. Retry asks at once and keeps the delay.
- The terminal stays blank until the shown tab's own snapshot paints, so another tab's content never sits under a pill that is not its own. tmux is never sized before the renderer has measured a cell.
- A window takes the size of whichever terminal acted on it last. Opening or returning to a tab, typing, pasting, rotating, Fit, and choosing or creating a window in the window switcher size the shown window to exactly this screen's size, whether the laptop's terminal is larger or smaller; typing in another terminal (the laptop) takes it back, and the tab stays live. A tab that just stays on screen never takes it back, and neither does a reconnect after a network blip, unless the tab held the window before it. When the tab follows a window change made elsewhere (the laptop's prefix-n, a window exiting, a script), the new window keeps the size it had until this screen acts on it. The window left behind goes to the laptop's size after its prefix-n; after a change no terminal made, it takes the size the window had when tether attached to the session, until a terminal types there. The same holds when this screen stops holding a window and nobody else acts there (the tab leaves the screen, the connection drops): it takes the size it had when tether attached, until the laptop types. A window sized for another terminal is drawn at this screen's own font from the left edge: wider content is cut off at the right, and taller content follows the cursor, as it does above the keyboard. A window smaller than the screen sits in the top-left corner on the terminal background. Whenever the window's size (from `watching`, the whole window, not a split pane) has differed from the size this screen sent for longer than the wait, larger or smaller, the band on the terminal's top edge says “Sized for another terminal” with Fit, which sizes the window to this screen. While this screen holds the window the two sizes match, so there is no band; the wait, one second or the last measured ping round trip plus half a second, whichever is longer, restarted at each claiming send (opening, typing, pasting, rotating, Fit, choosing a window), keeps it from flashing while a claim's resize is on its way over a slow link. Reconnecting and error states replace the band.

## Session picker (desktop) and session switcher (phone)

Both surfaces fetch sessions when opened, search locally by name without a request per
keystroke, distinguish no matches from loading and errors, and mark sessions already open.
With several servers, group the list by server; the session name and window count remain
readable. Session rows open an existing session's tab or activate it, never create a shell.
The dismissal behavior after selecting a session row in the phone sheet is open.

**Desktop:** + opens a popover under the top row with search, sessions grouped by server,
and New session / Browse files. Selecting a session opens or activates its tab and closes
the popover. Escape or outside click dismisses without changing the active tab; focus
returns to terminal input, or + when there is no tab. Search is auto-focused.

**Phone:** the current-tab button opens a half-height sheet over the current terminal or
Files tab, which remains visible behind it. From a server's “All N sessions” on Home, the
sheet is full-height for that server, with Back to Home instead of Home. The half-height
sheet has the tabs and + at its bottom; the full-height sheet has no tab strip (Home
already lists the open tabs) and puts + beside its search field.

```text
half-height over current tab             full-height from Home
┌──────────────────────────────────┐     ┌──────────────────────────────────┐
│ current terminal / Files         │     │ [‹] [ Find a session        ] [+]│
├──────────────────────────────────┤     │ sessions for this server         │
│ [⌂ Home] [ Find a session     ]  │     │                                  │
│ sessions, grouped by server      │     │                                  │
│                                  │     │                                  │
│ (a1 python ×) (b1 claude) … [+]  │     │                                  │
└──────────────────────────────────┘     └──────────────────────────────────┘
```

- Search is not auto-focused. With its keyboard up, the sheet sits above the keyboard
  (above Safari's form bar in the browser) and the list scrolls in the remaining space.
- The bottom strip contains terminal and Files tabs in order, with the next tab peeking
  when more remain; swipe scrolls the strip, tap switches the active tab behind the
  sheet, and the sheet stays open. Only the active tab shows ×. Closing a terminal tab
  leaves its session running. + offers New session and Browse files; Browse files opens
  a new Files tab at the server's folder list (its roots).
- Session rows mark the active tab's session “here” and other open sessions “open”.
  An attention dot on tab buttons and session rows marks a terminal bell since this
  device last showed that tab; mechanism and coverage limits are in
  [plan.md](../plan.md) (Bell attention). The current-tab button
  can surface attention from another tab. It is not a connection-status indicator.
- New session prompts for an optional name and absolute start directory; blank uses
  tmux's defaults. Cancellation is harmless and server validation is authoritative.
  Open its tab from the next listing containing it; after 5 seconds say when it was created
  but has not appeared. Show a refused directory's reason in the form. The server choice
  for creation when several are available remains open.
- A tap outside, the system back gesture or Escape dismisses the half-height sheet without
  changing the active tab. Opening the sheet lowers the keyboard (Phone dock). Empty,
  offline and refused states are distinct.

## Window switcher

A terminal tab opens on its session's current window and follows it as any client changes
it. Only a session with more than one window offers a window-switching affordance; on the
phone it is inside the sessions sheet, not terminal chrome. Expanding the active
session row is proposed; the exact control remains open. Desktop also needs an
equivalent way to switch multi-window sessions. Choosing a window runs tmux's
`select-window` on the session, so every attached client moves with it. Rows are in actual index order as “index: name”; the latest `watching`
window is marked “shown”. Load from the current listing, show loading and refusal with
Try again, and selecting the shown window changes nothing. The route for creating a new
window in a one-window session remains open. tmux prefix keys sent by tether reach the
pane, not tmux's key tables.

## Files

Any number of Files tabs can be open, even on the same server. Each remembers its own folder or file preview locally and is labelled by that folder or file name (“Files” at the folder list). Home “Files” and the sheet/desktop “Browse files” always create a new tab at the selected server's folder list (its roots), since outside a root tether lists subfolders, not files; existing Files tabs are reached through their tab or Home row.

Each Files tab presents one folder list under one path field. At rest the field shows where the user is; typed into, it completes folders; tapping rows browses one folder at a time.

```text
phone, at rest                           phone, typing (keyboard up)
┌──────────────────────────────────┐     ┌──────────────────────────────────┐
│ [ ~/repos/tether            ]    │     │ [ ~/repos/te|ther/     ] Cancel  │  ghost: "ther/"
│ ‹ repos                          │     │ in ~/repos                       │
│ ▸ docs                         › │     │ ▸ tether                         │  predicted, highlighted
│ ▸ src                          › │     │ ▸ tether-old                     │
│ ▸ web                          › │     │ ▸ test-data                      │
│   Cargo.toml              2.1 KB │     │──────────────────────────────────│
│   README.md               9.8 KB │     │ iOS keyboard, Return key "go"    │
│ Show hidden files                │     │                                  │
│ [Upload]                         │     │                                  │
│ [tether files   4 tabs        ⌃] │     │                                  │
└──────────────────────────────────┘     └──────────────────────────────────┘
```

**The path field** heads Files on every platform, above the list. At rest it reads the current folder's path (`~/…` under `$HOME`), or is empty with the placeholder "Go to folder" at the top level, where the list holds the roots. A tap starts editing with the current path and a trailing `/`, caret at the end, so typing narrows that folder's subfolders at once; editing is a history entry, so Back ends it before it leaves the folder; a Cancel button beside the field restores the path and lowers the keyboard, as Escape and Back do. The field turns autocorrect, auto-capitalization and spellcheck off and sets `enterkeyhint="go"`. The ghost text is drawn behind the input and shifts with its scroll; when the typed path fills the field the ghost is cut off at the edge and the highlighted row shows the prediction. It keeps the ordinary text keyboard: the iPhone's URL keyboard has `/` on its first layer but no space bar, and folder names can hold spaces.

**Completion.** While the field has focus, the list shows the folders in the typed parent whose names start with the typed last segment, folders only, matched with ASCII case folded as the daemon sorts them; a line above them names the parent ("in ~/repos"). While the last segment is empty (right after a `/`) the list shows all the parent's folders and nothing is predicted. Once a character is typed, the first match is the prediction: it is highlighted, and its remaining letters show as ghost text after the caret, with a trailing `/`. Accepting a folder puts its full path and a `/` in the field and lists its subfolders; it does not leave the folder the user is in. Accepting is:

- **a tap on a row**, the phone's way, which keeps the keyboard up (the row takes the tap without taking focus from the field; a device gate on Safari, the PWA and the app);
- **`/` typed after a name that is not itself a folder there**, which accepts the prediction in place of the literal `/` ("rep/" becomes "repos/"); after an exact folder name, or with no prediction, `/` is typed as is;
- **Tab**, or → with the caret at the end, on a hardware keyboard, where ↑ and ↓ move the highlight (and can highlight a row while the segment is empty).

**Go** (the keyboard's Return, Enter on desktop) opens a folder and ends editing: the highlighted folder, or with no highlight the folder the text names. So right after an accept, Go opens the folder just accepted. A path naming nothing says "No folder ~/repos/tetherx" under the field and opens nothing. Opening adds a history entry, as a tap into a folder does, so Back returns to the folder the user left.

**Scopes.** The field reaches three kinds of path, and the list says which:

- **Inside a root:** completion and opening use `/fs/list`, as browsing does.
- **Under `$HOME`, outside the roots:** completion uses `/fs/dirs`. Rows for folders outside every root read "not added"; a row that is a root, or inside one, reads like any folder and opens with `/fs/list`. Opening such a folder shows its subfolders only, under a line "Not one of your folders" with "Add this folder", disabled with its reason at `$HOME` itself and for a folder already added; a daemon refusal (outside `$HOME`, a read-only `config.toml`) shows there in plain words. Once added, the folder lists in full. "Add folder…", under the roots list and in the empty state, starts the field at `~/`.
- **Elsewhere** (`/`, `/srv`): no listing is asked for; completion offers the next segment of each root path under the typed parent, from the roots list already loaded. A path outside all three says "Outside your folders".

A `/fs/list` refused as outside the roots for a path under `$HOME` (a symlink leading out) falls back to `/fs/dirs`.

**Cost on a spotty network: one listing per folder, never one per keystroke.** Completion filters a listing the client already holds. Entering a folder (an accept, a typed `/`, a pasted path) asks for that folder's first page once, after typing pauses 250 ms, and only for the folder the field names when it settles; answers for a folder the field has left are never shown, and are kept in the cache. Listings are cached per host for the Files session: the first pages of the 32 most recently loaded folders, whether the field or browsing loaded them (keyed by path and the hidden flag). Showing a folder that is cached (opening it from the field, switching to another Files tab, Back or Forward, returning to a preview's folder) costs no request, and returning to a file already probed does not probe again. Adding or removing a root forgets them all. A failed listing is asked for again when the field next names that folder. Pull-to-refresh and tether's own uploads drop the affected ones. Directories sort first, so one page of 200 entries holds every subfolder of almost any folder. A page that is all folders is followed by the next, each a fresh scan on the daemon, up to 5 pages (1,000 folders); past that, or when the daemon says the folder is past its scan cap, the list ends "Only the first 1,000 folders are searched, keep typing to narrow". While a listing loads, the list says so beside the parent line; a refusal shows in plain words with "Try again", never as an empty list.

**Hidden folders** are left out of completion unless the typed segment starts with `.` (that folder is then asked for with `hidden=1`, cached separately) or the hidden-files toggle is on.

**Browsing by tap** is unchanged at rest:

- Opens the current folder as a list. Returning from terminal preserves folder/preview context.
- Folders open their contents, not an accordion. The first row is “‹ parent” (with the parent folder name); it moves up and is absent at a configured root. The system/browser back gesture also goes back.
- Files open a preview. Back from preview returns to its containing folder.
- Matching navigation treatment: same row height, padding, leading icon position, text size, metadata alignment, trailing chevron, and hover/focus treatment as session rows. Folder rows end with a right chevron (drill in); session rows have none (they open a tab). Files/folders are not falsely presented as expandable trees.
- Roots are listed first at the top level, each with a Remove button that asks first ("Remove this folder?", nothing is deleted from disk) and a Remove-less Uploads row. Remove is a router overlay: Back, Escape and the backdrop close it, and focus returns to the control that asked (Add folder… when a removed row's button is gone). Moving the uploads folder still happens in `config.toml` on the host; the list says so. Returning to a Files tab restores its folder or preview; the in-app back button goes up one place, and the browser's Back returns to the previous one without a new request when its folder is still loaded.
- Folder rows show an icon, name and chevron; file rows add a size. A link that cannot open says why (“Broken link”, “Not a file”) and is disabled. A folder past the daemon's scan cap says it is too big to list in full. Further pages load as the end of the list nears the screen, with “Show more” as the fallback. Hidden files are behind a quiet toggle under the list.
- Previews: code (14 grammars, plain text for the rest), Markdown (relative links open the file here, web links go to the browser, an address link hands off to the mail app; an allowlist of prose, lists, tables, code, links and images is sanitized with DOMPurify, and no click inside it navigates the page itself), images (zoom and pan), video and audio (inline in the browser; native keeps its own player), and binary files (“Open as text”). Markdown Mermaid diagrams render with a lazily loaded renderer in strict mode, with rendered output sanitized by DOMPurify.
- Loading and failure never look like an empty list: a spinner with words, or the refusal in plain words with “Try again”.
- Root selection, permissions, size limits, and error handling remain governed by existing fs spec. Upload/path insertion route is specified below. No delete/move/rename controls are added.

## Persistence and input

- Navigation between Home, sheets and tabs preserves open tabs and process state. Each Files tab retains its own folder or preview, including across reload, locally on that device.
- Home/list refresh runs on entry and on debounced sessionsChanged while visible; there is no polling or network search per keystroke. Fetch on picker or switcher open and reconnect, and prune tabs only from authoritative listings for the matching host and tmux endpoint. A listing from the same endpoint decides all that endpoint's tabs, including live tabs: matching sessions from the same tmux run remain; a different run at that endpoint closes the old run's tabs. A scratch endpoint is never touched by the main-endpoint listing, and a null listing (no server) decides nothing. One notice reports closures. The hub serializes one-shot requests and answers an overlapping request with `busy`, so a listing cannot straddle a window-creation reply. Explicit user retry handles list errors.
- Restore terminal tabs after reload using validated session identities and Files tabs with their own host and saved folder or preview. An unavailable session must not be silently replaced with a same-named session from another server. A workspace saved before tabs followed sessions (format version 1, window tabs) is discarded whole at boot, and so are drafts keyed by its window tabs: tether starts at Home with no tabs. Each host's last-used terminal tab is saved too, so Insert path after a reload still goes where it went before.
- Mockup state is deliberately in-memory. Changing preview-platform selector is a presentation-only reset to Home, not a production control. Full reload returns fictional defaults.
- Touch input follows Phone dock below. Desktop click-to-focus is unchanged.
- Tab display keeps the session name visible and spends what width is left on the current window's name, which truncates first. Full combined name is the tooltip and accessible label. Window rows use the actual tmux window index, not array position; mock indices are illustrative. The server/session identity, not label, owns tab state through renames and window changes.
- Icon-only controls have accessible names/tooltips. Disabled controls must explain why; loading/error states must not look like an empty list.

## Phone dock

On touch, Terminal is full-bleed above a dock shared by the browser, PWA and native app.
With the keyboard down, the resting bar contains the current-tab button and Show keyboard.
With it up, the resting bar disappears: the compose box is always visible above a text-only
key row with Hide keyboard. Files and previews show only the current-tab button: they
have no terminal input to raise. The terminal pans above the keyboard-up controls so its last row meets the bottom of the visible area;
if that would put the cursor above the area's top, the cursor row meets the bottom instead.
It never pans past the last row, when every row fits, or while scrolled into history. tmux
is sized with the resting bar and keyboard down; showing the keyboard never resizes it.

```text
keyboard down                              keyboard up
terminal, full-bleed       $ █             terminal, panned       $ █
───────────────────────────────            ───────────────────────────────────
[a1 python   4 tabs  ⌃] [⌨]              [ Type or dictate a line          ]
bottom safe area                           esc ← ↑ ↓ → ⇧tab tab ^C ^R ctrl alt ⏎ … [⌨↓]
                                           iOS keyboard
                                           (Safari's ⌃ ⌄ Done bar sits above it)
```

- **Sizes.** Row items 34 px tall, key-row keys 32 px, with touch areas extended to the
  row's height where they meet. The compose box font is 16 px to avoid Safari zoom.
  Add the bottom safe area only while the keyboard is down, with no blank band between
  the controls and the inset or keyboard.
- **Current-tab button.** Shows the active tab's name, open-tab count and any pending
  attention dot; tapping opens the sessions sheet. Terminal labels include session and
  current window; Files labels use folder or file. There is no terminal tab strip or +.
  No session pill is shown while the keyboard is up.
- **Compose box.** The line field is one logical line, placeholder “Type or dictate a
  line”, wrapping and growing from one to five visual lines, then scrolling inside.
  It remains visible while typing to tmux, idle without a caret; tapping it gives the
  keyboard to the line. Browser/PWA uses a textarea; the app uses a native editor with
  a web `LineMirror`, autocorrect, capitalization, spell checking, smart punctuation
  and inline prediction disabled. The mirror draws caret, selection and marked
  composition; tapping places the caret, the spacebar is a trackpad, and long press
  offers Paste / Select all / Clear (no selection handles). Return or Send sends the
  text then Enter to the active tab's shown window, clears it and keeps focus in the
  box. Empty Return sends Enter. An undelivered line returns with its reason; a
  disconnected tab keeps the draft and says “Not connected”. Each tab's draft survives
  keyboard hide, navigation and reload. Delivery rules:
  [terminal-interaction-design.md](terminal-interaction-design.md#the-dock-line-field-key-row-and-one-keyboard-toggle).
- **Paste.** One line is inserted for editing; text holding a line break goes to the
  terminal as one paste without Enter, with a notice; an image takes the image paste
  route. Clipboard reads capture the tab and window before a system prompt; if the
  target changes, paste falls back to that captured terminal target instead of editing
  the new line. An IME candidate Return remains with the editor.
- **Key row.** A fixed, horizontally scrolling text-only row: esc, ←, ↑, ↓, →, ⇧tab,
  tab, ^C, ^R, ctrl, alt, ⏎, then `|`, `~`, `/`, `-`, with Hide keyboard fixed at its end. While the box owns focus, unmodified ← and →
  move its caret and unmodified esc returns focus to the terminal; ↑, ↓, ^R, ^C, tab and other
  terminal controls go to tmux. Distinguish the two destinations visually. In terminal
  mode the controls go to tmux. Arrows repeat while held; ↑, ↓ and ^R use the shell's
  own history. Character keys go where typing goes. ctrl and alt arm the next key,
  shown pressed until used or tapped again; an armed chord goes to tmux. Except for
  esc leaving the box, a key-row tap does not move focus. The row is the same with a
  hardware keyboard attached.
- **Keyboard control.** Show keyboard in the resting bar raises terminal input; Hide
  keyboard in the key row lowers either target. The control's state follows focus and
  system dismissal. Tapping the terminal or esc while composing
  returns typing to tmux without lowering the keyboard.
- **Focus cues.** Terminal target: solid terminal cursor; the idle box has no caret and
  shows its draft or placeholder. Line target: box ring and caret, visible Send, hollow
  terminal cursor, and Return labelled Send. There is exactly one active typing cursor.
- **Terminal taps and sheets.** With the keyboard down, a tap on the cursor's row or the
  row directly above or below it raises terminal input, except while scrolled into
  history. With the keyboard up, a terminal tap switches from line to terminal without
  hiding it. Mouse-mode taps still send a click; OSC 133 prompt-row cursor placement may
  move the cursor while terminal input already owns the keyboard. Scroll and selection
  do not toggle it. Opening a sheet or dialog lowers it, as does leaving Terminal for
  Home or Files. On sheet close, native restores the held target; the browser refocuses
  inside a closing tap and leaves the keyboard down after Back or Escape.
- **Safari's form accessory bar.** The phone browser/PWA may put its own ⌃ ⌄ Done bar
  between tether's key row and the keyboard; the page cannot remove it. Done lowers the
  keyboard and the toggle follows. The native terminal/line responder is not a WebKit
  field; WebKit-owned sheet fields retain their ordinary form bar.

## File upload and path insertion

In a Files tab, upload uses the browser/native file picker into the configured uploads folder. Several files may be picked at once; one uploads at a time and at most four are held, and a fifth is refused with “Wait for the current uploads to finish”. A file over 128 MiB is refused before it is sent. Completion adds a row to the list, with progress while running, then the saved name, an insert-path action naming its terminal target, and Preview; the screen does not navigate away from the folder. A file preview has the same insert action for existing files. The action inserts a shell-escaped absolute canonical path into the named terminal tab without Enter, then returns to that terminal. It never executes the path. How the target is selected while a Files tab is active remains open.

When there is no eligible terminal tab, insertion is disabled with “Open a terminal tab first”; files still remain accessible. If the target disappears or disconnects, insertion fails visibly without sending into a different tab: the action is disabled while the target is reconnecting, refused for the session limit or closed, and a path still waiting for its watch is dropped with a notice if the watch fails. A tab that is still connecting, or live but not on screen, takes the path and types it when it is watching; the one eligibility rule is the driver's, shared by Files and image paste. A name holding a control character (CR, LF, ESC, ^C) is never inserted, because typed into a pane it would submit or act as a key; the notice sends the user to the terminal. The target tab and the window it shows are captured on click, not selected by matching names; the path goes to that window even if the tab has since followed its session elsewhere, and fails visibly if the window has closed. A tab that has not had its first `watching` yet (still connecting or restoring) has no window to capture, and types the path into the window its first `watching` names. Returning to the Files tab preserves its preview context.

Browser image paste into a focused terminal follows the same upload pipeline. Capture the exact target tab and the window it shows at paste start, upload supported image bytes into the configured uploads folder, then insert the quoted absolute canonical path into that same window through that tab, without Enter, even if the tab has since followed its session to another window. If the target is gone or disconnected when upload completes, keep the uploaded file available in Files and report the insertion failure; never redirect to a different active tab. Ordinary text paste remains terminal paste. Clipboard access depends on a user paste gesture and browser capabilities; unsupported image clipboard access gets an explanation and the Files upload route. This preserves the photo-paste MVP; actual clipboard handling remains a real-browser verification gate, not simulated by this mockup.

## Offline and updates

The service worker serves the shell from its cache. On an offline launch the host card says “Can't reach pop-os” (the name is the last one saved), open tabs read “Reconnecting…”, and the listing shows its offline state. Nothing shows a pretend live terminal and nothing typed is queued. The worker never intercepts `/ws`, `/auth`, `/fs`, `/complete`, `/debug` or a non-GET request.

A new build installs in the background and waits. Home and Files show “Update ready” with Update, never over the terminal; only the window that taps Update reloads. Another window shows “Reload to finish updating” with Reload, and keeps running its own build until then. A window two builds behind fails to fetch a lazy chunk and shows the designed “Update required”.

## Keyboard ownership and navigation history

Desktop terminal focus owns keys only while terminal input is focused. Session search, creation forms, and Files controls own their own input. Overlay handling intercepts Escape only while an overlay is open; otherwise Escape belongs to terminal input. Tab activation, terminal return, and overlay dismissal restore terminal focus on desktop. Focus must not steal input from a focused text field. Only focus that must raise the software keyboard needs to happen synchronously inside the user's gesture. Other focus transitions may wait until navigation or the dialog has rendered; a phone dialog must not focus a text field and unexpectedly raise its keyboard.

Accept browser-reserved shortcuts rather than adding a custom shortcut system or promising interception. Which combinations reach the page must be probed in Jimmy’s browsers before shipping; this contract does not claim an exhaustive reserved-key list. Browser/site navigation must never be intentionally hijacked to mimic a native terminal.

The ordinary on-screen keyboard lacks Esc, Ctrl, Tab and arrows; the dock's key row supplies them in the browser, the PWA and the app alike.

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

Do not use middle-dot separators in app chrome, labels, headings, or descriptive copy. Separate metadata with layout/spacing or write a short phrase. The bell attention dot is distinct from connection status, which uses text for reconnect/error states and accessible labels; its mechanism is pending probe.

## Text clipboard behavior

Proposed browser copy preserves logical line breaks, not terminal soft-wrap boundaries. Paste preserves multiline clipboard text through the existing paste protocol; it is not converted into a sequence of Enter key events, and plain paste does not append an extra Enter. The daemon already uses load-buffer then paste-buffer -p -d. tmux adds bracketed-paste markers only when the receiving application requests that mode. Without bracketed-paste handling, embedded newlines can execute shell commands; no blanket “paste never executes” guarantee is made. Real browser clipboard/line-wrap behavior must be tested during implementation.

Terminal context uses a bold primary session name, regular window name, and smaller muted host separated with spacing, without literal “on” or dot separators.

## Touch and clipboard research gate

The researched interaction direction is in [terminal-interaction-design.md](terminal-interaction-design.md). A long-press on the terminal fires with a haptic and highlights the word under the finger at once; dragging while still held extends the selection to the cell under the finger, and releasing shows the handles and an edit menu with Copy and Paste; over a blank cell the menu has Paste alone. Paste sends the clipboard's text to the terminal as one paste, without Enter, and an image takes the image paste route; it is the terminal's paste on the phone, beside the line field's own paste menu. Safari shows its own Paste confirmation; the app may show iOS's "Allow Paste" prompt unless tether is allowed in Settings. It sends no mouse event, in mouse-mode apps too (Jimmy, 2026-10-24). Terminal selection has no spacebar-trackpad mapping; the app's line mirror separately uses the native field's spacebar caret trackpad. Vertical swipes in alternate-screen apps still send ↑/↓ or wheel events. Tap-to-click must respect application mouse mode and not fire during long-press selection or scrolling; a tap never lowers the keyboard; it raises it only on or beside the cursor's row while down, and returns focus from the box to the terminal while up. Copy must preserve logical newlines, not visual wraps. L3 fixes snapshot restoration by replaying mapped wraps in daemon restore bytes, and history chunks carry their own map for copy; mobile selection still needs an app-owned interaction layer, not CSS selection on a canvas. Real iPhone Safari and native selection/keyboard/clipboard probes remain required.
