# Web, round 2: the code prefills and waits, and the handoff carries it

Repo `/Users/jimmyyao/repos/tether`, `web/`. **Do not commit, do not push.** Another agent
edits `ios/` at the same time: touch only `web/`.

Jimmy corrected the flow after using it. Three changes to what is in the working tree:

## 1. A coded link prefills; it does not enrol

`https://<host>/#code=7KQ4-XM2P` opens the enrolment screen with the code filled in and
**waits for a tap**. Delete the auto-submit (the `useEffect` in `Enrol.tsx`).
He wants to see and choose, not be enrolled by opening a link.

## 2. The handoff belongs on the enrolment screen, and carries the code

The enrolment screen gets its own **"Open in the tether app"** action (the same
iPhone/iPad gate the banner uses). It hands over the code it is holding:
`tether://add?host=<origin>&code=<code>`. It sits beside "Next"/"Enrol this browser", which
stays the option for using the browser itself.

## 3. The banner is for a page that is already enrolled

The banner on Home keeps its job, but the code it hands over depends on whether this page
spent it:

- The page enrolled in this session → the code is gone; the handoff carries **no code**
  (the app mints from the node enrolment the browser just made).
- The device was already enrolled when the link was opened (no enrolment screen, so the
  code was never used) → the handoff carries **the code**.

So the controller keeps an unspent link code as long as the page lives, and drops it only
when this page's own enrolment consumes it. That is a deliberate reversal of the earlier
"drop it the moment admission is known" rule: with no auto-submit, holding it cannot enrol
anything by itself, and the removal case now ends on a screen the reader must tap.

Both places build the URL in one function (one place that knows the scheme and its
parameters), and both use the same platform gate.

## Constraints

- Keep the two-step form and the segmented code field exactly as they are.
- `pnpm --dir web run check` must pass. Update existing harness cases; add none (Jimmy's
  standing instruction).
- Do not touch `src/`, `ios/`, the LaunchAgent or the live tether state.

## Report

What the link/prefill/tap sequence does now, what the URL looks like in each of the two
banner cases and from the enrolment screen, what happens when the page enrols and then the
device is removed, the `check` result, and anything this leaves inconsistent.
