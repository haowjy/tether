# Lane P3a: the phone dock, owned input, line field and switcher

Build P3a exactly as `.meridian/work/tether-mvp/design/client-architecture.md` specifies: the P3a row in §11 (line ~1736: files owned, behaviour, verification), the "W0 hand-offs for P3a" list (~1770), §7 input, the focus owners (incl. the `line` owner), the switcher section (~1344), and the dock sections it links. Product contract: `docs/design/client/browser-behaviors.md` ("Phone dock", the session picker/switcher section). Mockup: `docs/design/client/mockups/index.html` (mobile). Every decision and Jimmy's words: `.meridian/work/tether-mvp/phone-input-decisions.md`. Read `web/AGENTS.md` and `web/.context/` first; follow the existing tokens (`web/ui/tokens/`) and primitives (`web/ui/primitives/`).

Lane PC (paste confirmation) is committed (96216b1): `sendPaste(..., { enter: true })`, `pasted { req }` and refusal handling exist in `web/tabs/`, `web/net/host.ts`, `web/screens/terminal/terminals.ts`. Use them for Return; don't reimplement.

## What Jimmy cares about
He tried the old keyboard spike and called it "a shit ton of ui issues". UI quality is the bar: the dock must feel as good as Termius on his iPhone. Specifics he chose: one row at rest (tab chip · line field · keyboard toggle), key row `esc ↑ ↓ ^R ^C tab ctrl alt | ~ / -` only while the keyboard is up, toggle the only control that opens live typing and closes either keyboard, tapping the line field opens line typing, terminal taps never open/close the keyboard, Termius focus cues (solid vs hollow cursor; plain vs blue send Return via `enterkeyhint="send"` on the line field only), line field 16px font (Safari zoom), capitalization off, Return sends paste + Enter. Switcher from the tab chip: open-tab pills, all sessions with windows ("here"/"open"), search + new session at the bottom.

## Verify (as the P3a row lists; key points)
- Unit tests named by the spec (`drafts/`, `modifiers.ts`). No other new permanent tests unless the spec names them (e2e/dock is named).
- Playwright WebKit at phone size against a real daemon on scratch tmux 3.4 and 3.7b (`/tmp/tether-meridian-501/tmux/3.4/bin/tmux`, `/tmp/tether-meridian-501/tmux/3.7b/bin/tmux`; isolated `-L` servers, never Jimmy's sessions): Return runs `echo hi` once in bash and zsh; check Claude Code (`claude`) and Codex (`codex`) prompt submission if those CLIs are installed here, else say so; busy refusal restores the line with no Enter; every key-row key and armed ctrl+c reach tmux; draft swap on tab switch, restore on reload; switcher flows.
- iOS Simulator Safari (xcrun simctl; a booted iPhone simulator exists): toggle from both inputs, terminal tap changes nothing, key row only with keyboard, focus cues, tmux size unchanged with keyboard up and the prompt row stays visible above the dock; portrait + landscape. Screenshots of every dock and switcher state (keyboard up/down) into `$MERIDIAN_ACTIVE_WORK_DIR/evidence/p3a/`, compared against the mockup; fix what looks off.
- `scripts/preflight.sh full` passes; MSRV unaffected (web only).
- Write the real-iPhone checklist items (§12) into `$MERIDIAN_ACTIVE_WORK_DIR/g3-iphone-checklist.md` as concise steps Jimmy can run.

## Constraints
- Do not commit; I review and commit. Keep `docs/design/` and `.context/` accurate in the same change; if implementation must diverge from the spec, record it in the spec's divergence style and in your report.
- CHANGELOG `[Unreleased]`: one bullet for the phone dock + switcher.
- Spawn env: `TMPDIR=/tmp/tether-meridian-501`.

Report: files changed (grouped), how each spec point is met, verification by type with tmux versions and screenshots paths, divergences, and anything unfinished.
