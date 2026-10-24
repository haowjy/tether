# Where tether can be probed, and what each place can't show

tether's claims need the real system: real tmux, a real tailnet, a real iPhone
(root `AGENTS.md`, "Probe the real thing"). Each machine an agent can reach answers
only some of those questions. Pick the place by the question, and say in the report
which place a result came from.

| Place | Answers | Cannot answer |
| --- | --- | --- |
| Jimmy's Mac (the primary checkout) | builds, preflight, real-tmux tests on 3.4, 3.7b and Homebrew 3.8, web e2e against a real daemon, iOS builds and Simulator screenshots | anything that needs Tailscale identity; software-keyboard and touch behavior |
| Docker Linux container on the Mac | Linux builds and tests, the systemd user unit, cgroup limits, Linux memory and CPU numbers | tailnet behavior; Pop!_OS's own systemd and cgroup setup |
| The Linux dev box (`pop-os`) | the deployment: `tailscale serve`, LocalAPI whois, the auth probe gates G1–G12 in `docs/design/auth.md` | — |
| Jimmy's iPhone | the device checklist in `docs/design/ios-shell.md`: keyboard, focus, geometry, selection, latency, Face ID | — (Jimmy runs it; agents can't drive the device) |

## tmux: probe on a private server, never Jimmy's

A tether format or command can crash the tmux server, which ends every session on
it. tmux 3.4 crashed expanding the window subscription's `L:` client loop, through
`#{client_name}` on a client that had connected but not yet identified itself
([research](../../docs/design/research/tmux-subscription-format-crash.md)); the crash
was reproduced on an isolated server. Pausing a pane with `'%P:off'` crashes 3.2a–3.6b
when output is queued (`docs/design/daemon-core.md` §3.3). So:

- Probe and test only on a private `tmux -L <name>` server, and kill it afterwards.
- 3.4 is the oldest supported tmux, and newer releases fixed crashes it still has. A
  change to anything tether sends to tmux runs the real-tmux suite on both 3.4 and
  3.7b before landing (`TETHER_TMUX_TESTS=1 TETHER_TMUX=<tmux binary> cargo test --test
  tmux_real`; `src/tmux/AGENTS.md`); a pass on a newer tmux proves nothing about 3.4.
- On the Mac, set a short `TMPDIR` for spawns and probes; the lead uses
  `/tmp/tether-meridian-501`. The default macOS `TMPDIR` is long enough to push the
  Unix socket paths tmux and tether create past the 104-byte limit. The private
  tmux 3.4 and 3.7b builds live under that directory (`tmux/<version>/bin/tmux`).

## The Mac can't run the daemon behind Tailscale

The macOS Tailscale apps expose no LocalAPI socket, so a daemon on the Mac answers
`503 identity_unavailable` and Serve returns 502. `docs/running.md` states this as
"`tether serve` runs on Linux only for now". Auth and Serve gates need the dev box.
Use the Mac's `tailscale serve` only for tailnet-only checks, never Funnel, and reset
it afterwards.

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

## Coder spawns commit unless the lead stops them

In the single-checkout build (root `AGENTS.md`, "How work lands"), parallel lanes
share one working tree and the lead commits each change by pathspec after review. The
`coder` and `frontend-coder` agent profiles (`.mars/agents/`) tell the agent to
commit, and the agent follows the profile over a brief that says "don't commit". Check `git log` after every coder
lane and fold or amend any commit it made before preflighting.
