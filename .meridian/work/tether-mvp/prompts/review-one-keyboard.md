# Review: one keyboard in the iOS app (commit c43797d on local main, not pushed)

Review `git show c43797d` in /Users/jimmyyao/repos/tether as the code now stands. Design:
`docs/design/research/one-keyboard.md`; Jimmy's settled decisions:
`.meridian/work/tether-mvp/one-keyboard-answers.md`; the build brief:
`.meridian/work/tether-mvp/prompts/one-keyboard-build.md`. The coder's report (in this
spawn's --from) lists choices beyond the proposal. Edit nothing; findings with severity.

Risks to check, beyond your own:
- Two first responders are gone for real: nothing on Terminal's resting dock can still
  hand first responder to WebKit (guard in FocusController), and `webText`/`select` still
  work (sheets, selection at release — commit 95f8a97 moved `focus select` to release).
- The bridge contract on both sides (web/platform/native/bridge.ts, TetherKit
  Bridge/BridgeTypes) is in step; stale `gen`/tab-bound edits can't write into another
  tab's draft; Return during marked text never sends.
- Beyond-proposal machinery: "Return edges are queued across page reload, with a 16-edge /
  256 KiB bound", `lineSelectAll`, tab binding on lineSet/lineEdit. Is each needed, or a
  second mechanism for something the draft store already owns? Simpler model?
- The browser/PWA `LineInput` became a textarea: Enter still sends, no newline typed,
  predictions/IME unchanged there; mobile Safari focus behaviour.
- Per-keystroke cost: lineEdit carries the whole text each edit; held Backspace and long
  lines; React re-render scope of LineMirror.
- Hardware keys in `line` routed per the proposal; armed ctrl/alt.
- Version skew: a new app against an older daemon's web bundle (the web is served by the
  daemon) — what breaks, and does anything detect it?
- Docs state current rules only and match the code; deleted pieces gone from AGENTS.md /
  .context; MSRV unaffected.
