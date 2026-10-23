# W1 notes for the lead (decisions.md, browser-behaviors.md)

Departures and judgement calls, each with what was rejected.

- **Open-tabs empty state is one muted line**, not the large EmptyState: the sessions list stays
  above the fold. Rejected: the centred empty block (pushed sessions down ~120 px).
- **"Updating" and stale status sit beside the "On pop-os" heading**, and "Updating" fades in
  after 250 ms. Rejected: a status row above the list (shifts rows on every Home entry).
- **Offline/refused/no-server/empty/no-match are distinct EmptyStates** with their own copy;
  "New session" is disabled with its reason only when the host is unreachable. Creation is
  left enabled with no tmux server (an explicit user action; tether still never starts tmux itself).
- **Creation results open from the next listing**: `created` carries refs, not names, so the tab
  is opened when a listing holds the new window (5 s cap, then "Created, but it hasn't appeared
  in the list yet"). Rejected: inventing names from the form.
- **Closing an overlay by an action waits for the pop** (`closeOverlayThen`): activating first
  would push the Terminal entry before `history.back()` lands, and the pop would undo it.
- **Expansion keys are `<server run>/<session id>`**, so a restarted tmux doesn't inherit open
  groups; a listing drops keys of vanished sessions.
- **Settings confirmations are overlays** (`settings/removeDevice`, `settings/clearData`) so Back
  returns to Settings. Clear local data deletes storage only; open tabs stay until closed (the
  spec says "drafts and the saved workspace on this device"). Remove this device says "this
  device" for `<node>` (request 3).
- **Open-tab rows have a sibling close button**, not a nested one; a restoring tab shows "Checking…".
- Verification harness: real daemon run is `e2e/home/run-real.sh <3.4|3.7b>`; needs the
  patched daemon (request 8) and a Serve stand-in in front of Vite (`serve-front.mjs`), because
  browsers can't add `Tailscale-User-Login` to a WebSocket upgrade.
