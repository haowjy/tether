# iPhone steps — tether Serve probe (p125)

**Current readiness blocker:** Mac Serve status is configured, but Chrome gets HTTP 502; direct daemon requests get `503 identity_unavailable` because the Mac app exposes no LocalAPI socket at `/var/run/tailscale/tailscaled.sock` or `/var/run/tailscaled.socket`. Do not treat a failed enrollment as a phone failure. Jimmy can try after that blocker is resolved; keep Tailscale connected and Serve/daemon running during the check.

URL: <https://jimmys-macbook-air.tail852a76.ts.net/>

1. On the Mac, generate a fresh one-time code immediately before testing (expires in 10 minutes). This prints it only in the local terminal; don't paste it into a URL or save it in screenshots/logs:
   ```sh
   BASE=/tmp/tether-meridian-501/serve-probe
   TMPDIR="$BASE/runtime" XDG_CONFIG_HOME="$BASE/config" XDG_STATE_HOME="$BASE/state" HOME="$BASE/home" \
     "$BASE/target/release/tether" --config "$BASE/config.toml" enroll
   ```
2. On iPhone, confirm Tailscale is connected. For G5, leave iCloud Private Relay enabled if available, open Safari, and visit the URL above. Expected: tether shell/enrollment screen (not a 502). If the page loads, note whether it shows a terminal shell; a screenshot is useful evidence. The phone node is `iphone181` (`100.124.108.79`).
3. Enter the fresh code in the enrollment screen and submit. Expected: enrollment succeeds and the terminal/session picker appears. Do not share the code. If denied, note the exact on-screen message and recover by generating a new code (step 1); do not repeatedly reuse an expired code.
4. Open the isolated `one` tmux session, type a short harmless command such as `printf 'iphone181\n'`, and press Return. Expected: the command appears and completes in the terminal.
5. In Safari's Share menu choose **Add to Home Screen** (and **Open as Web App** if offered). Launch the new icon once with Tailscale on; expected: tether opens standalone and can reconnect to the same terminal.
6. Cold-launch/offline part of G10: force-quit the PWA, turn Tailscale off, and launch the icon again. Expected: cached shell opens and clearly shows disconnected/offline; no pretend-live terminal and no queued command sent later. Re-enable Tailscale and check it reconnects with a fresh snapshot before input is enabled.
7. Background/foreground part of G10: with Tailscale on and terminal open, switch away for ~30 seconds, then return. Expected: a fresh connection/snapshot and usable input rather than a stuck connecting socket or stale terminal. Record if the OS instead evicted/reloaded it.

## Stop/reset after Jimmy finishes

This is this probe's daemon PID (do not use broad `pkill tether`): `86849`.

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve reset
kill -TERM 86849
/opt/homebrew/bin/tmux -L serveprobe-p125 kill-server
```

The Tailscale Serve config currently has only this tailnet-only HTTPS handler; Funnel remains off. The dedicated tmux server is named `serveprobe-p125` and is separate from the default server.
