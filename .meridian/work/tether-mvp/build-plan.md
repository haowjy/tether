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
| A auth | L2 47b4d93. Reviews p79+p80 agree: High idle-503 (cell refuses after 30 s idle instead of waiting), Med refused auth.toml rows deleted on write, Med error codes not in HttpError, Med decisions/CHANGELOG/running.md gaps, lows. Fixes p85 (--from p64; also owns the slots+waiters unification). Linux/iOS gates G1–G12 open | done: d1d4bc8 + round-2 notes 5697904 3b67044 (p87 approved with notes, lead read the fixes). Open: deployment gates G1–G12 (Linux box, iPhone, PWA) |
| B limits 72 | ce9ca40 + fixes. Thermo p81: H1 ceiling test misses 2 rows 47b4d93 added to §6.3; delete Budget; cost table as data; delete self-copy tier test. Fixes p86 | done: 0369577 0df6196 0794c14 (p88 approved) |
| C inventory | p25 done (report only: protocol already has create/attachedElsewhere/index) | done |
| E wrap | ... + b608a02 (TUI contract) + 02bbe98 (numbered gap was the test rejecting \r\r\n from the pty; p82 proved tmux sent every line; 6/6 on 3.8). Thermo p81: M1 OSC 8 hyperlink kills a chunk's wrap bits; one escape scanner; History owns truncate; spec capture blocks stale. Fixes p86 | done: a959283 884e1c0 bc42fe1 (p88 approved; 16/16 on 3.4/3.7b/3.8) |
| F tmux 3.8 | p27 → 50e5499 | done, unpushed |
| D client architecture | rev 4 p49 committed. Round limit reached (3 reviews): no 4th review round; review 3 judged the design sound, rev 4 mostly deletes. W0's structural review checks rev 4 against code | settled |

## Tech-lead calls (2026-10-23 night)

- Auth rev 4 D2 (an enrolled node is trusted whole, so phone Safari/PWA reach tether
  without Face ID) and D3 ("Remove this device" replaces logout): accepted, under
  Jimmy's accepted unlocked-device risk. D1 (Unix socket) pending review p42.
- Client arch: the phone picker follows the theme; each server's installed PWA is named
  "tether <host>" (daemon fills the manifest). Kept for Jimmy: whether a closed tab's
  draft is kept (proposed: yes, up to 32).
- No worktree exception: lanes stay on disjoint directories in one checkout.
- Auth D1: Unix socket kept, Tailscale ≥ 1.100; cost accepted: later `tailscale serve`
  changes on the box need sudo (tell Jimmy). Upside: only root can add a handler beside tether.
- Wrap: no tmux version branch; the -N -T/-J pair on every version.
- Limits: tier boundaries stay round (72/64/58/53/42).
- Lanes in one checkout: coders don't commit; the lead commits each change by pathspec
  after review and preflights a clean export of the commit (client-arch review F5).
| W0 web skeleton + design system | commits + review fixes 395ed9e..b5086ab + docs fold ebdf564 | done |
- Preflight --commit trap (2026-10-23, fixed 244db07, 5ef777d): the fixed export path +
  shared target let Cargo's mtime freshness pass off the previous export's build as the
  current commit's (archive mtimes are commit times). Exports now extract with `tar -m`;
  build.rs embeds from OUT_DIR. Per-commit preflights run before 244db07 on the new layout
  are void; re-run of 395ed9e..5ef777d: all 8 pass.
- pnpm, not npm (Jimmy, 2026-10-23): p84 builds the switch as a patch in an export; apply after the pf2 preflight re-run and p83 docs fold land; fold design-doc npm mentions then. Deletes check-install.mjs (export does pnpm install --frozen-lockfile).
- AGENTS.md now carries the pnpm rule (uncommitted, in the working tree with p83's edits): commit it with the pnpm patch.
- pnpm switch landed 362e4fb (p84 patch; full preflight --commit green; checkout node_modules reinstalled with pnpm). p85/p86 were briefed before it: their web commands should be pnpm.
- device list /status fetch: removed in 5697904.
- 2026-10-23 ~10:40: gate G1 (daemon lanes A, B, E) closed on the Mac; all reviewed, nothing pushed (awaiting Jimmy). Next: P2 web lanes W1–W4 on the W0 skeleton. Pending Jimmy: proposed permanent tests (focus after tab change, one listSessions, align table tests); push.
