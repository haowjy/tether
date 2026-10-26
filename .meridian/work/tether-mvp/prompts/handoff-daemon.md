# Daemon: an enrolled node can mint a device token without a code

Repo `/Users/jimmyyao/repos/tether`. **Do not commit, do not push.** Another agent edits
`ios/` at the same time; touch only `src/` and the daemon docs named below.

Read `.meridian/work/tether-mvp/app-handoff.md` first for why this exists.

## The problem

The web app enrols the phone's **node** (`POST /auth/node/enroll`). The iOS app on the
same phone is then admitted for HTTP by node identity, but its terminal WebSocket is
created by JavaScript from `tether-app://ui`, and node-lane admission requires the
WebSocket's `Origin` to be the canonical HTTPS origin (`src/auth/node.rs:142-149`). So the
app cannot use the terminal without a device token, and today getting one costs a second
enrolment code.

## The change

`POST /auth/node/enroll` takes `{code, deviceName}`. Split on the code:

- **Non-empty code** — exactly today's behaviour. Do not touch it.
- **Empty code** — no code is redeemed:
  - session `Session::Node` (this node is already enrolled): mint a **native device
    token** bound to that node and answer `200` with the same JSON `/auth/enroll`
    answers (`{"token": …, "deviceName": …}`), so the app reuses its existing client.
  - session `Session::NodeUnenrolled`: answer `401` with `{"error":"not_enrolled"}`, the
    same refusal a browser gets from `/auth/node/session` when its node is not enrolled.

Binding and revocation matter:

- The minted device records `kind: Native`, `node_id: Some(node.id)`,
  `login: Some(login)`, `enrolled_by` as today.
- `Store::remove_node` (`src/auth/store.rs:289`) must also drop native devices whose
  `node_id` matches, so removing the phone revokes the app's token. Update its doc.
- Reuse the store's existing helpers (`unique_name`, token generation/hash, the
  `Added` shape) rather than growing a parallel path. Run the mint on the auth lane like
  every other store write.

## Security argument to record in the docs

A request reaches this branch only after the node lane has proved, from tailscale's own
whois, that the request comes from that node, that `X-Forwarded-Host` names this daemon,
and that its `Origin` is the canonical one. A node already enrolled is already admitted
for every HTTP route; a token lets its app use the native lane (terminal WebSocket) as
well. Keep the code path and the token path separate: a token never replaces a code for a
node that is not enrolled.

Update `docs/design/auth.md` (the model and this exchange) and the daemon doc that
describes the node routes, in the same change. Leave `CHANGELOG.md` and
`docs/design/decisions.md` to the lead.

## Constraints

- Keep Rust 1.85 compatibility (the pinned toolchain is newer; `cargo +1.85 check --locked
  --all-targets` is the gate).
- **No new permanent tests** (Jimmy's standing instruction). Update existing tests the
  change falsifies; verify by running the suites.
- **Do not restart the deployed LaunchAgent** (`com.jimmyyao.tether`), do not run
  `tether setup` or `tether enroll`, and do not touch the live auth state under
  `$XDG_STATE_HOME`. Tests that need a store must use their own temporary directory.

## Done means

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and
  `cargo +1.85 check --locked --all-targets` pass.
- Report: the exact request/response for both branches, where the token is bound to the
  node and where it is revoked, what you rejected, and anything in this brief the code
  contradicts.
