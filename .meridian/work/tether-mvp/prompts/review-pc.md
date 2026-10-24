# Review lane PC (paste confirmation), uncommitted in the working tree

Review the code as it stands for correctness, regressions and maintainability. The change: `paste` gains `req` + `enter`; daemon answers every paste exactly once (`pasted { req, watch }`, refusals with `req`, `error { tmux }`, and a "may have been sent" error when tmux stops answering); with `enter: true`, `send-keys Enter` rides in the same tmux command group so tmux skips it if the paste fails. Web routes the reply to the originating tab, shows "Not sent" / "May not have been sent", no client timeout.

Spec: `docs/design/daemon-core.md` (§3.4, §4.4, §5.3, failure table; note: the working tree also has unrelated uncommitted spec edits from a window-size design in the same file — review the paste parts) and `.meridian/work/tether-mvp/design/client-architecture.md` §10–11. Implementer report: `meridian spawn show p116`.

Source changed (PC only; ignore docs/ and .meridian/ changes): src/proto/messages.rs, src/http/ws.rs, src/hub/{mod,requests,state}.rs, src/tmux/{mod,command,fake}.rs, examples/record-tmux-fixtures.rs, tests/{hub_state.rs,support/fake_hub.rs,support/script.rs}, tests/fixtures/{proto/messages.json,tmux/3.4/paste.*}, web/{net/host.ts,tabs/input.ts,tabs/driver.ts,tabs/driver.test.ts,screens/terminal/terminals.ts,proto/generated/messages.ts}, CHANGELOG.md, web/.context/TODO.

Risks to check (and anything else you find):
- Exactly-once: every path (success, connection refusal, hub refusal, tmux error, control client crash/linger/timeout, socket close mid-paste, tab closed mid-paste) produces one reply and no leak of request state or paste temp files; no double reply on races between a tmux reply and a teardown.
- Enter never runs after a failed or refused paste; Enter is in the same command list on 3.4 semantics.
- Bounded state: pending paste tracking can't grow unbounded per connection (AGENTS.md: bounded queues; 256 KiB paste cap).
- Web: a reply after the tab closed or reconnected is dropped safely; "May not have been sent" vs "Not sent" mapping matches spec; no paste is ever resent automatically.
- Sans-IO structure kept (hub core free of I/O).
Write findings with severity to your report; edit nothing.
