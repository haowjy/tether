# Review the uncommitted phone-dock design change in tether

Review the whole uncommitted design change in /Users/jimmyyao/repos/tether (`git status`, `git diff`;
the spike deletions under `ios/spikes/keyboard/` and `docs/design/spike-1-keyboard.md` are intended).
It is design docs and a mockup only; no production code. Do not edit anything; report findings with
severity (high/medium/low), file:line, and a concrete fix.

## What the change decides
Jimmy's settled calls are in `.meridian/work/tether-mvp/phone-input-decisions.md` (read in full).
Summary: on touch, Terminal ends in a web-drawn dock: at rest ONE row (tab chip with active tab name
+ open-tab count, a one-line "line field", the keyboard toggle); while the keyboard is up a fixed key
row (esc ↑ ↓ ^R ^C tab ctrl alt | ~ / -) sits above it. The tab chip opens a "session switcher" sheet
(open tabs as pills, every tmux session with windows labelled here/open, search + New session at the
bottom, not auto-focused) that replaces the phone tab row, + and the phone picker; desktop unchanged.
Long-press: haptic; hold+drag = arrow pad; release = select word with handles + edit menu. Two
keyboard openers (toggle → terminal input; tap field → field), one closer (toggle); Termius focus
cues (solid vs hollow cursor, plain vs blue send Return). Line field auto-capitalization off.
Design calls made by the design lead (challenge them): the Paste button is gone (paste via the
field's own menu, and Paste in the terminal's edit menu after a long-press); Return sends
`paste { req, watch, text, enter: true }` with the daemon putting `send-keys Enter` in the same tmux
command list (skipped if the paste fails) and answering every paste exactly once with
`pasted { req, watch }` or `error { req, ... }`; the switcher is a separate `screens/switcher/`
component rather than a phone variant of the picker.

## Files
- Specs: `docs/design/client/browser-behaviors.md` (Phone dock; Session picker and switcher),
  `docs/design/client/terminal-interaction-design.md`, `docs/design/plan.md`, `docs/design/ios-shell.md`,
  `docs/design/daemon-core.md` (§3.4, §3.9, §4.4, §4.7, §5.3, §7, §8: paste confirmation),
  `docs/design/decisions.md` (the "Phone input follows Termius" section at the end).
- Work/KB: `.meridian/work/tether-mvp/design/client-architecture.md` (§1, §2, §5.7–5.8, §6.5, §7.4–7.6,
  §10–12, §14), `build-plan.md`, `.meridian/kb/client-design-handoff.md`, `web/.context/FUTURE`.
- Mockup: `docs/design/client/mockups/index.html` (screenshots in /tmp/tether-meridian-501/mockshot-v2/).
- Existing web code for reality checks (read only): `web/screens/picker/`, `web/screens/sessions/`,
  `web/screens/terminal/`, `web/platform/types.ts`, `src/hub/`, `src/proto/` (does the daemon change
  fit the hub as built? e.g. how a Paste's Done is handled today, how control-client exit drops tags).

## Risks to check (plus anything else you find)
- Specs contradicting each other or the decisions file (leftover tab row, + on phone, Paste button,
  "awaits confirmation", three rows, compose).
- The paste protocol: is "answered exactly once" achievable on every path (connection's own
  refusals, hub refusal, Done Ok/Err, control-client crash/respawn, watch ended, connection gone)?
  Does `enter` in the same group really get skipped on failure on tmux 3.4? Interaction with the
  delete-buffer cleanup group, credit/charging, the 16-entry own-reply queue.
- The dock: tmux sizing with a key row that appears only with the keyboard (stable box), hardware
  keyboard case, landscape, Safari's form bar, the switcher's bottom search with the keyboard up.
- Focus model: the switcher lowering the keyboard; native resting modes; focus cues mapping to
  xterm options; key-row routing vs "the key row always sends to the terminal" in Jimmy's notes.
- Lane plan: P3a/P3b ownership conflicts (W1 files, W0 hand-offs), missing verification.
- Vocabulary: one name per concept (picker vs switcher, tab chip, arrow pad).
- Specs should state the current rule only; decisions.md logs alternatives.
