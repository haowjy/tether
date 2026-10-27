# Phone redesign spec pass (p313)

The contract now describes the redesigned dock, sessions sheet, Home, Files tabs,
settings and desktop picker. The decision log records the 2026-10-27 decisions and
superseded rules. No client implementation or changelog entry is part of this pass.

## Source conflicts

- The current full-height `Sheet.dc.html` hides the bottom tabs and +. The task explicitly
  requires them in both sheet heights. Home itself still has no strip.
- The current Files and preview mockups show only the current-tab button, while round 6
  says those surfaces use the same bar as the terminal. The contract follows the brief;
  what the keyboard button does outside a terminal remains open.
- `Main.dc.html` omits the compose box's terminal button present in the brief. The spec
  retains it, as well as terminal-tap and esc routes back to tmux. The mockup adds ⇧tab
  and Enter and drops symbol keys; the brief does not settle the exact row inventory.
- The desktop mockup shows a live connection indicator, but round 5 says the terminal
  indicator is shown only when not live. Home server cards still show live status.
- The walkthrough's Mermaid, Safari Home and desktop parent-row findings describe an
  earlier mockup. The current files have rendered Mermaid, a Safari Home variant and a
  desktop parent row. The specs preserve the approved lazy/strict/sanitized Mermaid rule.
- Opening a Files tab at `$HOME` cannot turn `$HOME` into an allowed file root: `/fs/dirs`
  lists directories only outside roots, and `$HOME` itself cannot be added in-app. The
  spec keeps that boundary rather than promising unrestricted home-folder content.

## Still open for the lead

- Bell discovery, coverage and clearing on tmux 3.4/3.7b (probe is running); no general
  new-output activity dot was approved for this pass.
- Whether launch restores the last tab or enters Home; the brief calls restore a proposal.
- List versus grid; whether selecting a session row dismisses the sheet; exact window
  expansion and desktop equivalent; how a one-window session creates a new window.
- Server selection for New session/Browse files when several exist, duplicate tab-name
  disambiguation, and whether Home itself needs a Back control beyond the tab rows.
- The redesigned browser Home depicts multiple server cards and Add server, while
  `web/platform/browser/index.ts` exposes only `location.origin` and
  `docs/design/client/connection-roadmap.md` defers a unified cross-origin workspace.
  Resolve browser Add server and multi-host scope without weakening the node-lane origin
  boundary; the visual design alone is not authorization to introduce cross-origin access.
- How Files insertion selects a terminal when the selected tab is Files; exact saved
  workspace shape, migration from the singleton Files place, and native active-tab bridge
  identity for Files tabs.
- Keyboard button behavior on Files/preview; exact key-row inventory and modifier-armed
  esc/arrow behavior; whether a separate compose-to-terminal button remains required.
- Default appearance setting and preference ownership/bridge synchronization; Mermaid
  zoom/pan behavior; expired or unavailable file previews on restoration.

Verification: `meridian kg check docs/design --strict` passed (37 files, 769 links),
`meridian mermaid check docs/design` passed (9 blocks); a static contract audit and
`git diff --check` passed. No runtime or device verification was attempted for a doc-only
pass. Probe findings do not become a settled bell mechanism until reviewed.
