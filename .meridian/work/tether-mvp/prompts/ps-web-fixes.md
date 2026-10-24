# PS-web: fix the review (p136), web/ only, uncommitted

Read `meridian spawn show p136`. Fix:
- M1: decide the renderer from the snapshot's pane only, never from `resize`/`setSent`. Switch to DOM before xterm grows to a larger pane; switch back to WebGL only after a smaller snapshot has been applied (after `renderer.snapshot` resolves). Keep pane-vs-sent only for the band. Verify no WebGL dispose/create churn on a user shrink (rotation/font) and no WebGL attach at the large size.
- M2: when a claiming `watch` or Fit goes out, clear `sizedForOther` and restart the debounce so only a snapshot after the claim can raise the band.
- L3: set `claimNext` on foreground regardless of link state.
- L4: a comment stating the accepted edge case.
- Add the driver.test.ts case the reviewer proposed (uncover watch omits claim; reconnect while larger sends claim:false; refused-then-retried first watch still claims; binding sends no resize) — it pins the claim invariant.
Verify: `pnpm --dir web run check`, the real-daemon terminal e2e on 3.4 and 3.7b, `scripts/preflight.sh full`. Don't commit. Short report per item.
Spawn env TMPDIR=/tmp/tether-meridian-501.
