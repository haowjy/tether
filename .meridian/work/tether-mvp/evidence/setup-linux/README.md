# Linux setup gates on pop-os (ssh `homebox`)

## S1 first run, 2026-10-25: 401 from Serve write despite a valid sudo rule

- Host: pop-os, Tailscale 1.104.1, account `jimyao` (uid 1000, in `sudo`),
  `OperatorUser: "jimyao"`, GECOS full name `Jimmy Yao`.
- `tether setup` (foreground) failed with the NotLocalAdmin message ("Allow this
  account to run `sudo tailscale`").
- `sudo -l -U jimyao tailscale` prints `/usr/bin/tailscale`, exit 0: the rule exists.
- Cause (read in source, consistent with host facts): tailscaled's
  `connIsLocalAdmin` (`ipn/ipnserver/actor.go:265`, v1.104.2 and main) runs
  `sudo --other-user=<u.Name> --list tailscale`, and `util/osuser` sets `Name` to
  passwd field 5 (GECOS). `getent passwd "Jimmy Yao"` exits 2, so sudo can't resolve
  the user and the check fails. Upstream: tailscale/tailscale#21204 (open). A comment
  there adds a second variant: tailscaled's `PATH` lacking the tailscale binary.
- Fix applied by Jimmy: `sudo chfn -f jimyao jimyao` (GECOS became `jimyao,,,`), then
  `sudo usermod -c jimyao jimyao` (GECOS `jimyao`); `tether setup` then published and
  printed a code. The `usermod` step was unnecessary: osuser tries Go's `os/user`
  first, which cuts the full name at the first comma (review p210). Not separately
  observed: whether `jimyao,,,` alone passed.
- The check exists from Tailscale 1.98.9 (`IsServingUnixAny` added to
  `ipn/localapi/serve.go`; absent in 1.98.8).
- tether follow-up done: 57cba05 + the review-fix commit name the full-name cause.

## Output after the first successful run

Jimmy found the report "really verbose" (mode line, "Published on your tailnet",
per-client enrolment steps, enroll/teardown banner, clipboard sentence, INFO listening
line, WARN for an unenrolled node opening the page). Trimmed in 35df7dd; review p210.

## Browser after enrolment: WebSocket refused (fixed 03c3af0)

- After enrolling (14:09:30), every `/ws` from Jimmy's desktop browser logged
  `device check refused request refused=browser origin is not admitted path="/ws"`;
  the picker showed "Couldn't load sessions".
- Cause: `node::admission` applied the GET rule (`Sec-Fetch-Site: same-origin`
  required) to WebSocket handshakes, against auth.md's rule (optional on upgrades).
  The browser's own headers were not captured; the inference rests on the code and on
  the fix working.
- After 03c3af0 on homebox, curl over HTTP/1.1: right Origin without fetch metadata
  -> 101; wrong Origin -> 403 either way. (An HTTP/2 curl drops the upgrade headers and
  tests nothing.) Jimmy: "the browser is now properly working".
