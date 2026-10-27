# Look at slice 2 of the client redesign in the harness

Repo `/Users/jimmyyao/repos/tether`, HEAD `c2086d4` (local). It built the phone bar
(current-tab button + Show keyboard) and the sessions sheet. Behaviour:
`docs/design/client/browser-behaviors.md` (Platform layout, Visual treatment, Session
picker and switcher, Window switcher, Phone dock). Mockups (spec wins where they differ):
`.meridian/work/tether-mvp/phone-redesign-mockups/`; mockup canvas notes in
`.meridian/work/tether-mvp/phone-redesign-brief.md`. Before screenshots:
`.meridian/work/tether-mvp/redesign/before/`.

Start the harness: `pnpm --dir web run dev -- --mode harness` (pnpm only), open
`/harness/index.html?fixture=<name>&layout=phone|desktop&scheme=dark|light`. New
fixtures: `sessions`, `sessionsOnFiles`, `sessionsEmpty`, `sessionsOffline` (in
`web/harness/dock/`), plus existing ones. Load `/agent-browser` and `/probe`.

Check, phone 390x844 dark and light, and desktop 1280x800, and record what happens:
1. Terminal at rest: bar is the current-tab button (bold session, regular window,
   tab count) + keyboard button; no strip or + on the terminal; seated on the safe area
   with no blank band. Files tab: button only.
2. Sheet: opens from the button at about half height with the tab visible above; Home
   + search on top (search not focused); rows marked here/open; the active
   multi-window session lists "index: name" windows, shown marked; strip at the bottom
   with the next tab peeking, × on the active tab only; + menu.
3. Row tap opens the tab behind and the sheet stays; strip tap switches and stays;
   closing the active tab from the strip; Browse files; Escape / Back / backdrop; Back
   twice ends on Home.
4. Desktop: + opens the picker; a row opens its tab and closes it; the windows menu on a
   multi-window tab opens and switching a window works; focus returns to the terminal.
5. Empty, offline and refused states are distinct and say the right thing in the sheet
   (the empty sheet currently says "Create one from Home." while + is beside it: report
   what you see). Long names truncate (window name first), nothing scrolls horizontally
   at 320px width, touch targets ≥ 44px where the spec asks.

Save screenshots of each state (and anything wrong) under
`/Users/jimmyyao/repos/tether/.meridian/work/tether-mvp/redesign/s2/` with a README listing
URL and what each shows; keep them viewport-sized. Edit nothing else; stop the dev
server when done. Report pass/fail per check with evidence.
