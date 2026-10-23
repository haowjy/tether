# Build plan: the whole client, old UI replaced

Goal: ship tether end to end: the daemon serving desktop browser, phone browser/PWA and
the native iPhone app, all on the approved layouts
(`docs/design/client/browser-behaviors.md`, mockup). Repository policy holds: commit to
`main`, no worktrees, `scripts/preflight.sh full` before each push, no release.
Parallel source lanes therefore own disjoint directories; one writer per directory.

## Settled inputs (2026-10-23)

- **Old UI goes.** The web view layer (`web/app/`, `web/ui/` components, `web/files/`
  sheets and viewers, `web/complete/Strip.tsx`, `app.css`) is replaced by the approved
  layouts. Kept only where the inventory (P0-C) shows a module is UI-free, tested and
  fits the new contract: wire types, the WebSocket link, host reconnect, the tab
  driver, the terminal write pipeline and sizing, the `/fs` client.
- **Memory default:** `memory_budget_mib = 72` (3 tmux sessions at once), chosen by
  Jimmy. tmux and everything in it run outside the unit and never count.
- **Browser auth direction (tech lead, delegated by Jimmy):** a browser is admitted
  as an enrolled tailnet *node*: Serve's `X-Forwarded-For` resolved through LocalAPI
  `whois` to a stable node ID, allowlisted by the enrolment code, revocable with
  `tether device`. No cookie, so nothing replayable reaches sibling servers or other
  users' daemons (removes browser-auth D1/D2/D3). Exact `Origin`/`Host`/fetch-metadata
  checks stay mandatory: node identity is ambient like a cookie. Public HTTPS later
  adds a portable credential (passkey) at `auth::admit`. Evidence:
  `tailscale-serve-node-identity-research.md`. Needs rev 4 of the design and review.
- **Layouts may be improved (Jimmy, 2026-10-23):** use standard, accessible components and
  a proper design-token system rather than copying the mockup's hand-rolled CSS. The
  client architecture spec (P1-D) chooses the component approach (a headless library
  that works with Preact, or a small owned primitive set) and the token tiers
  (primitive → semantic → component; light/dark; density for desktop vs touch). Keep
  Jimmy's explicit choices: no Files in `+`, no intermediate menu, no dot markers or
  separators, no custom browser keyboard strip, local draft whose Insert sends no Enter.
  Log each departure from the mockup in decisions.md and update browser-behaviors.md.
- Build for one user; leave room for per-user ports, multiple devices, scoped guests.

## DAG

```
P0  A auth rev4 design ──▶ A' security review ─┐
    B limits spec (72 default) ─▶ B' review ───┤
    C web + protocol inventory ────────────────┼─▶ P1 D client architecture spec ─▶ D' review
    E snapshot wrap-preservation design ───────┤
    F tmux 3.8 test fixes (tests/ only) ───────┘
P1  daemon lanes (src/, disjoint modules, after A', B', E):
      L1 limits + bounded accept loop (src/http accept, config, contrib/)
      L2 browser admission + static shell serving (src/auth, src/http routes)  [after L1]
      L3 wrap-preserving snapshots (src/tmux, src/hub, proto)               
      L4 protocol gaps from C (create session/window, attachedElsewhere, …)
    gate G1: reviewers on daemon changes, real-tmux tests (isolated -L), preflight
P2  web rebuild (after D', G1 contracts):
      W0 delete old UI; design tokens + component primitives; app skeleton: platform
         adapter, router, state store  (one writer)
      then parallel: W1 Home + picker + creation · W2 Terminal (tabs, desktop input,
      reconnect UI) · W3 Files (browse, preview, upload, insert path) · W4 PWA (manifest,
      service worker, install, offline drafts shell)
    gate G2: reviewers + browser probes (desktop Chrome/Safari, mobile viewport)
P3  mobile input: draft editor, touch scroll/selection/copy, paste + image paste
    gate G3: Simulator probes; real-iPhone checklist queued for Jimmy
P4  native iOS shell (Simulator only; the physical iPhone is in use elsewhere)
P5  final gate: end-to-end probe on isolated tmux 3.4/3.7b, budget measured, docs,
    CHANGELOG, knowledge capture
```

## Lane log

| Lane | Spawn | State |
|---|---|---|
| A auth rev 4 | p31 → rev 4 (Unix socket + SO_PEERCRED, whois per request); review p42 | reviewing |
| B limits 72 | review p32 (1H 6M, 2 simplifications); rev 2 p45 | revising |
| C inventory | p25 done (report only: protocol already has create/attachedElsewhere/index) | done |
| E wrap design | p33: -F on 3.7b+, paired -N -T/-J alignment on 3.4 (fail closed); tmux builds at /tmp/tether-wrap-build/prefix/{3.4,3.7b}/bin/tmux; structure review p44 | reviewing |
| F tmux 3.8 | p27 → 50e5499 | done, unpushed |
| D client architecture + design system | p34 → rev 3 (owned primitives on native HTML, no library); review p43 | reviewing |

## Tech-lead calls (2026-10-23 night)

- Auth rev 4 D2 (an enrolled node is trusted whole, so phone Safari/PWA reach tether
  without Face ID) and D3 ("Remove this device" replaces logout): accepted, under
  Jimmy's accepted unlocked-device risk. D1 (Unix socket) pending review p42.
- Client arch: the phone picker follows the theme; each server's installed PWA is named
  "tether <host>" (daemon fills the manifest). Kept for Jimmy: whether a closed tab's
  draft is kept (proposed: yes, up to 32).
- No worktree exception: lanes stay on disjoint directories in one checkout.
