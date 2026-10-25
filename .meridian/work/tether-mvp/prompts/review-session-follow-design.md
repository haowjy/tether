# Review: "tabs follow a tmux session" and "Files path completion" spec changes

Review the uncommitted spec changes under `docs/design/` (see `git diff -- docs/design`;
new probe `docs/design/research/probe-session-follow.md` is untracked). Two independent
designs:

1. **Tabs follow a session** (Jimmy's call in `.meridian/work/tether-mvp/real-use-decisions.md`
   item 1): a tether tab = one tmux session showing its current window, following
   `%session-window-changed`. Touches `daemon-core.md` (§1 vocabulary, §3.1, §3.3, §3.4,
   §3.6 claims, §3.7, §3.8, §3.9, §4.1–4.5 views, §5.2 protocol bump to 2, §5.3 messages,
   §7, §8), `client/browser-behaviors.md` (Home, Terminal, switcher, new "Window switcher"
   section, persistence, paste/upload targets), `plan.md`, `ios-shell.md` (bridge 3), and
   new entries at the end of `decisions.md`.
2. **Files path field with completion** (item 3): `client/browser-behaviors.md` Files
   section, a plan.md pointer, decisions.

Judge correctness against the real system and the rest of the specs: the hub's sans-IO
state machine (views, owner, Locate binding order, reconcile desired state, claims and
votes across window changes, subscription baselines, credit/stream breaks, control-client
lifecycle including `%session-changed`), tmux behavior on 3.4/3.7b (the probe is the
evidence; tmux source is in /tmp/tmux-upstream), the protocol bump rule in daemon-core
§5.2, the resource/network principles in AGENTS.md (spotty networks, small memory), and
internal consistency: stale references to window tabs, `windowClosed`, `windowRenamed`,
`LocateSession`, `WindowRef` tab identity, accordions, Add folder dialog, anywhere in
`docs/design/` (including fs.md, complete.md, auth.md, setup.md, client/*.md).

Risks I want checked, beside whatever else you find: races between `CurrentWindow`,
the Locate answer, `selectWindow`'s vote-then-select group and `newWindow`'s `created`;
whether pinning input/paste to the client's shown window is sound (a window id from the
client on the watch's server); two views on one linked window; whether deleting window
phases loses a case the old design handled (moved windows, a session's last window);
the Files completion rules (accept gestures on a phone keyboard, `/` smart-accept
surprises, scopes roots/$HOME/elsewhere, cache and request counts, hidden folders,
deleting the Add folder dialog).

Write no files. Report findings ranked by severity with file:line and a concrete fix.
