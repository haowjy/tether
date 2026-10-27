# Where tether can be probed, and what each place can't show

tether's claims need the real system: real tmux, a real tailnet, a real iPhone
(root `AGENTS.md`, "Probe the real thing"). Each machine an agent can reach answers
only some of those questions. Pick the place by the question, and say in the report
which place a result came from.

| Place | Answers | Cannot answer |
| --- | --- | --- |
| Jimmy's Mac (the primary checkout) | builds, preflight, real-tmux tests on 3.4 and the newer Homebrew tmux, web e2e against a real daemon, iOS builds and Simulator screenshots; a Mac host behind real Tailscale: the Mac gates M0–M8 in `docs/design/auth.md` and S9 and S13 in `docs/design/setup.md` | the Linux deployment (Serve to a Unix socket, the systemd service); software-keyboard and touch behavior |
| Docker Linux container on the Mac | Linux builds and tests, the systemd user unit, cgroup limits, Linux memory and CPU numbers, setup's refusals on hosts without systemd or on old Tailscale (S11) | tailnet behavior; Pop!_OS's own systemd and cgroup setup |
| The Linux dev box (`pop-os`) | the Linux deployment: `tailscale serve` to `serve.sock`, LocalAPI whois, the auth gates G1–G12 and the setup gates S1–S8 and S12 | — (agents on the Mac can't reach it over SSH yet, because the Mac hasn't accepted its host key, so the Linux gates wait for Jimmy or a session on the box) |
| Jimmy's iPhone | the device checklist in `docs/design/ios-shell.md`: keyboard, focus, geometry, selection, latency, Face ID | — (Jimmy runs it; agents can't drive the device) |

## tmux: probe on a private server, never Jimmy's

A tether format or command can crash the tmux server, which ends every session on
it. tmux 3.4 crashed expanding the window subscription's `L:` client loop, through
`#{client_name}` on a client that had connected but not yet identified itself
([research](../../docs/design/research/tmux-subscription-format-crash.md)); the crash
was reproduced on an isolated server. Pausing a pane with `'%P:off'` crashes 3.2a–3.6b
when output is queued (`docs/design/daemon-core.md` §3.3). On 3.4 and 3.7b, a
`select-window` that changes a session's current window followed by `kill-session` on
that session, in one command list (commands joined by ` ; ` on one line, as tether's
command groups are), kills the whole server whenever any control client
is attached, even one on another session; tmux 3.8 has the fix (`daemon-core.md`,
risk 4). So:

- Probe and test only on a private `tmux -L <name>` server, and kill it afterwards.
- Never put a command that changes a session's current window in the same tmux command
  list as one that destroys that session. Separate commands survived every trial,
  which is not proof they are safe.
- Leave the installed tmux binaries alone. Which tmux the dev box runs day to day is
  Jimmy's call ([issue #2](https://github.com/haowjy/tether/issues/2)).
- 3.4 is the oldest supported tmux, and newer releases fixed crashes it still has. A
  change to anything tether sends to tmux runs the real-tmux suite on 3.4 and on the
  newer tmux the host runs, before landing (`TETHER_TMUX_TESTS=1 TETHER_TMUX=<tmux
  binary> cargo test --test tmux_real`; `src/tmux/AGENTS.md`); a pass on a newer tmux
  proves nothing about 3.4.
- On the Mac, set a short `TMPDIR` for spawns and probes; the lead uses
  `/tmp/tether-meridian-501`. The default macOS `TMPDIR` is long enough to push the
  Unix socket paths tmux and tether create past the 104-byte limit. The private
  tmux builds live under that directory (`tmux/<version>/bin/tmux`).

## Probing Tailscale on the Mac touches Jimmy's real tailnet

The Mac hosts tether through its LaunchAgent and the standalone Tailscale app
(`docs/running.md`, "Host on a Mac"), so a Mac probe writes the Serve config of
Jimmy's own node and can enrol devices on his tailnet. So:

- Before you start, save `tailscale serve status --json` and its hash, whether
  `~/Library/LaunchAgents/com.jimmyyao.tether.plist` exists, `launchctl print
  gui/$UID/com.jimmyyao.tether`, and the device rows in
  `~/.local/state/tether/auth.toml`. Afterwards run `tether teardown`, and check that
  the Serve config hashes the same as before and the other three match.
- Never enable Funnel, and leave other Serve entries alone.
- Don't run `tailscale bugreport`. It uploads a report to Tailscale each time it runs,
  and the app's log upload can't be turned off (`docs/design/decisions.md`, "Tailscale's
  log upload stays on for a Mac host").
- Redact enrolment codes and path secrets (the random prefix in the Mac's Serve target
  that guards its loopback port) from evidence.

What runs on the Mac proves nothing about the Linux path, and the reverse holds too:
the two hosts publish different targets through different services.

## Docker: cheap on the build, heavy on the host

The Mac is Jimmy's working machine, and a container build saturates it: one probe
container reached 271% CPU compiling Rust, building tmux and installing web
dependencies. Jimmy noticed: "container cpu usage is through the roof... on docker".
Prefer native runs; use Docker only for Linux-only questions, and then:

- Cap the container (`docker run --cpus 1`, or `docker update --cpus 1` on a running
  one).
- Build from a clean `git archive HEAD` export and run `pnpm --dir web install
  --frozen-lockfile` inside the container, on Node 22 or newer. A `node_modules`
  copied from the Mac lacks the Linux native bindings the web build needs, and Node 18
  lacks APIs it uses.
- Debian 12's systemd 252 ignores the unit's progressive restart backoff
  (`docs/running.md`); a passing container run is not a Pop!_OS result.

On the Mac itself, run test suites one after another and Playwright with
`--workers=2`.

## The iOS Simulator can't test input

From an agent shell the Simulator shows no software keyboard, `simctl` can't tap or
type, and `open -a Simulator` finds no app. `xcrun simctl io booted screenshot`
works. A throwaway XCTest UI-test target can drive taps and typed text, which reach
tmux, but still never raises the software keyboard. So a Simulator run verifies boot,
the bridge, networking and layout at rest; keyboard, focus, geometry and rotation wait
for the device checklist. `ios/AGENTS.md` has the build rules.

## Commits: coder spawns commit, and the hook checks only the tip

In the single-checkout build (root `AGENTS.md`, "How work lands"), parallel lanes
share one working tree and the lead commits each change by pathspec after review. The
`coder` and `frontend-coder` agent profiles (`.mars/agents/`) tell the agent to
commit, and the agent follows the profile over a brief that says "don't commit". Check `git log` after every coder
lane and fold or amend any commit it made before preflighting.

The pre-push hook preflights only the pushed tip, so a commit in the middle of the
range can fail while the tip passes. Folding review fixes in with `git rebase
--autosquash` has left an intermediate commit failing clippy under a tip that passed.
After any history rewrite, run `scripts/preflight.sh full` on a `git archive` export of
every commit in the range before pushing.

### tmux pre-3.7 control-client handshake hazard

A separate ordinary-use attach/detach race crashed tmux 3.4 during browser integration
verification. Notifications can reach a control client before `control_state` exists;
early client exit also crashes. Upstream e5a2a25f / 31c93c48 fix these in 3.7. The
raw-tmux probe reproduced the exact crash stack on 3.4, not on 3.7b. This does not
clear 3.7b of the distinct select-and-destroy crash above. Issue #2 tracks the combined
baseline/backport decision; no installed binary changes or daily-use sign-off without
Jimmy. See `docs/design/daemon-core.md` §9 and work evidence
`session-follow-tmux-attach-crash.md`.
