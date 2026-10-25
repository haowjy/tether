# Files runtime probe (p260)

## Result

Completed the real Files workflow against the built `target/debug/tether` daemon, Vite front proxy, and private tmux 3.7b stack. No product files changed; the disposable runner was removed. This closes the specifically unverified Files-root gate listed in `.meridian/work/tether-mvp/evidence/session-follow-regression/REPORT.md`; other gates in that report were not attempted.

## Setup and actions

- Started `startStack({ tmux: "3.7b", name: "p260-files", memoryMiB: 72 })` with `TETHER_E2E_PORT=5461 TMPDIR=/tmp/p-files`. Browser: private Playwright Chromium context, 1280×900; no default tmux/server or OS clipboard. The stack supplied the real daemon + Vite proxy + private tmux server.
- Created two text files under a private scratch directory inside the stack HOME, and added that directory through authenticated `POST /fs/roots/add` from the browser. Exact response: `200 {"home":"/private/tmp/p-files/e2e-5461/p260-files/home","roots":[{"path":"/private/tmp/p-files/e2e-5461/p260-files/home/p260-root","canonical":"/private/tmp/p-files/e2e-5461/p260-files/home/p260-root","ok":true}],"uploadsDir":{"path":"~/tether-uploads","canonical":null,"ok":false}}`.
- In Files, opened the scratch root → `branch` → `deep`; edited the path and used Cancel (restored `~/p260-root/branch/deep`); entered partial `~/p260-root/br`, saw completion `branch`, pressed Enter (Go opened it), then browser Back returned to `deep`.
- Opened `quoted path.txt` and used Insert path. Files navigated to Terminal; captured tmux window 0 contained exactly the shell-quoted absolute path at the prompt, with no Enter. The second pane remained blank.
- For the delayed-window check, paused the probe daemon with SIGSTOP at the websocket receive boundary, clicked Insert for `race path.txt`, waited 150 ms so the browser could enqueue the frame, selected tmux window 2 while the daemon was paused, then resumed it. Window 0 received the quoted path; window 2 remained blank; current tmux window was 2. Thus the delayed insert stayed with the originally captured pane rather than following the changed current window.

## Observations and evidence

- FS root-add and root reads succeeded (200). All directory listings completed; no 4xx/5xx responses observed. Raw preview fetches returned 206 Partial Content (range responses), not errors. The path containing a space was previewed and inserted with shell quoting.
- Probe command wall time was approximately 5 seconds for the full workflow on this host (one cold stack run; not a performance comparison).
- Screenshots, visually inspected: [`terminal before`](session-follow-files-final-01-terminal.png), [`real root in Files`](session-follow-files-final-02-root.png), [`deep folder`](session-follow-files-final-03-browse.png), [`normal insertion in tmux`](session-follow-files-final-04-insert.png), [`delayed insertion after window switch`](session-follow-files-final-05-race.png).
- Provenance/gaps: this uses the documented real-daemon E2E stack, whose front proxy stands in for Tailscale Serve and `/auth/info`; it is not a physical iPhone, native WebView, or tailnet deployment check. No setup/runtime blocker reproduced.

## Cleanup

Closed the private browser context, stopped the stack (daemon, Vite/front proxy and private tmux server), removed its `/tmp/p-files` scratch data and the disposable TypeScript runner. No process from this probe remains. An unrelated stack was already running and left untouched: PID 86609 (`/tmp/tether-e2e/e2e-5452/gesture-chromium-3.7b`, daemon) and PID 86614 (its Vite server); it was not started or used by this probe. Only this report and the five cited screenshots remain as this probe's evidence.
