# Phone redesign: direction brief (2026-10-27)

Source: phone-ux-pass.md issues 1-12. Mockup canvas: https://claude.ai/artifact/VpZoJtGXYytqnhzBBy24qA

User and task: Jimmy on his iPhone, driving agents in tmux on pop-os; most time is reading a
terminal and sending short lines; switching between ~10 sessions.

Direction (one model, three places):
- Bottom bar = tab strip (replaces the dock chip). Tabs are terminals or file browsers.
  Active tab shows x; next tab peeks; + and the keyboard toggle sit at the right. Swipe
  sideways switches; tap/drag up on the active tab opens the sessions sheet. Bar sits
  flush on the home-indicator inset (issue 2).
- Keyboard up: tab strip hides; key row sits directly on the keyboard, the compose box
  above it (issue 7). Exactly one cursor shows where keys go: terminal = solid block, box
  idle has no caret; box focused = ring + caret + Send, terminal cursor hollow (issue 4).
  Tapping the terminal, or the box's terminal button, returns typing to tmux without
  dropping the keyboard (issues 5, 6).
- Sessions sheet (half height, terminal visible above): Home button + search on top,
  every session on the host with open ones marked, tab strip at the bottom; tapping a tab
  switches the terminal behind and the sheet stays (issue 8). Second tap on the active tab
  lists its windows. + offers New session / Browse files. List vs 2-column grid shown for
  comparison.
- Files is a tab (issue 11), its folder remembered locally.
- Home = the app's own place (issue 12): servers, appearance, terminal text size, Face ID
  relock (5 min / 1 h / never, default 1 h), this device, local data. Settings screen goes.
- Dark = classic terminal (issue 1): true black terminal, neutral greys, no blue tint.
  Assumed; Jimmy didn't pick between near-black and true black.

Evidence it works: Jimmy picks/rejects on the canvas; later, device checklist rows for
focus legibility, no gap above the keyboard, one-thumb tab switching.

Surfaces (Jimmy, mid-mockup: "these should be fixed on ALL surfaces ... mockup browser,
mobile browser, and iphone separately"):
- iPhone app: as above; Home has Face ID.
- Phone Safari/PWA: same dock model; Safari's toolbar under the tab strip with the keyboard
  down; Safari's ⌃ ⌄ Done form bar between the key row and the keyboard; Home has no Face
  ID, has Add to Home Screen.
- Desktop: no rail. Top row = ⌂ Home, tabs (terminal + files; x on the active one), +,
  server status. + opens a popover: search, sessions with open marked, New session /
  Browse files. Home = centered column: servers, appearance, this browser.
Canvas rows: app light (9), app dark (4), Safari (3), desktop (4).

Round 2 (Jimmy: "what does home look like? ... server chooser?", "what is the back
button", "that looks more like a settings screen", "no servers/session?", "if there is
one, do u just automatically navigate"):
- Home reworked to server-first: a card per server (status, counts, Sessions / Files;
  offline card says when last reached + Retry), Add server. Settings moved behind a gear
  to its own screen. Home keeps the tab strip, so no back button.
- Launch rule (proposed): reopen the last tab; Home only when no tabs are open.
- One server: no auto-jump; Home flattens to that server's sessions in the card.
- Empty states: no servers = enrol instructions + Add server; live server with no
  sessions = New session; tmux not running = say so, tether never starts tmux.
- Sessions sheet groups sessions by server when there are several.
- Desktop Home still the old settings-style column: rework after phone Home is approved.

Round 3 (Jimmy: "why would this have the tabs at the bottom? whose tabs are those? ...
listing like a list of 3 open session and then the rest - open the server / the slide
thing ... confused about new session / files"):
- Home has no tab strip (it duplicated the open sessions in the card).
- Each server card: rows for that server's open tabs (tap = back to it), then
  "All N sessions >" (opens the sessions sheet for that server) and "Files >" (opens a
  file tab there). One and two servers now share the same card.
- New session lives only in the sheet's +, plus the no-sessions empty card.

Round 4:
- "mermaid is important" -> Mermaid rendering in the Markdown viewer moves up from v2
  (plan.md:609, repo-viewer parity) into this redesign's scope. Lazy-loaded, strict mode,
  behind DOMPurify (plan.md "Rendered content is untrusted").
- "home should be a back button or icon and settings should be higher... save as much
  vertical space as possible" -> rule for every screen: one 44pt header row (back icon +
  17pt title), no large titles. Applied to Settings and Home.
- Files: "up" is a "‹ parent" row at the top of the list (absent at a root), plus the path
  field and swipe back. Proposed one Files tab per server; "Open this folder" from a
  terminal tab (tmux pane_current_path) offered, not settled.

Round 5 (answers to the p309 walkthrough, phone-redesign-walkthrough-p309.md):
1. Session name with the keyboard up: not needed ("u know from which is shown").
2. SETTLED: while the box has focus, ← → move its caret and esc leaves the box back to
   tmux; ↑ ↓ ^R ^C tab stay on tmux and look it. Focus stays in the box after Send.
   (Changes terminal-interaction-design.md: control keys today always go to tmux.)
3. SETTLED in intent: an attention dot on tabs/rows from the terminal bell, "if we can
   find it". Open: tmux sets window_bell_flag only for a non-current window, so a bell in
   a one-window session nobody watches may not surface; probe real tmux (3.4, 3.7b) before
   promising. Connection indicator shown only when not live.
4. SETTLED: swipe scrolls the strip, tap switches, tap the active tab opens the sessions
   sheet. Windows de-emphasised: "i don't think we should really be using the windows
   feature too much... and each tab should be a window anyways". OPEN DECISION: tab =
   window would reverse "tabs follow a session" (decisions.md); bring it back with
   tradeoffs before building. Mockups drop the windows menu meanwhile.
Safari's form bar gap: accepted ("we want people to install the app anyways").

Round 6: tab strip on the terminal reversed.
- Jimmy: "it looks like u are trying to copy termius ... I thought we had a button that
  displayed the session sheet" then "when the terminal is up we have the [open session
  sheet] [actually, maybe this should be the current tab] [keyboard]".
- SETTLED: terminal bar = [current tab button: name, tab count, attention dot; tap opens
  the sessions sheet] [keyboard]. No tab strip and no + on the terminal; tabs and + live
  at the bottom of the sessions sheet (his original sketch). Files/preview use the same bar.
  The lead had misread "replace that dock chip" as "the bar becomes a tab strip".
- Reference: Termius (phone-ux-pass/13-termius-keyboard-up.png): with the keyboard up it
  keeps [<][current host pill x][+][grid], a voice box, and a text-only key row.
- SETTLED (Jimmy: "can there be multiple files tab ... I think there should be allowed"):
  any number of Files tabs, each remembering its own folder or open file, labelled by
  that folder/file name. "Browse files" (sheet +) and "Files >" (Home card) always open a
  new one at the server's home folder; existing ones are reached as tabs (listed in the
  Home card's open rows and the sheet's strip).
- SETTLED (vs Termius): with the keyboard up, no session pill ("hiding it is fine"); the
  key row is text-only like Termius's; the compose box is always shown with the keyboard
  up ("better to have the compose box always showing"), idle with placeholder and no
  caret while typing goes to tmux. Order bottom-up: keyboard, key row (+ hide keyboard),
  compose box.

Round 7:
- Direction approved ("I'm happy with the current direction").
- Windows SETTLED: a tab stays a tmux session ("maybe tabs as the session, and then u can
  expand to swap windows somewhere if there are multiple windows - automatically selecting
  the first window?"). Only sessions with more than one window show a way to switch
  windows (lead's proposal: in the sheet, the active tab's row expands to its windows).
  Open detail: "automatically selecting the first window" vs today's rule that a tab
  follows the session's current window (laptop switches move the tab). Lead reads it as:
  open on the session's current window (usually the first), keep following; confirm.
- Bell dot: probe real tmux before designing it (prompts/probe-bell.md).
- Windows detail SETTLED: a tab opens on the session's current window and keeps following it ("oh, current makes more sense").
- Bell probe p310 (3.8 only; probe-bell.md): streamed session = BEL in %output (free);
  others = runtime alert-bell hook (event-driven, no idle cost; needs monitor-bell on and
  bell-action allowing it, both default). Claude Code rings BEL only with
  preferredNotifChannel "terminal_bell"; Codex rings it in some setups. 3.4/3.7b rerun as
  p314 (ssh user is jimyao). Questions put to Jimmy: may tether add a runtime hook to his
  tmux server; will he switch Claude Code to terminal_bell.
- Bell SETTLED (Jimmy: hook "yes, although wait for my tmux restart"; Claude setting "okay
  with that change (but u need to also add it to tether docs)"). Spec'd in 7e71d06: BEL in
  the streamed pane + one runtime global alert-bell hook; running.md gets the
  preferredNotifChannel note when the feature ships (user docs describe shipped behavior
  only). Hook goes on Jimmy's live server only after his tmux restart. Open for
  daemon-core.md: how the daemon learns a marker changed without polling.
- Jimmy: "always push" (2026-10-27): push main after each commit.
