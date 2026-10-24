# P3a: fix round 1 (reviews p127 behaviour, p128 structure, probe p129, tech lead)

Read `meridian spawn show p127`, `meridian spawn show p128`, `meridian spawn show p129` in full. Fix everything below; still uncommitted, `web/` only (another coder is editing `src/` concurrently — don't touch it, nor `web/proto/generated/messages.ts`).

## Bugs (must)
- p127 H1 / p128 L1: the tab chip blurs the held input so the switcher never hands the keyboard back. Make `DockButton` always cancel `pointerdown` (delete the per-caller handlers) so no dock control can move focus; verify the owner returns after a pill tap / close / backdrop.
- p127 H2: held ↑/↓ repeats forever when the key row unmounts. Stop on unmount and on `lostpointercapture`.
- p127 M1: drafts reducer conflicts with its own in-flight write. Serialise puts per key (or track own last-issued revision as base) — pick the simpler.
- p127 M2 / p128 H1: line answers keyed by bare per-host `req`. Take p128's move 1: one sink — `Terminals` emits `(tabId, PasteResult)`, `LineDrafts` claims answers for lines it has pending keyed by (tab id, req), everything else falls through to the notice. Delete `lineWaiters`, the waiter cleanup in `sync()`, the answer callback, the closure in `LineField.send`. Fix client-architecture §7.4 "keyed by req".
- p127 lows: cross-page draft delete broadcast carries the key; toggle `disabled={!tab && !holding}`; a11y names (`^R` "Control R", `^C` "Control C"; chip label includes its visible name; hide xterm's inert textarea from the a11y tree in owned mode); the self-contradicting reload copy; `restore()` respects the 32 cap.
- Tech lead, from the Simulator screenshots: (a) the switcher's search + New session must be pinned to the bottom of the sheet (thumb reach), not float under the list with empty space below; (b) opening the switcher by touch shows a blue focus ring on Close — no visible focus ring for touch-initiated focus (keep it for keyboard).

## Structure (p128)
- Move 2: armed modifiers into a small store in `touch/`; `Terminals` exposes `type()`; owned input calls the store. `Terminals` loses the dock methods/armed field. Replace `pasteFrom(DataTransfer)` with `paste(pasted)`.
- Move 3: one keyboard inset (`--keyboard-inset` set by `applyViewport`, or a Viewport field); dock lift, dialog rise and toast offset become CSS using it; delete `Dialog`'s `rise` prop, the `[style*=--sheet-rise]` selector, Switcher maths, the toast TODO (toasts now clear the keyboard).
- M2: `useTabLabels()`, `tabPills(...)` in `tabView.ts`, and tab activation that can't forget the nudge.
- M3: tokens — radii/spacing from scales; add `--dock-key-height`, `--dock-control-height`, `--dock-keys-height` component tokens; 16px Safari font may stay raw with its comment.
- L2–L6: SessionList wording via a computed per-row tab id; switcher hosts reactive via `useAppView`; delete dead `LineDrafts.text()`, test-only export, make `sendPaste` private/boolean; drop the focus cast; rename `homeOrPicker`; owned-input locator by aria-label; build notes record TabChip/DockRow inlined and the other p127 undocumented divergences (or extract — your call, simpler wins).
- Native toggle gap (p127 low): log the W5 hand-off in `web/.context/TODO` and the build notes; don't build native.

## Tests
Add only these regression cases to the spec-named suites: `drafts/state.test.ts` two flushes before `stored`; `e2e/dock` owner returns after a switcher pill tap, and ↑ stops when the key row unmounts mid-hold. Delete other scratch checks.

## Verify
`scripts/preflight.sh full` (if it fails only in `src/` from the concurrent lane, say so and run the web parts: `pnpm --dir web run check` + the Playwright suites), the dock real-daemon e2e on tmux 3.4 and 3.7b, and fresh WebKit phone screenshots of the switcher and dock states into `$MERIDIAN_ACTIVE_WORK_DIR/evidence/p3a/` (overwrite). Report what changed per finding.
Spawn env TMPDIR=/tmp/tether-meridian-501.
