# iOS: add a host with no code by trading node admission for a device token

Repo `/Users/jimmyyao/repos/tether`, `ios/`. **Do not commit, do not push.** Another agent
edits `src/` at the same time; touch only `ios/`.

Read `.meridian/work/tether-mvp/app-handoff.md` and the working tree's current iOS diff
first: an earlier pass already added the `tether://add?host=…` scheme handling and
*Add server* prefill, and also a **tokenless host** path that has to go.

## Why the tokenless path has to go

The app's web UI is served from `tether-app://ui`, so the terminal WebSocket carries that
origin, and node-lane admission requires the canonical HTTPS origin
(`src/auth/node.rs:142-149`). A tokenless host therefore cannot open a terminal. Jimmy
chose to have the daemon mint a device token for an already-enrolled node instead.

## The new contract (being implemented in `src/` in parallel)

`POST /auth/node/enroll` with `{"code": "", "deviceName": "…"}`:

- `200 {"token": …, "deviceName": …}` when this phone's node is already enrolled — the
  same shape `/auth/enroll` answers, so `AuthClient.enroll`'s decoding is reusable.
- `401 {"error":"not_enrolled"}` when the node is not enrolled.

## What to change

1. **Keep** the scheme registration in `ios/project.yml`, and the `onOpenURL` →
   *Add server* prefill (host filled, code empty). Verify it still validates through
   `AuthClient.serverURL`.
2. **Replace** the tokenless path: with the code empty, the app posts to
   `/auth/node/enroll` with its device name and, on `200`, saves the host **with the
   returned token**, exactly as a code enrolment does today (Keychain token, lock screen,
   native-lane transport unchanged).
3. **Delete** what the tokenless design added and nothing needs now: the node-authenticated
   host state, its persistence, its transport/proxy/upload/video header special cases, and
   the "no token ⇒ don't lock" branches. A host always has a token again. Prefer deleting
   over keeping a fallback: the node-mint path covers the case.
4. On `401 not_enrolled`, tell the reader to run `tether enroll` on the server for a code,
   then add the server with that code. Keep the code-entry path working exactly as today.
5. Revert any `ios/AGENTS.md` text the earlier pass added that describes tokenless hosts,
   or make it describe the scheme and the node-mint path if it still earns its place.

## Constraints

- The bridge contract has one copy: `TetherKit/Tests/Fixtures/bridge/` plus
  `web/platform/native/`. If the earlier pass changed a bridge DTO, check whether the
  fixture needs the same change; do not leave the three out of step. Prefer removing the
  DTO change with the tokenless path.
- `ios/scripts/check.sh` is the gate (`swift test` + Simulator build). **Do not install on
  the phone** (`xcrun devicectl`), do not touch the LaunchAgent, and do not run
  `tether setup` or `tether enroll`.
- No new permanent tests (Jimmy's standing instruction).

## Report

What the empty-code path does now end to end (request, response, what is stored); what you
deleted from the tokenless pass; whether any bridge fixture changed; the `check.sh` result;
and anything that still cannot work on a node-admitted phone.
