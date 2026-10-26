# Daemon fixes: the mint must be unreachable from browser script, bounded, and revocable by invariant

Repo `/Users/jimmyyao/repos/tether`. **Do not commit, do not push.** Two other agents edit
`web/` and `ios/` at the same time: touch only `src/` and the daemon docs.

The review is `.meridian/projects/steep-lamp-cloud/spawns/p270/report.md` (findings 1, 2,
3, 6, 7 and the `Device.node_id` comment). Read it; it has the probes and file:line.

## 1 (High). Browser script on tether's origin must not be able to mint

`docs/design/auth.md` says a browser never needs a portable token, and the new text says
the mint "does not grant access the node didn't already have". Both became false: a
request carrying the headers a browser sends (`Origin` = canonical, `Sec-Fetch-Site:
same-origin`) mints a token that then works from any node, and survives the node's own
rules failing (tags, shared, login).

**Fix:** in the empty-code branch of `POST /auth/node/enroll`, refuse when the request
carries any browser fetch metadata — `Sec-Fetch-Site`, `Sec-Fetch-Mode` or
`Sec-Fetch-Dest`. Browsers always send these on `fetch`, and page script cannot remove
them; `URLSession` sends none. `Origin` still has to pass the node admission check, so
CSRF protection is unchanged. The app drops `Sec-Fetch-Site` on its side (the lead is
making that edit). Keep the non-empty-code branch exactly as it is: the browser's own
enrolment sends a code and must keep working.

Update the refusal so it is distinguishable in a log, and state the rule in
`docs/design/auth.md` and `src/http/AGENTS.md`: the mint is for a native client, browser
script cannot reach it.

## 2 (Medium). Bounded mints

Every empty-code call adds a row, and the app calls it once per Add, so re-adding a host
orphans a live token. In the same `update` closure that adds the new row, remove the
native rows already bound to this `node_id` first, so one node holds one app token and
re-adding cleans up after itself. Say so in the store doc and `docs/design/auth.md`.

## 3 (Medium). Revocation becomes an invariant, not a delete path

`check_native` and `recheck` (`src/auth/mod.rs`) look only at the token hash, so a bound
token stays valid if its node row disappears — reachable by downgrading to a build older
than `d511474`, removing the node, and upgrading. When a native device carries
`node_id`/`login`, require a node row with the same `node_id` and `login` in the same
file read; refuse otherwise. No extra I/O. The deletion in `remove_node_rows` stays as
cleanup. Note it in `src/auth/AGENTS.md`.

## 6 (Low). The CLI should show the binding

`tether device list` shows a bound token as plain `native`: print it as `native (node
<name>)`. `tether device remove <node>` silently removes the bound tokens: report what
went with it ("Removed laptop and 1 token"). `src/main.rs`, `docs/running.md`.

## 7 (Low). Stale text

`Device.node_id`'s doc comment in `src/auth/store.rs` still says "for a browser device".
Fix it. Leave `CHANGELOG.md`, `docs/design/decisions.md`, and the work-dir note to the
lead.

## Constraints

- Rust 1.85 compatible (`cargo +1.85 check --locked --all-targets`).
- **No new permanent tests** (Jimmy's instruction). Update existing tests the change
  falsifies, and verify by running: `cargo fmt --check`, `cargo clippy --all-targets -D
  warnings`, `cargo test`, MSRV check. You may write a throwaway probe like the
  reviewer's and delete it.
- Do not restart the deployed LaunchAgent, do not run `tether setup`/`tether enroll`, and
  leave the live auth state alone (tests use temporary directories).

## Report

For each finding: what you changed, how you verified it (a probe's output for 1 and 3 is
worth more than reasoning), what you rejected, and anything that still depends on a
delete path or on a client's behaviour.
