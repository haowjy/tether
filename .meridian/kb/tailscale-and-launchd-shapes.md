# tailscaled and launchd: test against what they really store and print

tether reads and writes state owned by other programs: tailscaled's LocalAPI (status,
whois, the Serve config) and macOS `launchctl`. Their real shapes differ from what a
reasonable reading of their types or docs predicts. A fixture written from that
reading passes tests the real program fails. Build fixtures from captured real answers,
and when tether writes something and reads it back, test the read against what the
program stores, not against what tether sent.

The rules themselves live with the code that follows them: how tether publishes and
withdraws its Serve entry is in `docs/design/auth.md` (sections on the canonical origin
and the Mac front) and `docs/design/setup.md`, and the LocalAPI field names are in
`src/auth/localapi.rs`. This page records
the mismatches found so far, so that a new reader of these programs checks for the
same kind.

## Mismatches found so far

| Program | What a client would assume | What it actually does | What broke |
| --- | --- | --- | --- |
| tailscaled Serve config | A `Web` entry can carry `HTTPS: true` | `WebServerConfig` keeps only `Handlers` and drops the field silently; HTTPS lives in `TCP[port].HTTPS` | Setup planned a `Web` entry with `HTTPS`, read back one without it, judged the stored config out of date, and rewrote Serve on every rerun |
| LocalAPI status vs whois | The stable node ID has one field name | Status's `Self` (`ipnstate.PeerStatus`) names it `ID`; whois's `tailcfg.Node` names it `StableID` | tether read `Self.StableID` from status, found it empty, and failed the first Mac host probe |
| tailscaled Serve permissions | The operator may write any Serve config | From Tailscale 1.100, a non-root user may write a config that serves any Unix socket or path only if they are tailscaled's operator (`tailscale set --operator`) and may also run `sudo tailscale` (`IsLocalAdmin`); otherwise `401`. Any write by a non-operator gets `403` with body `serve config denied`. Before 1.100 an operator could serve a Unix socket without sudo | A Linux setup tested only on 1.98 would never see the `401`, so setup's tests and probe cover both versions |
| `launchctl print-disabled` | Prints `=> true` or `=> false` | Current macOS prints `=> disabled` or `=> enabled`; older releases print `true`/`false` | Setup looked for `true`, so it never saw a disabled job, skipped `launchctl enable`, and `bootstrap` failed. It now accepts both forms. Unverified: whether turning tether off under Login Items shows up in `print-disabled` at all on current macOS; if it doesn't, setup can't detect that case this way |

## How to check a new field or format

- Save the real program's answer on the host that serves it: the Linux box for
  `serve.sock` paths, the Mac for the app's LocalAPI
  ([probe-environments.md](probe-environments.md)). Redact secrets, and use the saved
  answer as the test's input.
- Where tether writes state and later reads it back (its Serve entry is the main case),
  feed the planner the config as tailscaled stores it after tether's own write, and
  require the plan to change nothing.
- When a format differs across versions, accept every form tether supports and name
  the versions in the code comment.
