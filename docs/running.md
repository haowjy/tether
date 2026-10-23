# Running tether

tether runs as you, on `127.0.0.1`, in a systemd user unit. `tailscale serve` publishes
it to your tailnet over HTTPS, and every request must carry your Tailscale login and an
enrolled device's token ([auth.md](design/auth.md)). It attaches to your tmux server
and never starts one, so start tmux the way you always do.

`tether serve` runs on Linux only for now. It reads your login and the serve config
from tailscaled's LocalAPI unix socket, which the macOS Tailscale apps (App Store and
standalone) don't have. The Mac is for recording tmux 3.7b fixtures and building the iOS
app, not for running the daemon.

## Install

```bash
cargo install --path .          # puts tether in ~/.cargo/bin
```

## Configure

Every key is optional; `~/.config/tether/config.toml` may not exist at all. Unknown keys
are ignored.

```toml
port = 7850              # tether listens on 127.0.0.1:7850
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
`TMUX_TMPDIR`. A systemd user unit doesn't see variables set in your shell's rc
files, so if you set `TMUX_TMPDIR` there, set `socket_path` here.

## Publish it on the tailnet

```bash
tailscale serve --bg --https=443 http://127.0.0.1:7850
```

Never use `tailscale funnel`. tether reads the serve config from tailscaled at startup
and refuses to run if Funnel exposes its port to the internet. At startup it also
reads your login from tailscaled and lets only that login through; `tether serve
--allow-login <login>` replaces that list.

## Run it under systemd

```bash
mkdir -p ~/.config/systemd/user
cp contrib/tether.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tether
loginctl enable-linger "$USER"  # start your user units at boot, without a login
journalctl --user -u tether -f
```

The unit carries the resource limits from [plan.md](design/plan.md#resource-budget),
`KillMode=mixed` so a stop reaches tether alone, and a restart backoff, since tailscaled
may not be up yet at boot. Logs go to the journal; `RUST_LOG=debug` (in the unit's `Environment=`) shows more.
They hold ids, lengths and logins, never terminal contents, tokens or codes.

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
   output in `[complete] path` in `config.toml`, and `systemctl --user restart tether`.
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

On Linux, the unit caps tether's memory at 72 MiB and CPU at half a core. If you
already installed an older unit, copy the current `contrib/tether.service` again so it
gets `MemoryMax=72M`, no `MemoryHigh`, `CPUQuota=50%`,
`CPUQuotaPeriodSec=10ms`, and `RestartPreventExitStatus=78`:

```bash
cp contrib/tether.service ~/.config/systemd/user/tether.service
systemctl --user daemon-reload
```

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

## Enrol the phone

```bash
tether enroll                   # prints a code like K7QM-3XRP and the host's URL
```

In the app, Add host takes the host's name and the code. The code works once, for 10
minutes (`--ttl` changes that), and 5 wrong tries delete it.

```bash
tether device list              # name, when, and who enrolled it
tether device add laptop        # a token for a desktop browser, printed once
tether device remove iphone     # its token stops working; its sockets close within 10 s
```

These commands only edit files under `~/.local/state/tether/`, so they work whether or
not the daemon runs. That directory also holds `host_id`, the host's identity in the
app: don't copy it to another machine.

## When something fails

| Symptom | Cause |
|---|---|
| tether exits at start, naming Funnel | Funnel exposes its port: `tailscale funnel reset`, then serve again |
| tether exits at start: "no logged-in user" | tailscaled isn't logged in; log in, or pass `--allow-login` |
| `403 forbidden` | the request didn't come through `tailscale serve`, or not from an allowed login |
| `401 auth_required`, or the socket closes with 4401 | the device was removed: enrol it again |
| `503 auth_unavailable`, or the socket closes with 4503 | `auth.toml` can't be read, usually a typo from a hand edit; the log names the line. Fix the file: the app keeps its token and retries, so nothing needs re-enrolling |
| the app shows no sessions | no tmux server on the configured socket |
| tether exits at start with status 78 | configuration is invalid or the effective budget is below 42 MiB; fix the journal's named cause, then start tether again |
| the journal says "no cgroup memory limit is in force" | the user manager lacks the memory controller or the host uses cgroup v1/hybrid; `MemoryMax` isn't enforced |
| the journal warns that `MemoryHigh` is below what tether holds at its caps | remove `MemoryHigh` from the unit and restart; don't set a soft limit below the unreclaimable ceiling |
| a tab says "Session limit" | the message names tmux session IDs holding the control-client slots; close tabs on those sessions, on any device, or raise the budget, then tap to retry |
| "Too many connections to <host>" | browser tabs and apps on this host fill its socket cap; retry is automatic and a stale connection clears within 25 s |
| no suggestion strip and startup says completion is off | the effective memory budget is below 53 MiB |
| an upload fails with `memory_backed` | the destination is on tmpfs or ramfs (often `/tmp`); choose a directory on disk |
