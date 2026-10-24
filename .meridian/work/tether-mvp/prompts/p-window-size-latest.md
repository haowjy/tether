# Window size follows the client that was active last

## Decision (Jimmy, 2026-10-24)
Asked whether it is acceptable that "the laptop can't grow a window the phone watches" (docs/design/plan.md "Still open"; docs/design/daemon-core.md §9 open risks and the sizing rules around lines 470-495), Jimmy said: "just whoever has the last focus gets the focus and the size of the screen". That is tmux's own `window-size latest` semantics. Today tether's phone size vote *caps* the window whoever is `latest`; that goes.

Also settled: Files in landscape hides the keyboard, same as portrait (remove it from "Still open").

## Design it
- Settle what "last focus" means for each client, using signals that exist without polling (AGENTS.md principles): a tmux client that sends input becomes `latest` natively; for tether's control client, which events make the phone/browser the latest for a window (keystroke or line-field send, tab becoming visible, app foreground, a watch)? Prefer the smallest rule that matches "whoever I'm using now gets my screen's size", and keep tmux the source of truth (tmux's `latest` client tracking where possible, not a parallel tether state machine).
- What the phone shows while another client owns a larger window: the client must render a window bigger than its viewport (or smaller). Pick the behaviour (e.g. scale the font down to fit within a floor, else pan/clip with a clear indicator; or letterbox when smaller) and spec it in the client docs (`.meridian/work/tether-mvp/design/client-architecture.md`, `docs/design/client/browser-behaviors.md`). Remember the keyboard never resizes tmux (existing rule) and the resting dock row is part of the sized area.
- Reclaiming: when Jimmy picks up the phone and acts, the window shrinks back to the phone; define "acts" so merely looking at the phone screen doesn't yank the laptop's layout while he's typing there, unless that's the simpler and acceptable rule — say which you chose and why.
- Update daemon-core.md (sizing rules, hub state, failure table, tests), plan.md (remove the open question), decisions.md (with rejected alternatives: keep the cap; smallest; largest), and the P-lane: name the implementation lane in `.meridian/work/tether-mvp/build-plan.md` (it touches the hub's vote logic; note ordering against lane PC, which touches hub paste handling).
- Check the resource/limits docs aren't affected.
- One fresh reviewer pass over your change; fix findings.

Do not commit; don't edit source. Report: the rule, the phone display behaviour, the lane, review results, anything genuinely for Jimmy.
Spawn env: `TMPDIR=/tmp/tether-meridian-501`.
