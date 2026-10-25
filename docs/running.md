# Running tether

tether runs on your dev box and shows your tmux sessions on your phone, over Tailscale.
On Linux, plain `tether setup` runs it in the terminal; Ctrl-C stops it. Use
`tether setup --background` to install a service that outlives the terminal. On a Mac,
use `--background`: plain setup refuses because phones reach the daemon through the
LaunchAgent's socket. Build it, run setup, scan the QR code it prints, and enter the
code. tether attaches to your tmux server and never starts one, so start tmux the way
you always do.

A Linux box is the usual host. A Mac can host tether too, under weaker local
guarantees, if your account is its only one ([Host on a Mac](#host-on-a-mac)).

## Install

From a clone of the repository (the web client is built into the binary, with pnpm):

```bash
pnpm --dir web install
cargo install --path .          # puts tether in ~/.cargo/bin
```

## Set it up

```bash
~/.cargo/bin/tether setup
```

Plain Linux `tether setup` runs tether in this terminal, publishes it on your tailnet,
and prints the link to open on your phone, a QR code of it, and an enrolment code. It
serves until Ctrl-C or SIGTERM; the Serve entry stays while tether is stopped, so the
phone sees 502 until you run it again. Daemon logs follow the report on stderr. Use
`tether setup --background` to install the systemd user service or Mac LaunchAgent
instead. Plain `tether setup` on a Mac refuses without changing anything and tells you
to use `--background`. To use Safari or the home-screen app, scan the QR code with the
iPhone camera or open the link, then enter the code. To use the iOS app, tap Add host
and enter the printed host name and the same code. A code works for one device; `tether
enroll` prints another ([Enrol more devices](#enrol-more-devices)). The design is
[setup.md](design/setup.md).

All supported setup paths check that you are not root. Linux paths also check that
Tailscale is reachable, logged in, recent enough (1.94 or later), and has MagicDNS and
HTTPS certificates on. Mac background setup checks the standalone app (1.104 or later),
MagicDNS and HTTPS certificates. Foreground setup also checks that the configured tmux
program is executable on setup's own `PATH` and that `config::runtime_dir()` is exactly
`/run/user/<uid>/tether` (so the Serve handler matches the path teardown recognizes). It
can use `--config`; `TMUX_TMPDIR` is inherited
by the daemon. It does not check the binary path, service environment, systemd, the
user manager, systemd version, or cgroup controllers. Background setup requires the
default config path, the installed `~/.cargo/bin/tether`, and tmux on the service's
`PATH`; it also checks service environment and Linux systemd requirements. Any failed
check stops setup before it changes anything.

On Linux, `tether setup --background` may make two one-time system changes; plain
`tether setup` may make only the operator grant. Setup prints each command and runs it,
so `sudo` or polkit may ask for your password:

- `loginctl enable-linger` (background only), so tether starts at boot and keeps
  running after you log out. If that fails, setup runs `sudo loginctl enable-linger $USER`.
- `sudo tailscale set --operator=$USER`, which lets your account change Tailscale's
  Serve config without `sudo`. From then on setup writes tether's Serve entry itself.
  On Tailscale 1.100 and later your account must also be allowed to run `sudo
  tailscale`: once Serve has a Unix target, tailscaled lets only root, or an operator
  who may run `sudo tailscale`, change Serve at all, for any app.

Each grant is skipped once it is in place. If a grant is still missing and stdin is not
a terminal, setup prints only the commands needed and asks you to rerun the same setup
command in a terminal or run those commands first. Keep `--background` when rerunning a
background setup. Foreground setup never enables linger.

Only `tether setup --background` installs `~/.config/systemd/user/tether.service` (Linux) or
`~/Library/LaunchAgents/com.jimmyyao.tether.plist` (Mac) from `contrib/`, restarts
tether, publishes it, and waits for the new daemon to report the published link
before it prints anything. If the installed file differs from this tether's, setup
replaces it and keeps the old copy under `~/.local/state/tether/setup-backup/`. Put
your own unit settings in a drop-in (`systemctl --user edit tether`), which setup
leaves alone. Foreground setup installs no service or unit and serves in the current
process. To let in a Tailscale login other than this machine's owner, for
example:

```ini
[Service]
ExecStart=
ExecStart=%h/.cargo/bin/tether serve --allow-login you@example.com
```

**Rerun setup after every upgrade.** For the background service, `cargo install`
doesn't restart tether; rerun `tether setup --background` to pick up the new binary,
shipped unit and any `config.toml` change. For a foreground run, stop the old process
with Ctrl-C and rerun `tether setup`. If the background service is active, plain setup
refuses because the runtime lock is held; `--background` restarts it and prints a new
code. If a terminal run holds the lock, background setup refuses before grants or
installation. Ctrl-C that run, then rerun `tether setup --background`. The phone
reconnects by itself.

If Serve already has something tether won't share, such as another app at `/` of the
MagicDNS name, Funnel, or a TCP forward on port 443, setup writes nothing to Serve and
prints the conflict and its fix. Background setup leaves the installed service running
but unpublished. Foreground setup exits before serving and leaves the terminal run
stopped. Rerun setup once the conflict is gone.

**To remove it,** run `tether teardown`. It stops tether if a service is installed,
removes its Serve handler and nothing else from Serve, and removes the unit or plist.
With no unit installed, teardown just withdraws the Serve entry. It keeps your enrolled
devices, `host_id`, `config.toml` and any drop-ins, so a later setup brings the phone's
host back as it was. It leaves the operator grant and prints how to undo it. It prints
the linger instruction only when `loginctl` reports `Linger=yes`. If a terminal run is
still active, teardown also says: "A tether still runs in a terminal; Ctrl-C it."

**Logs:** `journalctl --user -u tether -f` for the Linux service,
`~/Library/Logs/tether.log` for the Mac LaunchAgent. Foreground daemon logs follow the
setup report on stderr in the terminal. Logs hold ids, lengths and logins, never
terminal contents, tokens or codes; set `RUST_LOG=debug` before setup for more.

If background setup can't run on your machine (no systemd, a binary elsewhere, a port
other than 7851 on a Mac), follow [Manual setup](#manual-setup). Plain Linux setup does
not need systemd.

## Configure

Every key is optional; `~/.config/tether/config.toml` may not exist at all. Unknown keys
are ignored.

```toml
name = "devbox"          # the host's name in the app; default: the MagicDNS name
memory_budget_mib = 72   # default memory budget; minimum 42; sets the daemon's caps

[tmux]
program = "tmux"         # an absolute path if the unit's PATH doesn't find it
# socket_name = "work"   # tmux -L work
# socket_path = "/run/user/1000/tmux/default"   # tmux -S <path>; not both

[complete]               # the suggestion strip ([Set up completion](#set-up-completion))
# history = "/home/you/.zsh_history"   # default: the most recently changed of ~/.zsh_history, ~/.bash_history and fish's
# path = "/home/you/.local/bin:/usr/local/bin:/usr/bin"   # default: the daemon's own PATH; set it to your shell's
# carapace = "/home/you/.local/bin/carapace"   # default: carapace on that PATH
```

With neither socket key, tether uses tmux's default socket, which tmux finds through
`TMUX_TMPDIR`. A foreground run inherits it. A systemd user unit doesn't see variables
set in your shell's rc files, so if you set `TMUX_TMPDIR` there, set `socket_path` here.

## Host on a Mac

Host on a Mac only if your account is its only user account. tether isn't supported
on a Mac with other logins: its Mac defences assume there are none, and
`tether setup --background` refuses to install on one.

The Mac's boundary is weaker than Linux's. On Linux, Serve's target is a Unix socket
in a `0700` directory: the kernel keeps every other account out, and the target holds
no secret. The Tailscale app on a Mac can't reach a Unix socket, so tether listens on
a loopback TCP port that any local process can open, and is published at a random
path, the path secret, that changes at every start. Only root and you can read it on
the Mac, though the Tailscale app's logs carry it (below). The [threat model](design/auth.md#threat-model) lists what else a
Mac host trusts.

Requirements: the standalone Tailscale app (from tailscale.com, 1.104 or later; the
App Store app is untested), signed in, and your account an admin, which tether needs
to read Tailscale's LocalAPI token.

The Tailscale app uploads its logs to Tailscale, and those logs include tether's
path secret: the app logs each Serve target in full. The app has no way to turn
log upload off; Tailscale's opt-out works only with the command-line `tailscaled`
([Tailscale: logging](https://tailscale.com/docs/features/logging.md)). The copy
on Tailscale's servers is useless from outside your tailnet, and tether picks a new
secret at every start.

tether runs from a LaunchAgent, as you, with no sudo; `tether setup --background` installs it
with your `HOME` and your shell's `PATH`, which must find tmux. launchd binds
tether's port, `127.0.0.1:7851`, when you log in, starts tether, and keeps the port
across crashes, so Serve never points at a port someone else could take while you're
logged in. It stops at logout: **while you're logged out, the phone can't reach
tether on this Mac.** The first install shows macOS's "Background Items Added"
notification.

macOS may ask once whether tether can read `~/Documents`, `~/Desktop` or
`~/Downloads` when `/fs` first opens them. If you set `TMUX_TMPDIR` in your shell,
set `socket_path` in `config.toml`, as on Linux.

The agent runs `tether serve --publish`, which writes tether's own Serve entry, the
`/` handler of `https://<this Mac's MagicDNS name>`, at each start, without sudo.
Before writing, tether refuses if Funnel is enabled, TCP forwarding occupies port
443, or another handler shares the entry; the log, `tether setup --background` and `tether enroll`
name the actual cause and how to clear it. `--publish` works only with the port from
launchd; without `--publish`, a Mac daemon serves only `local.sock` and never touches
the Serve config, which is what the e2e stack and dev runs use. Don't run `tailscale
serve` for tether by hand. If you reset Serve while tether runs, tether stays
unpublished until it restarts; rerun `tether setup --background` to restart the agent.

**Stopping.** `tether teardown` stops tether and removes its Serve entry. If you turn
tether off under System Settings → Login Items instead, run `tether teardown` too:
until the entry is gone, Serve points at a free port that any process could take.
Apart from that, tether never removes its Serve entry: after a crash or a logout the
next start replaces it, and in between Serve answers `502`.

**When it won't start.** If something else holds the port when tether's agent loads,
tether withdraws its own entry and exits 78 saying so. launchd can't skip restarts
for configuration errors, so an exit 78 repeats every 10 s until you fix the logged
cause.

Renaming the Mac in Tailscale needs a restart: rerun `tether setup --background`. macOS has no
cgroup, so `memory_budget_mib` only sizes the counts.

## Set up completion

Nothing here is needed to run tether. Without the snippet the app guesses where the
prompt ends and takes the directory from tmux, which lags a `cd` by up to a second;
without carapace there are no flag chips. These three steps make the strip dependable.

1. **Source the shell snippet.** It marks the prompt and the command line so the app
   can read what you've typed, and reports the shell's directory. Add one line at the
   **end** of `~/.bashrc` (after anything that sets the prompt), or `~/.zshrc` with
   `tether.zsh`, then open a new shell:

   ```bash
   [ -r ~/gitrepos/tether/contrib/shell/tether.bash ] && . ~/gitrepos/tether/contrib/shell/tether.bash
   ```

   Adjust the path to your checkout, or copy the file if your dotfiles must not depend
   on it. The snippet also appends each command to your history file as it runs (bash
   `history -a`, zsh `INC_APPEND_HISTORY`); `TETHER_NO_HISTORY_APPEND=1` before the
   `source` line turns that off. zsh saves history only with `HISTFILE` and `SAVEHIST`
   set.
2. **Give tether your shell's `PATH`.** The systemd user manager's `PATH` lacks what
   your rc files add (nvm, bun, Go). In an interactive shell run `echo $PATH`, put the
   output in `[complete] path` in `config.toml`, and rerun `tether setup --background` (on Linux,
   `systemctl --user restart tether` also works). On a Mac the agent already has the
   `PATH` setup ran with.
   If your history isn't in the default place, set `[complete] history` too.
3. **Install carapace** for subcommand and flag chips, as yourself, not system-wide.
   tether is built against v1.8.0; check the download against the release's checksums:

   ```bash
   mkdir -p ~/.local/bin
   cd "$(mktemp -d)"
   base=https://github.com/carapace-sh/carapace-bin/releases/download/v1.8.0
   curl -fsSLO "$base/carapace-bin_1.8.0_linux_amd64.tar.gz"
   curl -fsSLO "$base/checksums.txt"
   sha256sum --check --ignore-missing checksums.txt   # must say: ...linux_amd64.tar.gz: OK
   tar -xzf carapace-bin_1.8.0_linux_amd64.tar.gz carapace
   install -m 755 carapace ~/.local/bin/carapace
   ```

   `~/.local/bin` must be on the `PATH` from step 2, or set `[complete] carapace` to
   the binary. Without carapace, the strip still offers history, commands and paths.
   Don't upgrade it casually: tether's parser is tested against 1.8.0's output
   ([complete.md](design/complete.md#carapace)).

Under systemd, each carapace run happens in its own transient scope with its own memory
limit, so it never counts against tether's. Idle completion state is freed after five
minutes ([complete.md](design/complete.md)). The unit sets
`GLIBC_TUNABLES=glibc.malloc.mmap_threshold=131072` so freed memory returns to the
kernel. That setting works only for the glibc binary that `cargo install` builds,
which the unit runs. The prebuilt Linux release binaries are static musl and ignore it,
so under the unit they may keep more memory after the five-minute drop; the effect is
unmeasured.

## Tune the resource limits

On Linux, the background unit caps tether's memory at 72 MiB and CPU at half a core
(`MemoryMax=72M`, no `MemoryHigh`, `CPUQuota=50%`, `CPUQuotaPeriodSec=10ms`).
`tether setup --background` installs the current unit; rerun it after an upgrade. A
foreground run has no unit CPU or memory cap. Change service limits with a drop-in,
as below, never in the unit file, which setup replaces.

The `memory_budget_mib` config value selects the counts at the next restart:

| Effective budget | tmux sessions at once | sockets | completion |
|---|---:|---:|---|
| 72 MiB and up (default) | 3 | 3 | on |
| 64–71 MiB | 2 | 3 | on |
| 58–63 MiB | 1 | 3 | on |
| 53–57 MiB | 1 | 2 | on |
| 42–52 MiB | 1 | 2 | off |

To set 48 MiB, keep the unit limit and config aligned:

```bash
systemctl --user edit tether
```

```ini
[Service]
MemoryMax=48M
```

Do not set `MemoryHigh`: below what tether holds at its caps it stalls allocations for
seconds. Then set `memory_budget_mib = 48` in `config.toml` and restart:

```bash
systemctl --user restart tether
journalctl --user -u tether -b | grep 'memory budget'
```

At startup tether uses the lower of the configured budget and its cgroup v2
`memory.max`. Lowering `MemoryMax` alone is safe after tether restarts; changing it with
`systemctl --user set-property` takes effect immediately but does not resize the caps,
so restart after it too. Raising the limit requires raising both values. Values above
72 keep the highest tier. Below 42 MiB, tether exits with status 78 instead of
restarting.

The CPU limit is `CPUQuota=50%`, half of one core, metered every 10 ms. A throttled
keystroke waits no more than one period. To give tether a quarter core, use an override:

```ini
[Service]
CPUQuota=25%
```

Check the unit and delegated controllers:

```bash
systemctl --user show tether -p MemoryMax -p MemoryHigh -p CPUQuotaPerSecUSec -p CPUQuotaPeriodUSec
cat /sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/cgroup.controllers
```

Do not set `MemoryHigh`; it should be `infinity` because the unit does not set it. The
second command must list `cpu` and `memory` for `CPUQuota` and `MemoryMax` to be
in-force. If they are absent, the user manager has not delegated those cgroup v2
controllers; on a cgroup v1 or hybrid host, the unit's hard caps are not enforced. On
macOS there is no cgroup or hard memory/CPU cap; if run there, `memory_budget_mib` only
sizes the counts.

## Enrol more devices

```bash
tether enroll                   # prints a code and the canonical browser URL when available
```

`tether setup` prints a code for your first device. For each later one, run `tether
enroll`. A code works once, for 10 minutes (`--ttl` changes that), and 5 wrong tries
delete it. The iOS app holds a device token from then on; a browser or home-screen app
is admitted as its machine's Tailscale node ([auth.md](design/auth.md)).

```bash
tether device list              # native devices and enrolled tailnet nodes
tether device add playwright    # a native token for local dev/Playwright, printed once
tether device remove laptop     # revokes its token or node; live sockets close within 10 s
```

These commands only edit files under `~/.local/state/tether/`, so they work whether or
not the daemon runs. That directory also holds `host_id`, the host's identity in the
app: don't copy it to another machine. Enrol a browser or home-screen app from that
device's browser, with the same kind of one-time code; it enrolls the device's
Tailscale node, not one browser profile, so removing the node revokes every browser on
that device. A Mac's browser works as a client too.

## Manual setup

For a supported automatic install, `tether setup --background` installs and runs the
service. Follow this section by hand when background setup can't run: a Linux without
systemd, a binary somewhere other than `~/.cargo/bin`, or
another port on a Mac. A later background setup refuses a Mac hand install on another
port; run `tether teardown` first if you switch.

### Linux: the systemd unit

```bash
mkdir -p ~/.config/systemd/user
cp contrib/tether.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tether
loginctl enable-linger "$USER"  # start your user units at boot, without a login
journalctl --user -u tether -f
```

For a binary elsewhere, keep the unit as shipped and point it at the binary with a
drop-in (`systemctl --user edit tether`):

```ini
[Service]
ExecStart=
ExecStart=/path/to/tether serve
```

The unit carries the resource limits from [plan.md](design/plan.md#resource-budget),
`KillMode=mixed` so a stop reaches tether alone, and a restart backoff, since tailscaled
may not be up yet at boot. The backoff (`RestartSteps`, `RestartMaxDelaySec`) needs
systemd 254 or later (`systemctl --version`); an older systemd logs "Unknown key" for
both and restarts every 2 s instead, which still works.

The daemon creates `$XDG_RUNTIME_DIR/tether/` with mode `0700`, requiring it to be a
real directory owned by the daemon user. It refuses a missing Linux `XDG_RUNTIME_DIR`,
a symlink, the wrong owner or any mode other than `0700` with exit 78. It holds an
exclusive lock before replacing stale `serve.sock`/`local.sock` sockets or cleaning
`paste/`, so a second daemon cannot damage the running one.

### Linux: publish it on the tailnet

tether listens only on private Unix sockets in `$XDG_RUNTIME_DIR/tether/`; Serve
publishes `serve.sock` to your tailnet over HTTPS. tether doesn't need tailscaled to
start: it starts first and reports identity-dependent requests unavailable until
Tailscale's LocalAPI answers.

```bash
sudo tailscale serve --bg --https=443 unix:/run/user/<uid>/tether/serve.sock
```

Use Tailscale 1.94 or later. Replace `<uid>` with `id -u`. The canonical browser origin
exists only while `serve.sock` is the sole root handler of one HTTPS Serve entry, with
Funnel off; another handler beside it, a second publication, or a TCP forward to the
socket refuses browser admission. The daemon does not require LocalAPI or Serve to be
available to start, and it does not make Funnel a startup gate: requests marked as
Funnel are refused, and the browser origin becomes unavailable until Serve is safe.
The default Tailscale owner login is allowed; `tether serve --allow-login <login>`
replaces that allowlist ([Set it up](#set-it-up) shows the drop-in).

**Upgrade from the loopback-TCP daemon:** this command, or `tether setup --background`, replaces
its `/` handler. Until then, the iOS app gets HTTP 502 because nothing is listening on
the old target, and tether logs, and `tether enroll` prints, that `tether setup --background`
replaces it. The old `port` key is ignored and can be deleted from `config.toml`.

On tailscaled 1.100 and later, once Serve has a Unix target, every later Serve change
needs root, or an operator who may run `sudo tailscale`: the CLI writes the whole
config, which contains the Unix target. Another Unix user who runs tether needs root to
publish their socket too. The Tailscale operator remains trusted and can replace the
publication; use `sudo tailscale set --operator=<user>` to choose who can change it.

To remove the publication by hand: `sudo tailscale serve --https=443 off`, which
removes the whole `443` entry, tether's alone.

### Mac: the LaunchAgent

The plist has two placeholders, your home directory and a `PATH` that finds tmux
(`/opt/homebrew/bin` for Homebrew's). To use a port other than 7851, change it in the
plist before installing:

```bash
sed -e "s|@HOME@|$HOME|g" -e "s|@PATH@|$PATH|g" contrib/com.jimmyyao.tether.plist \
  > ~/Library/LaunchAgents/com.jimmyyao.tether.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jimmyyao.tether.plist
```

To change the port later, stop tether first (below). To restart tether, `launchctl
kickstart -k gui/$(id -u)/com.jimmyyao.tether`. To stop it, unload it and remove the
entry, which is tether's alone; to stop it for good, also remove the plist, or launchd
loads it again at your next login. `tailscale serve` needs the app's command-line
tool, which the app's settings install:

```bash
launchctl bootout gui/$(id -u)/com.jimmyyao.tether
tailscale serve --https=443 off
rm ~/Library/LaunchAgents/com.jimmyyao.tether.plist    # for good
```

Run `tailscale serve --https=443 off` straight after the unload: until it runs, Serve
points at a free port that any process could take.

## When something fails

| Symptom | Cause |
|---|---|
| `GET /auth/info` has no `browserOrigin`, or browser says to publish tether | Serve is missing, has another handler/publication, or Funnel is on; fix what `browserRefused` names, leave Funnel off, and rerun setup (`--background` if using the service) |
| `tether setup` says Tailscale refused the write (`403`) | your account isn't Tailscale's operator; run `sudo tailscale set --operator=$USER` and rerun the same setup command (`--background` if using the service) |
| `tether setup` says your account may not run `sudo tailscale` (`401`) | on Tailscale 1.100+, an operator may change a Serve config that serves any Unix socket or path only if they may run `sudo tailscale`; allow this account to run `sudo tailscale`, then rerun setup in the same mode |
| Plain `tether setup` says tether is already running | another daemon holds the runtime lock; stop it first. If the active daemon is the service, use `tether setup --background` to restart it and print a new code |
| Plain `tether setup` on a Mac says to use `--background` | phones reach the Mac only through its LaunchAgent, which holds the front's port; run `tether setup --background` |
| `403 forbidden` | missing/invalid Tailscale login or Funnel marker; confirm the request goes through Serve and the login is allowed |
| `403 bad_origin` | browser Origin/forwarded host/fetch metadata did not match the canonical Serve origin, or a Serve handler was added beside tether |
| `403 node_refused` | the node is tagged, shared, a subnet router, the box itself, or has a login mismatch; use another node |
| `401 not_enrolled`, or a socket closes with 4401 | enroll this node from its browser/PWA using `tether enroll`, or remove-and-re-enroll it |
| `401 auth_required`, or the native socket closes with 4401 | token is missing or its device was removed; enrol the native app again |
| `503 identity_unavailable` | LocalAPI whois or tailnet state is unavailable; tether retries and never interprets a failed lookup as “not enrolled” |
| `503 auth_unavailable`, or the native socket closes with 4503 | `auth.toml` can't be read, usually a typo from a hand edit; the log names the line. Fix it: native keeps its token and retries |
| Mac: the log, `tether setup --background` or `tether enroll` names Funnel, a TCP forward on 443, or a handler path | tether wouldn't overwrite it; turn Funnel off, remove the named TCP forward or handler, then rerun `tether setup --background` to republish |
| Mac: `503 identity_unavailable` and the log says the daemon's user must be an admin | tether can't read `/Library/Tailscale/sameuserproof-*`; run it as an admin user |
| Mac: the browser or app gets 502 | tether isn't running: you're logged out, it was booted out, or it is restarting. Log in, or rerun `tether setup --background`; if you meant to stop it, run `tether teardown` |
| Mac: tether exits 78 saying launchd couldn't bind the front's port | another process holds `127.0.0.1:7851` (`lsof -nP -iTCP:7851`); stop it and rerun `tether setup --background`, or install by hand with another port ([Manual setup](#mac-the-launchagent)) |
| Mac: `tether serve --publish` exits 78 saying there is no launchd socket `Listener` | it was started by hand, or its plist lacks the `Sockets` entry `Listener`; run it from the installed plist |
| tether exits with “already running” | another daemon holds the runtime lock; do not delete its sockets or paste files |
| tether exits at start with status 78 naming a runtime directory variable | `XDG_RUNTIME_DIR` on Linux or `TMPDIR` on macOS is absent or unsafe; use the user's private runtime directory |
| the app shows no sessions | no tmux server on the configured socket |
| tether exits at start with status 78 | configuration is invalid or the effective budget is below 42 MiB; fix the journal's named cause, then start tether again |
| the journal says "no cgroup memory limit is in force" | the user manager lacks the memory controller or the host uses cgroup v1/hybrid; `MemoryMax` isn't enforced |
| the journal warns that `MemoryHigh` is below what tether holds at its caps | remove `MemoryHigh` from the unit and restart; don't set a soft limit below the unreclaimable ceiling |
| a tab says "Session limit" | the message names the host and tmux sessions holding the control-client slots; close tabs on those sessions, on any device, or raise the budget, then tap to retry |
| "Too many connections to <host>" | browser tabs and apps on this host fill its socket cap; retry is automatic and a stale connection clears within 25 s |
| no suggestion strip and startup says completion is off | the effective memory budget is below 53 MiB |
| an upload fails with `memory_backed` | the destination is on tmpfs or ramfs (often `/tmp`); choose a directory on disk |
