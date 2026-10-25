# Mac front M0–M8 probe evidence

Run date: 2026-10-24 (local Mac). Host: `jimmys-macbook-air.tail852a76.ts.net`; Tailscale Standalone 1.104.2. Commands used the app CLI at `/Applications/Tailscale.app/Contents/MacOS/Tailscale` because `tailscale` was not installed on PATH.

## Baseline and setup

- `tailscale serve status --json` before changes: exit 0, `{}` (no existing Serve config). Captured privately at `/tmp/tether-mac-gates-start-serve.json` for restoration; removed at cleanup.
- `tailscale status --json` identifies this Mac as online, node ID `nMM5jYAKHC11CNTRL`, DNS `jimmys-macbook-air.tail852a76.ts.net.`
- Existing `~/.config/tether/config.toml` and `~/Library/LaunchAgents/com.jimmyyao.tether.plist`: absent; no pre-existing config or plist to back up.
- tmux version: 3.8. `tmux -L tether-gate display-message ...` failed with `No such file or directory`; no operation was issued against the default tmux server.
- `cargo install --path .`: completed; installed `tether v0.0.1` to `~/.cargo/bin/tether`.

## Gate results

| Gate | Result | Runtime evidence / limit |
|---|---|---|
| M0 | **Fail (partial setup works)** | `launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.jimmyyao.tether.plist` succeeded without sudo; launchd job ran as Jimmy, bound `127.0.0.1:7851`, and tether logged the isolated `tmux` endpoint `Name("tether-gate")`. `ps eww` showed `HOME=/Users/jimmyyao`, launchd `TMPDIR=/var/folders/.../T/`, and the plist-provided `PATH`; `tmux -L tether-gate list-sessions` showed only the probe-created `gate-probe`. However, startup logged `WARN Serve publication failed; retrying tailnet identity is unavailable`; Serve remained empty, so the publication-dependent parts could not pass. Not attempted: pre-bound-port withdrawal, logout/login, Login Items toggle, lock-screen access, `/fs` TCC prompt/grant persistence, or reboot cleanup. See reproduced defect below. |
| M1 | **Fail** | No entry was published; starting `tailscale serve status --json` was `{}` and remained `{}`. Therefore no M1 Serve write, preservation/CAS, refusal variants, or old-name cleanup could be exercised. |
| M2 | **Not run (Serve path tests blocked)** | `curl -sS -D - http://127.0.0.1:7851/auth/info` returned `HTTP/1.1 404 Not Found`, `content-length: 0`; bare direct `GET /` also returned 404 after restart. `curl https://jimmys-macbook-air.tail852a76.ts.net/` failed with exit 7, “Couldn't connect to server” (Serve has no published handler). No path secret was available, so no secret variants or through-Serve methods were attempted. |
| M3 | **Not run** | Requires a valid published path secret and Serve request. No entry was published; did not try secret-bearing forged headers. |
| M4 | **Fail (socket behavior passed; Serve stop/rotation blocked)** | Before killing tether, second binds to `127.0.0.1:7851`, `0.0.0.0:7851`, and dual-stack `[::]:7851` each failed with macOS errno 48 `Address already in use`. `kill -9 52093` led launchd to restart tether as PID 52678 (`runs = 2`); listener remained on `127.0.0.1:7851`, and a subsequent direct request answered empty 404. Bootout/502, old-secret 404/new-secret rotation, and `tailscale serve --https=443 off` preservation checks were unavailable because there was no published entry. The required final bootout was performed during cleanup. |
| M5 | **Not run** | Did not quit or relaunch the live Tailscale app; this would interrupt this Mac's tailnet and the observed LocalAPI dependency. No `bugreport` was run. |
| M6 | **Not run (phone-only)** | iPhone app enrolment, Safari node enrolment, 10-minute WebSocket, and phone revocation require Jimmy's iPhone/Safari. Mac curl cannot substitute; the hostname was unreachable because Serve publication failed. |
| M7 | **Not run** | No published secret existed to compare across daemon starts. |
| M8 | **Not run (optional prerequisite absent)** | This is the Standalone app setup, not the App Store app. |

## Reproduced defect

On the configured Mac (Standalone Tailscale 1.104.2), `cargo install --path .`, installation of the provided LaunchAgent plist, and `launchctl bootstrap gui/$(id -u) ...` start tether successfully, but M0/M1 publication never completes. The log excerpt is:

```text
INFO listening on private fronts serve_front=127.0.0.1:7851 ... tmux=Endpoint { program: "tmux", socket: Name("tether-gate") }
WARN Serve publication failed; retrying tailnet identity is unavailable
```

The same authenticated LocalAPI `GET /localapi/v0/status?peers=false` (queried locally without recording credentials or response contents) returned a 200 JSON response. Its `Self` object had `ID`, `NodeID`, and `UserID` fields, but no `StableID`; the matching `User` entry reported the owner login. Tether's startup remained in `tailnet identity is unavailable` and did not publish. Tailscale's `serve status --json` was `{}`; a tailnet-client `curl` to the requested HTTPS hostname failed to connect (curl exit 7). This blocks the real Serve-dependent gates on this Mac. Basis: auth.md M0/M1 require successful publication on the standalone Mac; running.md supports Standalone Tailscale 1.104+.

## Cleanup / remaining state

- Booted out `com.jimmyyao.tether`; removed the plist and the config file created for this run. Restored/verified Serve against the captured starting state (empty `{}`); tether itself had not changed it.
- Stopped and removed only the probe's isolated `tmux -L tether-gate` server. The default tmux server was never listed, attached to, or touched.
- Removed the private starting Serve JSON capture. No path secret was written here or included in this report.
- `~/.cargo/bin/tether` remains installed as requested. `~/Library/Logs/tether.log` remains with the sanitized excerpts above; the LaunchAgent has no running listener. An unrelated existing `tether.app` CoreSimulator process (PID 22116) was observed and left untouched.

## Evidence commands (safe excerpts)

```text
/Applications/Tailscale.app/Contents/MacOS/Tailscale version
1.104.2

tailscale serve status --json  # via app CLI, pre-change
{}

launchctl print gui/501/com.jimmyyao.tether
state = running
runs = 1
pid = 52093

launchctl print gui/501/com.jimmyyao.tether  # after kill -9
state = running
runs = 2
pid = 52678

curl https://jimmys-macbook-air.tail852a76.ts.net/
curl: (7) Failed to connect to ... port 443 ... Couldn't connect to server
```

