# iOS, round 2: the link prefills a code and waits; it does not enrol by itself

Repo `/Users/jimmyyao/repos/tether`, `ios/`. **Do not commit, do not push.** Another agent
edits `web/` at the same time: touch only `ios/`.

Jimmy used the flow and corrected it. What is in the working tree auto-enrols on
`tether://add?host=…`; that is not what he wants.

## The rule now

- **The link prefills the form and waits.** `tether://add?host=<origin>&code=<code>` opens
  *Add server* at step 1 with the server filled and, when the link carries one, the code
  filled too. Nothing is sent until he taps Next, then Add.
- **A link with no code** still needs the node-mint path: empty code, Add, the existing
  `POST /auth/node/enroll` with `Origin` only. Keep that.
- **A link with a code** takes the code path: Add posts `/auth/enroll` with the code, as
  the manual flow does today.
- Delete the auto-enrol, its progress state, and the unlock-and-resume machinery that only
  existed to make it work. Keep the failure handling that belongs to a *tap*: a wrong or
  expired code and `not_enrolled` show where they already show.

Everything else from the last round stays: the two steps, the segmented code field with
the drawn separator, Back preserving both fields, and `UIDevice.current.name` as the
device name.

## Constraints

- `ios/AGENTS.md` and `docs/design/ios-shell.md` ("Hosts") get the corrected description.
- `ios/scripts/check.sh` must pass. **Do not install on the phone**; do not touch the
  LaunchAgent, `tether setup`, `tether enroll`, `web/` or `src/`.
- No new permanent tests (Jimmy's standing instruction).

## Report

What a link with a code does, what a link without one does, what the form shows on each
failure, what you deleted, the `check.sh` result, and what still needs the phone.
