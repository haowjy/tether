# Mac front M0–M8 probe evidence (rerun after status ID fix)

Run date: 2026-10-24 local. Host: `jimmys-macbook-air.tail852a76.ts.net`; Tailscale Standalone 1.104.2. CLI: `/Applications/Tailscale.app/Contents/MacOS/Tailscale` (`tailscale` was not on this shell's PATH). All Serve captures containing the published path were temporary files under `/tmp`, never copied into this evidence file, and removed after cleanup. No `tailscale bugreport` was run.

## Baseline and setup

- Before setup, `tailscale serve status --json` returned `{}` (exit 0). Saved privately for final byte comparison.
- `cargo install --path .` completed: `Finished release profile [optimized] ... 21.89s`; installed/replaced `~/.cargo/bin/tether`.
- No existing `~/.config/tether/config.toml` or `~/Library/LaunchAgents/com.jimmyyao.tether.plist` was present. Wrote only `[tmux]\nsocket_name = "tether-gate"` to the new tether config and rendered the supplied plist placeholders. `plutil -lint` reported `OK`.
- `launchctl bootstrap gui/501 ...` succeeded without sudo. `launchctl print` showed `state = running`, `runs = 1`; listener was `127.0.0.1:7851`. Process environment included `HOME=/Users/jimmyyao`, launchd `TMPDIR=/var/folders/.../T/`, and the plist-provided `PATH`. `tmux -L tether-gate list-sessions` listed only the probe-created `gate-probe`; the default tmux server was never listed, attached, or touched.
- The fixed build published successfully. Status JSON contained one `Web` entry for this host and only a `/` handler. `GET https://jimmys-macbook-air.tail852a76.ts.net/auth/info` returned `200`, 195 bytes.

## Gate results

| Gate | Result | Evidence / limit |
|---|---|---|
| M0 | **Partial** | Agent install/bootstrap, launchd environment, isolated tmux endpoint, and successful Serve publication passed. The daemon logged `INFO listening on private fronts serve_front=127.0.0.1:7851 ... tmux=Endpoint { program: "tmux", socket: Name("tether-gate") }`. Login/logout, Login Items, lock screen, `/fs` TCC/proof-file behavior, reboot temp cleanup, and occupied-port withdrawal remain unverified. After bootout, a Python bind attempt to `127.0.0.1:7851` failed `errno=48 Address already in use`, despite no listener shown by `lsof`/`netstat` and curl returning connection refused; therefore no safe occupied-port setup was available. |
| M1 | **Partial** | Normal publish passed without sudo: host entry appeared with only `/`, and request returned `200`. Starting config was empty and final config was byte-identical to it. Did not create unrelated entries, mutate fields, race a CAS update, or induce Funnel/forward/handler conflicts: the constraint prohibited manual Serve-config changes beyond tether's own publish and required stop command. |
| M2 | **Partial** | Through Serve: `GET /auth/info` → `200` (195 bytes); `HEAD /auth/info` → `200` (0 body bytes); malformed `POST /auth/enroll` with `{}` → `422` (23 bytes), showing route-level validation. WebSocket upgrade to `/ws`, including an `Origin` for the canonical host, returned `403` (22 bytes), not `101`; daemon log said `device check refused request refused=browser origin is not admitted path="/ws"`. Direct requests to the port for no prefix, wrong same-length secret, one-byte-short secret, missing trailing slash, percent-encoded first secret byte, `/x/../…`, and `//…` each returned empty `404` (0 body bytes). The secret was not present in tether's log; neither `Authorization` nor `Sec-WebSocket-Protocol` values appeared there. Actual WebSocket establishment remains unverified. |
| M3 | **Partial / discrepancy** | Through Serve, forged `Host: evil.example` returned `403` (21 bytes), as expected. Forged `X-Forwarded-Host: evil.example` returned `200` (195 bytes), not the expected `403`. Direct valid-secret requests with missing or doubled `X-Forwarded-Host` both returned `403` (21 bytes). The incoming forged XFH was not directly observable at the backend; only the HTTP result is asserted here. |
| M4 | **Partial pass** | `kill -9` of tether PID 63597 led launchd to restart it as PID 64744 (`runs` 1 → 2); the port remained listening, and second binds to `127.0.0.1`, `0.0.0.0`, and dual-stack `[::]` failed errno 48. After restart, direct request without the secret returned empty `404`. The published secret changed; old secret returned empty `404` both directly and through Serve, while new Serve GET returned `200`. `launchctl bootout` removed the listener but retained the Serve entry; through Serve then returned `502` (0 bytes). `tailscale serve --https=443 off` removed the entry, then the next bootstrap published again. The Login Items stop path was not attempted. |
| M5 | **Partial** | While tether was running, the standalone app was quit via AppleScript. Before quit, `readlink /Library/Tailscale/ipnport` was `55844`; during quit the symlink was absent and hostname curl failed DNS resolution (`curl: (6) Could not resolve host`). Relaunch with `open -a /Applications/Tailscale.app` initially had no `ipnport` and Self was offline; after waiting, Tailscale status reported `BackendState: Running`, `Self.Online: true`, and a Serve GET returned `200` (195 bytes). `ipnport` was still absent after relaunch; one `sameuserproof-*` file existed after relaunch. Did not establish a changed port or a waiting browser tab's reconnection; the observed request did reconnect after the app came back online. No bugreport was run. |
| M6 | **Not run (phone-only)** | iPhone app/Safari enrolment, 10-minute WebSocket, and phone revocation require Jimmy's iPhone. Mac curl cannot substitute. |
| M7 | **Pass** | Two tether starts published different secrets. After restart, old secret returned empty `404` directly and through Serve; new Serve route returned `200`. |
| M8 | **Not run (prerequisite absent)** | Only the Standalone app was present in `/Applications`; no App Store Tailscale app to exercise. |

## Reproduced discrepancy

M3's `curl -H 'X-Forwarded-Host: evil.example' https://jimmys-macbook-air.tail852a76.ts.net/auth/info` returned `HTTP 200`, whereas M3 specifies `403` for a forged forwarded host. Reproduction is on the live Standalone 1.104.2 Serve path; Host forgery and direct missing/doubled XFH checks did return the expected `403`. Whether Serve overwrote or otherwise normalized the inbound XFH is not established by this probe.

## Cleanup and remaining state

- Ran `launchctl bootout gui/501/com.jimmyyao.tether`, then `tailscale serve --https=443 off`; the ending `tailscale serve status --json` was empty and byte-identical to the starting capture.
- Removed the plist and the config file created for this run. Confirmed the LaunchAgent is absent and port 7851 has no listener.
- Stopped only `tmux -L tether-gate`; its socket reported `no server running`. The default tmux server was untouched.
- Removed private raw Serve/status captures under `/tmp`. `~/.cargo/bin/tether` remains installed as requested; `~/Library/Logs/tether.log` remains, and the current published path secret was checked absent from it. The Tailscale app was relaunched and its status returned online. An existing CoreSimulator `tether.app` process was not touched.

## For Jimmy

Still needs physical/interactive completion for M0 (logout/login, Login Items toggle, screen-lock, TCC/proof-file and reboot-temp checks, plus occupied-port setup), M4 Login Items stop, M5 port-change/waiting-tab check, and M6 iPhone app/Safari/WebSocket/revocation. M1 refusal/CAS/preservation variants were intentionally omitted to avoid manually changing Serve config.

## Lead's reading (2026-10-24)

- **M3:** the 200 for a forged `X-Forwarded-Host` through Serve is correct. Serve sets the header to the real Host with `Header.Set` (`ipn/ipnlocal/serve.go:1089` at v1.104.2), so the forged value never reaches tether. auth.md's M3 row now says so. M3 passes for what can run from the Mac.
- **M2:** the WebSocket `403` comes from the device check refusing an unenrolled caller, which is correct. A `101` needs an enrolled device, which M6 covers.
