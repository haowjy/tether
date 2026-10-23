# Specify tunable resource limits for the tether daemon

Jimmy (the owner) wants to cap tether's CPU and memory on his dev box. Many processes run there, and several users may each run their own tether. Specify how, at the level a coder can build from. The spec gets reviewed before any code.

## Settled by Jimmy
- **A hard CPU cap in the systemd unit** (`contrib/tether.service`). Today it has only `CPUWeight=20` and `Nice=10`, so it yields under contention but has no cap. Recommend a default `CPUQuota` and justify it from what the daemon actually does.
- **One memory-budget setting in `~/.config/tether/config.toml`.** The daemon derives its own caps from it: control clients, connections, WebSocket slots, concurrent file and raw streams, completion state, and static-shell slots if the browser auth draft lands. A tighter budget means fewer things open at once, refused with a clear busy or limit message. It must never mean an OOM kill. The unit's `MemoryHigh` and `MemoryMax` have to agree with the budget. Decide how: the daemon checking its cgroup limit at startup, documentation, or both. Say which and why.
- **Tuning is documented in `docs/running.md`:** `systemctl --user edit tether` for the systemd caps, plus the config setting.
- **Why this matters:** the caps will rarely bind for one user. They exist for a crowded box, or several users each running tether.

## Principles
Read the "Principles" section in `AGENTS.md`. "Light on a busy host" is the principle this serves. Keep the defaults no looser than today's.

## Read first
- `docs/design/daemon-core.md` §6, the limits and the memory ceiling: every cap and how the ceiling adds up. It is already about 1 MB over `MemoryMax` at the caps.
- `docs/design/plan.md` "Resource budget" and "Config".
- `docs/design/fs.md` and `docs/design/complete.md`, for their limits.
- `contrib/tether.service`, and `src/config.rs` and wherever the constants live in `src/`.
- `.meridian/work/tether-mvp/design/browser-auth.md`, revision 3: its static-shell limits, its new memory ceiling, and decision D6 (whether to drop to 2 control clients). Jimmy's answer to D6 is "make it a budget-derived default". Say what the default budget yields.

## What the spec must settle
- The budget's unit, default and allowed range, and the derivation table from budget to each cap. Keep the derivation simple: a few tiers or one formula, not a solver. Show what the default yields, and what a tight budget yields (for example 32 MB).
- Which caps scale and which stay fixed, with reasons. Security and correctness bounds don't scale away; for example, the per-frame and per-message bounds stay.
- When a cap binds, what the user sees on each surface (web and native), using existing error and close codes where they fit.
- Whether the budget is read at startup only, or live. Prefer startup, unless live is cheap and clearly useful.
- How this interacts with the rest of the memory ceiling, which has to be restated in terms of the budget.

## Output
Write `.meridian/work/tether-mvp/design/resource-limits.md`, structured as:
1. A short summary.
2. Decisions for Jimmy, each with a recommended answer.
3. The proposed replacement text for daemon-core §6, plan.md "Resource budget" and "Config", `contrib/tether.service` and `running.md`, written as the current rule.
4. The `decisions.md` entry.
5. Probe gates: how to measure on the box that the caps hold.

Edit nothing else. No source code, and don't touch live services.
