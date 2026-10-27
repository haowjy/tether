# Handoff: build the client redesign (UX lead -> tech lead)

Date: 2026-10-27. From the UX-lead session that ran the phone UX pass and settled the
redesign with Jimmy. Everything below is specified and pushed; nothing of the redesign is
built yet.

## What Jimmy wants

tether should feel good to drive from his iPhone every day, one-handed, on a weak link:
always clear where his keys go, as much terminal on screen as possible, quick to get
between sessions and files, and quick to notice which agent needs him. The same model on
all three surfaces: the iPhone app, phone Safari/PWA, and the desktop browser ("these
should be fixed on ALL surfaces"). The app is the primary experience ("we want people to
install the app anyways").

## Current state

- **Specs are settled and on `main`:** `d97cbe4` (redesign), `58d2bf9` (bell mechanism),
  `c04fc3c` (bell polling, clean launch opens Home). `main` == `origin/main` at `37552e4`
  (work notes). Jimmy: "always push" after each commit.
- **Shipped this session:** `dd22280`, the iOS proxy now checks a host's `/auth/info`
  itself, so Files and completions work in the app (it said "speaks a different version"
  against a same-protocol daemon). Installed on the iPhone and verified by Jimmy ("yeah,
  files show").
- **The installed app** is that build (Release, team D4K9ZT557F, device
  00008150-000254DC02A3C01C). Web changes reach the app only by reinstalling it
  (`ios/AGENTS.md`); pop-os's daemon bundle serves Safari/PWA only.

## The redesign in one paragraph (the specs are authoritative)

Terminal bar = [current-tab button: name, tab count, bell dot; tap opens the sessions
sheet] [keyboard]; no tab strip on the terminal. Keyboard up: compose box always visible
(idle, no caret), a text-only key row (esc ← ↑ ↓ → ⇧tab tab ^C ^R ctrl alt ⏎ | ~ / -,
Hide keyboard at its end) seated on the keyboard; while composing, ← → edit the box and
esc returns to tmux; a terminal tap also returns. The sessions sheet: half height over
the terminal with tabs + `+` at its bottom (swipe scrolls, tap switches, the sheet stays),
full height from Home with Back and no strip. Tabs stay sessions and follow the current
window; multi-window sessions get a window switch in the sheet. Home is server-first
(cards: open tabs, "All N sessions", "Files"); Settings behind a gear (System/Light/Dark
with a true-black dark terminal, terminal text size, Face ID relock 5 min / 1 h default /
At launch). Files are tabs, any number, each remembering its place; a new one opens at
the server's folder list (roots); "‹ parent" row; Mermaid renders in Markdown previews.
A clean launch opens Home. Bell: BEL from the streamed pane plus one runtime global
`alert-bell` hook, markers polled locally only while a device is connected. Desktop: one
top row (⌂, tabs, +, server), + opens a popover; no rail.

## Read first

1. `docs/design/client/browser-behaviors.md`: the interaction contract (Platform layout,
   Home, Session picker/switcher, Window switcher, Files, Phone dock).
2. `docs/design/client/terminal-interaction-design.md`: target routing and focus.
3. `docs/design/plan.md`: product rules, Bell attention, scope (Mermaid now in scope).
4. `docs/design/auth.md` (Face ID relock setting), `docs/design/ios-shell.md`.
5. `docs/design/decisions.md`: the 2026-10-27 entries (search "2026-10-27, Jimmy"),
   each with what it supersedes.
6. `.meridian/work/tether-mvp/phone-redesign-brief.md`: every round with Jimmy's words,
   including reversals (the terminal tab strip was reversed in round 6).
7. Mockups: https://claude.ai/artifact/VpZoJtGXYytqnhzBBy24qA (Jimmy's private canvas);
   sources in `.meridian/work/tether-mvp/phone-redesign-mockups/`. Where a mockup and
   the spec differ, the spec wins (the writer's report, `phone-redesign-spec-p313.md`,
   lists the known differences).
8. `.meridian/work/tether-mvp/phone-ux-pass.md` (the 12 reported issues) and
   `phone-redesign-walkthrough-p309.md` (a user walkthrough's edge cases).
9. `.meridian/work/tether-mvp/probe-bell.md`: bell behavior on tmux 3.4/3.7b/3.8, the
   exact hook syntax that worked (`set-hook -ga`, `set-option -F`), and its limits.

## Open questions and blockers

- **Bell hook rollout:** Jimmy approved the hook, but it goes onto his live tmux server
  only after his planned tmux restart ("wait for my tmux restart"). Probe on isolated
  sockets (`tmux -L`) until he says it's done. Set the polling interval in
  `daemon-core.md` when building. `docs/running.md` gets the Claude Code
  `"preferredNotifChannel": "terminal_bell"` note when the bell ships (Jimmy asked for it
  in tether's docs).
- **Browser multi-server:** several servers are now a product rule (`5a741ae`), but the
  browser/PWA is bound to its page origin while Home shows several servers and Add server. Needs an origin/auth design before the browser gets a
  multi-server Home (browser-behaviors.md "Product boundaries"). The app already has a
  host registry.
- **Smaller open details in the specs:** list vs 2-column grid for sessions (Jimmy
  unsure; lead leans list); the exact window-switch control and creating a window in a
  one-window session; whether a sheet row tap dismisses the sheet; server choice for New
  session with several servers; Files-to-terminal insertion target; workspace format
  migration for Files tabs; Mermaid zoom/pan. Each is marked open in the spec.
- **Device-only checks:** keyboard/focus/geometry can't be verified in the Simulator
  (`ios/AGENTS.md`); Jimmy runs the device checklist on his iPhone.

## What the tech lead needs to do

Jimmy, on scope: "this is a lot of reworking btw". Plan it in shippable slices, each
leaving the app usable, rather than one big switch.


- **Objective:** plan and build the redesign across web (shared by Safari/PWA and the
  app), the iOS shell (native input target routing, appearance setting, Face ID relock
  setting) and the daemon (bell hook and marker polling), in coherent commits straight to
  `main` per `AGENTS.md` (no branches, PRs or worktrees during the initial build), each
  preflighted, pushed after commit.
- **Order suggestion:** the terminal bar + sessions sheet first (Jimmy feels it most), then
  keyboard-up layout and key routing, then Home/Settings, Files tabs + Mermaid, theme,
  Face ID setting, bell last (after the tmux restart). Desktop follows each piece.
- **Before code:** this adds modules and moves responsibility (sheet replaces switcher,
  Files becomes a tab type, workspace format changes, a daemon hook), so put the plan and
  specs through `@reviewer` with `/thermo-nuclear-review` and do its enabling refactors
  first (pre-dev "Structure review").
- **Before-state evidence:** Jimmy's screenshots of today's UI are in
  `.meridian/work/tether-mvp/phone-ux-pass/` (08 sessions sheet, 13 Termius reference);
  the two dock screenshots from issues 2-7 were not saved. Capture the current web UI in
  the browser before replacing it if comparisons will matter.
- **Constraints:** tmux is the source of truth and never depends on tether; network bytes
  are precious; light on the host (the four invariants now open `plan.md`); test on tmux
  3.4 and 3.8 (3.8 fixtures still to record, `31d116f`); MSRV 1.85; pnpm only in
  `web/`; CHANGELOG bullet per user-visible change; keep `docs/design/` accurate in the
  same commit as code.
- **Skills:** `/dev-workflow`, `/ui-implementation` for the web screens, `/probe` and
  `/agent-browser` for verification, `/agent-staffing` for review lanes.

## Workspace note

16 untracked files in `.meridian/work/tether-mvp/` (p282 probes, tmux-3.4-crash notes,
`handoff-tech-lead.md`, `line-field-input.md`, older prompts) belong to earlier sessions;
leave them unless their owner says otherwise.
