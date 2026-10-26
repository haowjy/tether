# iOS: a code enrols the phone's node too, so one code covers the phone

Repo `/Users/jimmyyao/repos/tether`, `ios/`. **Do not commit, do not push.** Another agent is
editing `web/` in the same tree: touch only `ios/` and the docs named below.

## Why

Jimmy's corrected flow: a setup link opened in Safari should hand the code to the **app**, and
the app should be the only thing that enrols. The browser must never enrol (he does not want to
"log in via Safari"), but the phone's Safari and PWA should still work afterwards.

Today the app's code path posts `POST /auth/enroll`, which mints a **device** token and admits
nothing else: the phone's node stays unenrolled, so Safari on the phone would still ask for a
code that has already been spent. Fix that by spending the code on the **node** first.

## What the daemon already offers (no daemon change needed)

`POST /auth/node/enroll` on the node lane, reached from an app request that sends `Origin` and
no `Sec-Fetch-*` (this is exactly what the existing empty-code mint does):

- `{code: "<code>", deviceName}` → redeems the code, enrols the phone's node, `200
  {deviceName}`. If the node is already enrolled it answers `200` and leaves the code
  unconsumed.
- `{code: "", deviceName}` → `200 {token, deviceName}`, a native token bound to the node,
  replacing any earlier token bound to it.
- `401 {error: "not_enrolled"}` for the empty-code form when the node is not enrolled; a code
  lane refusal (bad/expired code) and a node-refused refusal (policy) come back as errors with
  a message body. Read `src/http/node_auth.rs` and `src/auth/store.rs` for the exact statuses
  and messages rather than guessing.

## What to change

`AuthClient.enroll(server:code:deviceName:)`:

1. A **non-empty code**: post `POST /auth/node/enroll {code, deviceName}` with `Origin` (and no
   `Sec-Fetch-*`). On `200`, post the same route with `{code: "", deviceName}` and return that
   token, exactly as the empty-code path does today.
2. An **empty code**: unchanged (single mint).
3. Do not fall back to `POST /auth/enroll`. If the node lane refuses the node (policy), that is
   the answer: show it. If the code itself is wrong or expired, show the existing message.
4. The mint after a successful code is the only thing that can leave the phone enrolled with no
   token: retry it once; if it still fails, the reader can clear the code and tap Add again
   (the node is enrolled, so the empty-code path works). State that in the report; do not build
   UI for it.

Keep everything else: the two-step Add form, the segmented code field with the drawn separator,
Back preserving both fields, the `tether://add?host=&code=` prefill that waits for Next and Add,
`UIDevice.current.name`, and the existing error placement.

## Docs in this change

- `docs/design/auth.md`: the app's code path now enrols the node and then mints (around the
  `4b`/`4c` steps and the client summary near line 1032). Say plainly that one code admits the
  phone, so Safari and the PWA on it need none.
- `docs/design/ios-shell.md` ("Hosts") and `ios/AGENTS.md`: the sentence that says Add "posts
  `POST /auth/enroll`" is now wrong.
- Leave `CHANGELOG.md` and `docs/design/decisions.md` to the lead.

## Constraints

- `ios/scripts/check.sh` must pass (XcodeGen, `swift test`, Simulator build). **Do not install
  on the phone**, do not touch the LaunchAgent, `tether setup`, `tether enroll`, `web/`, or
  `src/`.
- No new permanent tests (Jimmy's standing instruction).
- Nothing here can be verified without the real tailnet path (`X-Forwarded-Host` comes from
  Tailscale Serve): say plainly which parts need the phone.

## Report

The exact request sequence for a code and for no code, what the form shows on a bad code and on
a refused node, what you deleted or left in place, the `check.sh` result, and anything in this
brief the code contradicts.
