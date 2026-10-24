# Lane P4b: the web half of the native shell (W5) and the end-to-end native app

P4a (lane p140, review p142; read both with `meridian spawn show`) built `ios/` and the Swift side of bridge v2. Your handoff is `.meridian/work/tether-mvp/p4b-web-bridge.md`; the spec is `.meridian/work/tether-mvp/design/client-architecture.md` §5 (§5.2 transport, §5.10 bridge v2) and its W5 row in §11, plus `docs/design/ios-shell.md`. Phone-input rules: `.meridian/work/tether-mvp/phone-input-decisions.md`. Repo rules: AGENTS.md (pnpm only, MSRV, no team ID in files).

## Already settled and built on the native side (ab61cd5)
The socket URL comes from native: the Link sends `{type:"socket", host}` and gets `{url, token}` | `{locked:true}` | `{notEnrolled:true}`; URL and token stay in the Link (decisions.md, ios-shell.md Transport). The web pushes `activeTab` when it changes (native no longer calls the page's `activeTab()`; delete that export). Host management: the web's entry sends `manageHosts`; once it exists, delete the floating native Servers control (`ios/Tether/App/RootView.swift`). Update §5.2/§5.10 of client-architecture.md to match what native built (lifecycle as full snapshots, `socket`, `activeTab`, `manageHosts`, `copy` always writes).

## Build
- `platform/native/` adapter at bridge v2; move `web/native/bridge.ts` there and delete `web/native/` and its lint exemption in `lint/rules.js` (`web/.context/TODO`).
- Decode every fixture in `ios/TetherKit/Tests/Fixtures/bridge/` in a web unit test, so both sides pin one contract.
- The `web/.context/TODO` W5 items: ⌨ toggle in native (register the terminal responder path so `FocusController.toggleKeyboard` works), consume `keyboardInset` and `safeArea` (P4a's screenshot shows the status bar over the header and the native Servers control over Home copy — fix that overlap, decide which side owns that control), native `setFocus("select")` and callout suppression for P3b's selection.
- P4a reviews (p142, p148) are closed; their device-only hypotheses are in ios-shell.md's checklist.
You may edit `web/`, `ios/`, the docs named above, and `CHANGELOG.md`.

## Verify
`pnpm --dir web run check`, `ios/scripts/check.sh`, `scripts/preflight.sh full`. Simulator (iPhone 17 Pro; the software keyboard can't show here) against a real daemon on scratch tmux 3.4 (`-L`, never Jimmy's sessions) on this Mac: since the Mac has no Tailscale Serve, add the host by a reachable URL the native host store accepts in Debug and say what you used: boot, add host, open a window, type via hardware keyboard (`xcrun simctl` / Simulator keyboard), rotate (tmux rows unchanged with the keyboard down), background and resume (socket returns), Home search from Terminal. Screenshots in `$MERIDIAN_ACTIVE_WORK_DIR/evidence/p4b/`. Device-only checks go in ios-shell.md's Device checklist and `g3-iphone-checklist.md`. Don't commit. Report files, spec → implementation, verification, divergences.
Spawn env TMPDIR=/tmp/tether-meridian-501.
