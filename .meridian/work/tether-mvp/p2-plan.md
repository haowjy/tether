# P2: web screens on the W0 skeleton

Source of truth: design/client-architecture.md rev 4, §11 (lanes, ownership, hand-off
protocol) and §12 (gates). This file records how the lead runs it.

```
enabling: 4cf8b10 per-lane e2e port; ec6f848 CI web toolchain; tmux 3.4/3.7b built at ~/.cache/tether-tmux (p90, 16/16 each)
W1 Home/picker/Settings ─┐
W2 Terminal/desktop input├─▶ G2: reviewers per lane + structural + browser prober ─▶ P3a, P3b (after W2)
W3 Files                 │
W4 PWA                   ┘   (W4's served-bundle gates need Serve: queued for Jimmy's Linux box)
```

| Lane | Spawn | e2e port | Daemon isolation | State |
|---|---|---|---|---|
| W1 | p91 frontend-coder | 5211 | TMPDIR=/tmp/tether-meridian-501/w1, private config/state, tmux -L w1-* | built (uncommitted) |
| W2 | p92 frontend-coder | 5212 | TMPDIR=/tmp/tether-meridian-501/w2, tmux -L w2-* | built (uncommitted) |
| W3 | p93 frontend-coder | 5213 | TMPDIR=/tmp/tether-meridian-501/w3 | built (uncommitted) |
| W4 | p94 frontend-coder | 5214 | — | built (uncommitted) |

Rules for this phase:
- Coders don't commit; the lead commits each reviewed change by pathspec within the
  lane's files and preflights it (`scripts/preflight.sh full --commit <sha>`).
- W0-owned files (ui/, workspace/, app/, net/, platform/types.ts, platform/browser/index.ts,
  harness/index.ts, repo config, package.json): lanes write requests to
  lanes/<lane>-requests.md and keep a local stand-in; the lead lands each request first.
- Lanes write doc notes (decisions, browser-behaviors, plan, CHANGELOG) to
  lanes/<lane>-notes.md; the lead edits those docs.
- Open for Jimmy, not blocking P2: §14 drafts of closed tabs (P3a).

## Integration (2026-10-23)
All four lanes built and verified alone (W1 24 real-daemon e2e on 3.4/3.7b; W2 40/40 real
daemon; W3 208 e2e; W4 8/8 gates on a Node stand-in). ~20 W0 requests outstanding. Lanes done,
so the request protocol is retired: one integration writer, p95 (frontend-coder), lands the
W0 requests, removes stand-ins, unifies one real-daemon e2e stack, folds lane notes into docs,
and commits in preflight-passing order.
Lead calls: one e2e stack (W2's front proxy standing in for Serve, daemon --allow-login),
no LocalAPI override in the daemon; tsx grammar added; Home's phone Files pane renders
FilesScreen. Deferred: input refusal carries no req (L4); fresh install cannot add a root
from the app (question for Jimmy). Proposed tests awaiting Jimmy: W1 keyboard walk of Home
and picker; W2 bufferText (soft wrap, hard break, blank lines, indentation).
Then G2: per-lane reviewers + structural + browser prober.
- Jimmy (2026-10-23): add the two proposed tests after integration: Playwright keyboard walk of
  Home and the picker (e2e/home), and a vitest unit test of term bufferText (soft wrap, hard break
  at the exact column, blank lines, indentation). Add-root-from-app: explained the roots model,
  recommended an "Add folder…" on the Files roots list using /fs/roots/add and the $HOME picker;
  awaiting his answer.
- Jimmy approved "Add folder…" (2026-10-23): on the Files roots list, a $HOME-scoped folder
  picker (fs.md picker scope) that calls POST /fs/roots/add; remove from roots too
  (/fs/roots/remove). Follow-up lane after p95, with the two tests. Log in decisions.md
  (reverses the §3.1 removal, by Jimmy's call).
- 13:47 G2 started at d051e21: correctness W1+W2 p96, W3+W4 p97, browser probe p98. Follow-up lane p99 (Add folder, listing coalescing, keyboard walk + bufferText tests). Thermo after fixes.
- Jimmy (2026-10-23), client-architecture §14 resolved: drafts of closed tabs are KEPT (at most
  32, back when that window is opened again); rejected: deleting with the tab (loses text).
  Fold into decisions.md and §14 after p99 lands (it is editing both); P3a builds it.
- Serve gates: proposed running real tailscaled + tether in a Linux container on the Mac (Docker
  installed, not running) joined as its own ephemeral untagged node; awaiting Jimmy (start Docker,
  auth key at ~/.config/tether-test/ts-authkey).
- p97 (W3+W4) request changes: H1 double upload on re-pick (uploads.ts listener), H2 markdown <area> off-site nav (deny-list sanitizer -> allowlist; click handler a,area), M3 insert path passes C0 controls (refuse), L4 insert to disconnected tab, L5 sw no network fallback for missing hashed asset, L6 cached CSP/origin frozen at install, L7 update after hard reload, L8 refuse >128 MiB client-side, L9 mailto, L10 multi-host note. Fix lane after p99 lands (it owns files/ now).
- p96 (W1+W2) request changes: H1 close never sends unwatch -> MAX_WATCHES=2 leak, new tabs stuck
  reconnecting (fix in TabDriver.close; class), M1 resize during in-flight watch lost, M2 watch
  error retries ~2 Hz forever and hides message (attempt+1, keep message), M3 Settings closeAll
  double back fails in WebKit, M4 snapshot callback un-blanks a superseded tab; L1 saves on
  unsaved fields, L2 image-paste "Inserted" when queued, L3 storage banner resizes tmux.
- p98 probe: mostly pass; DEFECT attachedElsewhere warning missing on Home (both browsers, 3.4 and
  3.7b; p95 had reported it passing). WebKit vim/less flaky under load.
- Next: one G2 fix lane for p96+p97+p98 after p99; then thermo lane on P2; then push.
