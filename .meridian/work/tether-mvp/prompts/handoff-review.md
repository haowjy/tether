# Review: an enrolled node mints a device token for the app

Repo `/Users/jimmyyao/repos/tether`. Review the code **as it stands** in the working tree:
the daemon change is committed as `d511474`, the iOS and web changes are uncommitted.
**Edit and commit nothing.** Do not restart the deployed LaunchAgent
(`com.jimmyyao.tether`), run `tether setup` / `tether enroll`, or touch the live auth
state under `$XDG_STATE_HOME`; the daemon is serving Jimmy's tailnet from this Mac.

## What this is for

Jimmy opens the setup link in Safari, which enrols the phone's **node**. The iOS app on
the same phone then had to be enrolled again with a second code. The fix: an
already-enrolled node can mint a native device token with no code, so one code covers the
phone and the terminal WebSocket still uses the native lane. Context and the rejected
alternatives: `.meridian/work/tether-mvp/app-handoff.md`.

## What changed

- `src/http/node_auth.rs`: `POST /auth/node/enroll` splits on the code. Empty code +
  `Session::Node` mints a token; empty code + `NodeUnenrolled` refuses with
  `not_enrolled`; a non-empty code behaves as before.
- `src/auth/store.rs`: `add_native_for_node` (rechecks enrolment under the write lock,
  binds the token to the node), `remove_node_rows` (removing a node also removes the
  tokens bound to it), `Device::valid` now allows a native device that carries
  node_id+login.
- `src/auth/AGENTS.md`, `src/http/AGENTS.md`, `docs/design/auth.md`, `docs/running.md`,
  `CHANGELOG.md`.
- `ios/Tether/Auth/AuthClient.swift`: empty code posts to `/auth/node/enroll` with
  `Origin` and `Sec-Fetch-Site`; `401 not_enrolled` becomes a "run tether enroll"
  message.
- `ios/Tether/Hosts/HostViews.swift`, `AppModel.swift`, `TetherApp.swift`,
  `ios/project.yml`: the `tether://add?host=…` scheme and the empty-code Add path. An
  earlier pass's tokenless-host design was deleted.
- `web/app/controller.ts`, `persist.ts`, `platform/browser/links.ts`, `platform/types.ts`,
  `screens/enrol/Enrol.tsx`, `screens/shell/AppBanners.tsx`, `ui/primitives/Banner.tsx`:
  a one-time "Open in the tether app" banner after the browser enrols.

## The risks I want checked

- **The auth change is the important one.** Can a request that is not from an enrolled
  node reach the mint? Can a *browser* on some other node mint a token for a node it does
  not belong to? Is the empty-code branch reachable through anything but the node lane
  (the `device_check` router shares `/auth/*` routes)? Does the token give exactly what a
  code-enrolled token gives, or more?
- **Revocation.** Remove the node: is every credential it minted gone? What about a node
  removed while a mint is in flight (the store rechecks — is that airtight)? What does
  `tether device remove <node name>` do now, and is that intended?
- **`Device::valid`.** It now accepts a native device with node_id+login. Does anything
  else assume native devices have neither, e.g. listing, `tether device list`, removal
  by name, or the auth file schema/version?
- **Unbounded growth.** Every empty-code call mints a new token. Is there a bound, and
  does the app call it once per Add?
- **iOS headers.** The app sets `Origin` and `Sec-Fetch-Site` but not `X-Forwarded-Host`;
  `src/auth/node.rs:131` requires it. Does tailscale serve add it on the real path, and
  is anything else needed for a POST from URLSession? Say plainly whether this can be
  known from the code or needs the phone.
- **Web banner.** Anything that makes the enrol flow worse: a banner that reappears, a
  dismissal that writes too eagerly, the `tether:` scheme reaching a browser that cannot
  open it, or the saved-workspace field breaking the native bridge/fixtures.

Report findings by severity with file:line, what you checked by reading versus running,
and a verdict. If something is a matter of taste, say so.
