# P3a: final small fixes (round-2 reviews p132, p133), web/ only, uncommitted

Read `meridian spawn show p132` and `meridian spawn show p133`. Fix:
- p132 M1: compute `keyboard` from `stableHeight − visibleHeight >= 120` (scroll-independent); keep `keyboardInset` only for positioning. Fix the contradiction at client-architecture.md:549 vs :603 to the new rule.
- p132 L1 / p133 L1: scope the touch focus-ring rule to `[data-initial-focus="touch"]` (the close button); fix the comment's pointer to `ui/theme.ts`.
- p132 L3: in the drafts reducer `listed`, when a draft already exists take the record's revision as its `revision` and `base` and keep the local text.
- p133 L3: `withdraw` unfollows the element unconditionally before the targets check.
- p133 L2: compute the lift once — the pan-area effect reads the lifted row's `getBoundingClientRect().top`; delete `lift`, the slot ref, the safe-area dependency.
- p133 nits: build labels inside `tabPills`; move the `root` ref into `SwitcherBody`.
- p132 L2 (iPad touch tools row) and L4: log in `web/.context/TODO` for P3b; no code.
- Add the two-hosts-share-a-req case to `drafts/state.test.ts` (both reviewers proposed it; it's in a spec-named suite).
- Add to `.meridian/work/tether-mvp/g3-iphone-checklist.md`: keyboard stays up when Safari scrolls the page with the line field focused; pinch-zoom on the dock with keyboard up; autocorrect applied before Return sends (type a misspelling that autocorrects, press Return, check the sent text).
Verify: `pnpm --dir web run check`, dock real-daemon e2e on 3.4 and 3.7b, `scripts/preflight.sh full`. Don't commit. Short report per item.
Spawn env TMPDIR=/tmp/tether-meridian-501.
