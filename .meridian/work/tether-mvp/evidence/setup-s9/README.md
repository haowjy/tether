# Setup gates S9 and S13 — Mac probe

Run: 2026-10-25 (local), `jimmys-macbook-air`, Tailscale Standalone 1.104.2. Built/installed with `cargo install --path . --locked`. No source files changed. Path secrets and enrolment codes were redacted; raw captures were kept only temporarily under `/tmp` and are removed after cleanup.

## Before-state

- `tailscale serve status --json`: `{}` (exit 0; SHA-256 `ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356`).
- `~/Library/LaunchAgents/com.jimmyyao.tether.plist`: absent.
- `launchctl print gui/501/com.jimmyyao.tether`: exit 113, “Could not find service”.
- `~/.config/tether/config.toml`: absent.
- `~/.local/state/tether/auth.toml`: only top-level `pending` table; no enrolled-device records. State directory also had `host_id` and an empty `lock` file. Pending values were not recorded (they are sensitive and setup replaces the pending enrolment code).
- Existing checkout was already dirty before probing; left those existing changes untouched.

## Results

| Check | Result | Runtime evidence |
|---|---|---|
| S13 plain `tether setup` | **Pass** | `tether: On a Mac, phones reach tether only through its LaunchAgent, which holds its port; run tether setup --background.` Exit 1. Serve remained `{}`, plist absent, `launchctl print` remained 113. |
| Fresh `tether setup --background` | **Pass** | Exit 0; `Running: launchctl bootstrap gui/501/...`; reported LaunchAgent running and “Installed com.jimmyyao.tether.plist”; published the tailnet link and printed an enrolment code (both redacted). `launchctl print` showed `state = running`, `runs = 1`, PID 79066, and program `/Users/jimmyyao/.cargo/bin/tether`. Plist hash `771926d1…d91ff`; `plutil -lint` → `OK`. Serve had Web entry `jimmys-macbook-air.tail852a76.ts.net:443`, `/` handler, proxy to tether's loopback port 7851, and `TCP 443 HTTPS`. |
| Curl the fresh link from this Mac | **Pass** | `curl`: HTTP 200, 920 bytes; response began `<!doctype html>`. This was the enrolment page, not a 502. |
| Rerun / restart / secret rotation / new-process verification | **Pass** | Exit 0; output included `Running: launchctl kickstart -k gui/501/com.jimmyyao.tether` and `Nothing else to change.` PID changed 79066 → 79204 and `local.sock` inode changed 114009583 → 114009691. The Serve proxy target changed (secret not recorded); verified setup completed against the new socket/process. |
| Busy port 7851, job not loaded | **Pass** | After teardown, a Python listener bound `127.0.0.1:7851`; setup exited 1 with `Another process holds 127.0.0.1:7851 ... Stop it, or install by hand with another port`. Plist remained absent; `launchctl print` 113; Serve `{}`. |
| PATH containing `&` | **Pass** | Fresh setup with PATH prefix `/tmp/tether-s9&path` exited 0 and installed/bootstrapped. `plutil -lint` on installed plist → `OK`; plist PATH contained the literal ampersand correctly in XML text. |
| Teardown and idempotent second teardown | **Pass** | First teardown exited 0 and reported `Removed tether's Serve handler.` and `Removed com.jimmyyao.tether.plist.` Second exited 0: `Nothing to remove.` |
| Booted-out job with plist still present | **Pass** | `launchctl bootout` exit 0; subsequent `launchctl print` 113 while plist remained. Setup exited 0 and ran `launchctl bootstrap`; final job state `running`, `runs = 1`. |

## Skipped / hand checks for Jimmy

- Background Items Added notification; Login Items toggling (including disabled-service setup/teardown variants); second macOS account; SSH session without a screen login; quitting Tailscale; phone enrolment/reconnect. Tailscale was not quit or reconfigured, and no other Serve entries were intentionally touched. No `tailscale bugreport` was run.
- Also not exercised: manual install on a different port, teardown with Tailscale unavailable, or induced LocalAPI publication error.

## Restore

Final `tailscale serve status --json` was byte-identical to the saved baseline `{}` (same SHA-256); only tether's temporary Serve handler/HTTPS entry was removed. Plist absent; `launchctl print` exit 113 as before; config absent; no enrolled-device records existed before or after. Only the state directory's preexisting pending enrolment value was replaced by setup's normal code issuance; teardown intentionally retains the state directory. The original pending value was not captured, so it could not be reinstated exactly. Tether's newly issued pending code expired after its 10-minute lifetime; final inspection confirmed it was expired, with zero enrolled-device records. No phone enrolled it. The temporary plist backup made by setup during the PATH-change rerun was removed.
