# Build: session follow + take, daemon side (lanes 1a + daemon half of 1b)

The design is settled and committed (18ae3f2). Implement the daemon side of it:
`docs/design/daemon-core.md` as it now stands is the contract (session-scoped views and
owners, `Locate { session }`, `%session-window-changed` / `%session-changed` handling,
the per-owner `c::#{window_id}` subscription for swaps, window-size claims naming one
window, the **take** — same-session `switch-client -c <owner> -t '$S'` in its own command
group before the claiming input/paste/vote, rules for when a take is due — `selecting`,
window size in `watching`, `selectWindow` / `newWindow` (no `-d`), protocol 2 with
minimum 2, `historyChunk.pane`, `input` errors). Summary, lanes and review record:
`.meridian/work/tether-mvp/design-session-follow-and-folder-find.md`. Probes the design
rests on: `docs/design/research/probe-session-follow.md`,
`docs/design/research/probe-latest-client.md`. Decisions: the 2026-10-25 entries at the
end of `docs/design/decisions.md`.

## Scope
`src/tmux/` (lane 1a), `src/hub/`, `src/proto/` (+ regenerate
`web/proto/generated/messages.ts` with `UPDATE_PROTO_TYPES=1 cargo test --lib
proto::typescript`), `src/http/ws.rs` as needed, `tests/` (real-tmux, hub, recorded
fixtures re-recorded on tmux 3.4 and 3.7b at `~/.cache/tether-tmux/{3.4,3.7b}/bin/tmux`),
the Rust side of the iOS fixture JSON if the auth bodies change. Follow AGENTS.md and
plan.md "Code structure and standards": sans-IO cores for tmux protocol and hub, thin I/O,
bounded queues. Delete what the session model makes obsolete (window phases,
`windowClosed`, `windowRenamed`, window Locates, …) — no compatibility path.

The web client and the iOS app are a separate lane that starts after you: do not edit
`web/` beyond the generated types; the web will not typecheck against protocol 2 until
that lane lands, which is expected — say exactly what changed in the wire contract so
that lane can follow. Do not commit; the lead commits.

## Verify
`cargo test`, `cargo clippy --all-targets -- -D warnings` (+ `--target
x86_64-unknown-linux-gnu`), `cargo +1.85 check --locked --all-targets` (MSRV: no let
chains), the hub unit tests the spec's §8 lists (every take condition, both selection
orders, swap, `selecting` clearing), real-tmux tests on 3.4 and 3.7b
(`TETHER_TMUX=... TETHER_TMUX_TESTS=1`), including a watch larger than the pty (274x53 vs
80x24) taking the window and the pty's key taking it back, laptop prefix-n being followed,
and a swap being followed. Isolated `-L` sockets only, never the default tmux socket.
Measure daemon memory against the budget (`evidence/budget/` has the method) and bytes
per window switch.

## Report
What changed by module, what was deleted, the wire-contract delta for the client lane,
verification by type with numbers, spec gaps you hit (and how you resolved them), and
anything left.
