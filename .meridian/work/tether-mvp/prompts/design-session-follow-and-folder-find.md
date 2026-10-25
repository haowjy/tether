# Design: tabs follow a session; Files finds folders by path completion

Two product changes Jimmy decided during first real use (2026-10-25). His words and
choices: `.meridian/work/tether-mvp/real-use-decisions.md` (items 1 and 3). Design both;
they are independent, so deliver them as two spec changes that can land separately.

## 1. Follow the session (structural)
Today a tether tab is one tmux *window* (`docs/design/client/browser-behaviors.md` lines
~11-12, 54-65, 87-133, 150; Home/picker/switcher list sessions with windows indented;
tab identity is server/window IDs; the daemon watches per window — `docs/design/
daemon-core.md` watch/claims, §3.6-3.7 window sizing by the client that acted last).
Jimmy chose: **one tab per session, like `tmux attach`**: the tab shows the session's
active window; when the active window changes (in tmux from any client, e.g. prefix-n,
or from a small window switcher in tether shown only when the session has 2+ windows)
the tab follows. Lists show sessions only (no window rows by default). Mobile first.

Settle, among others: tab identity and restore (session ID + server); what the daemon
watches and how a session-level watch follows `session-window-changed` (tmux control
mode) on tmux 3.4 and 3.7b, without extra round trips (spotty-network principle) and
within the memory budget; how window-size claims (acted-last) apply when the visible
window changes; the window switcher's shape on phone and desktop (no dot markers or
separators; Jimmy's standing choices in browser-behaviors.md and plan.md stay); "+ New
window" placement now that window rows are gone; what happens to the protocol (bump rule
in daemon-core.md: bump only when an older peer would act wrongly) and the iOS bridge;
paste/upload target identity (browser-behaviors.md ~164) when the window can change
under a tab; migration of saved workspaces holding window tabs. Delete what the new
model makes obsolete rather than keeping both.

## 2. Files: find a folder by path completion (UX, mostly web)
`/#/files` today: `browser-behaviors.md` Files section, `web/screens/files/`, the `/fs`
API in daemon-core.md / auth roots. Jimmy chose a **path field with completion**, like
VS Code's path entry: type a path; it predicts the next existing folder; Tab or a tap
accepts; a list below narrows as you type. Mobile first (phone keyboard has no Tab:
design the accept gesture). Settle: where it sits in Files, how it uses `/fs` listings
(cost per keystroke on a spotty network: cache a directory's listing, no request per
character), roots and `~`, hidden folders, what selecting does, and how browsing by tap
still works. Jimmy's words: "this needs a ui rework i think".

## Context and constraints
Read `AGENTS.md`, `docs/design/plan.md` (product rules, code standards), the specs above,
`docs/design/decisions.md` for prior calls. A concurrent investigation (p216) is fixing
why the size band / claims don't work in the browser (window sizing); a concurrent
frontend lane (p221) is fixing the app shell fill. Don't edit source. Write the spec
changes directly into `docs/design/` (current rule only) with decision entries
(alternatives rejected) — uncommitted; the lead commits after review. Use mockups
(ASCII or HTML in docs/design/client/mockups/) where a layout needs one.

## Deliver
The spec diffs, a short summary of each design with the decisions you made and the
open questions only Jimmy can answer (with your recommended answer), and an
implementation plan: lanes, order, what each touches, how each is verified against real
tmux 3.4/3.7b and a real phone.
