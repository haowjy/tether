# Probe: tether behind Tailscale Serve on this Mac (deployment gates, Mac-side)

Jimmy approved using THIS Mac's `tailscale serve` for the deployment probes (tailnet only, never Funnel; `tailscale serve reset` when done). Run the gates in `docs/design/auth.md` §Probe gates and `docs/design/client/browser-setup.md` §Acceptance checks that can run from this Mac, and prepare the iPhone steps that need Jimmy.

Setup facts: Tailscale app is installed (`tailscale` CLI is `/Applications/Tailscale.app/Contents/MacOS/Tailscale`); this Mac is `jimmys-macbook-air` (100.69.69.122); Jimmy's iPhone `iphone181` (100.124.108.79) is online on the tailnet; pop-os (Linux dev box) is on the tailnet but not reachable by ssh from here yet. No serve config exists now.

## Build from the pushed code, not the working tree
Two lanes are editing the checkout. Export `git archive 96216b1` to `/tmp/tether-meridian-501/serve-probe/src`, build release there (`cargo build --release`, `pnpm --dir web install && pnpm --dir web build` as the release build expects), and run that binary with its own config/runtime dirs under `/tmp/tether-meridian-501/serve-probe/`. tmux: an isolated server only (`-L serveprobe` or the config option the daemon uses for its tmux socket; find it), never the default server, using `/tmp/tether-meridian-501/tmux/3.4/bin/tmux` or system 3.8.

## Do
1. Publish the daemon's `serve.sock` via `tailscale serve --https=443 unix:<path>` (G1's macOS equivalent). If the macOS Tailscale app can't serve a Unix socket (sandboxed GUI build), record the exact error, and find the closest faithful setup (e.g. the daemon's documented TCP alternative if one exists — do NOT weaken the daemon's admission checks to make it work). Funnel stays off; verify with `tailscale funnel status`.
2. From this Mac via its tailnet name: G2 headers on GET/POST/WebSocket upgrade, forged identity headers refused; G3 whois fields for self (is self admitted or refused per the node rules? report which and whether that matches auth.md); G4 whois latency (smaller run is fine: 200 calls + 20 concurrent); G7 canonical-origin vs `tailscale serve status`; G8 raw .svg/.html sandboxing and raw .js refused as script/SW; G11 partial (stop LocalAPI is likely not possible on macOS — say so).
3. Desktop browsers here (Chrome via agent-browser/Playwright, Safari if drivable): cold shell load, enrolment flow, WebSocket session against the isolated tmux, the 3-WebSocket cap's over-cap message.
4. Write `$MERIDIAN_ACTIVE_WORK_DIR/serve-iphone-steps.md`: the short steps Jimmy runs on his iPhone over the tailnet (open URL in Safari, enrol, use terminal, Add to Home Screen, cold launch the PWA, offline launch after first use with Tailscale off, background/foreground) with what to look for, covering G5 and G10 phone parts. Keep the Serve config and daemon RUNNING at the end so Jimmy can do these steps; report the URL and how to stop/reset.
5. Linux-only gates (G1 sudo/EACCES/other Unix user, systemd, CPU/memory caps) are out of scope here; list them.

## Constraints
Edit no repo files. Record evidence excerpts (not raw dumps) in `$MERIDIAN_ACTIVE_WORK_DIR/evidence/serve-mac/` and a summary in `$MERIDIAN_ACTIVE_WORK_DIR/serve-mac-probe.md` (gate → pass/fail/blocked, evidence). Name what you create with your spawn id. Spawn env: `TMPDIR=/tmp/tether-meridian-501`.
