# Running tether

tether runs as you, in a systemd user unit. It listens only on private Unix sockets in
`$XDG_RUNTIME_DIR/tether/`; Tailscale Serve publishes `serve.sock` to your tailnet over
HTTPS. Native iOS requests use an enrolled device token, while browser/PWA requests
are admitted as an enrolled tailnet node ([auth.md](design/auth.md)). It attaches to
your tmux server and never starts one, so start tmux the way you always do.

`tether serve` runs on Linux only for now because it needs tailscaled's LocalAPI Unix
socket for login, whois, status and Serve config; the macOS Tailscale apps (App Store
and standalone) don't expose one. LocalAPI availability is not a startup gate: tether
starts before tailscaled and reports identity-dependent requests unavailable until
the API responds. A Mac is also a fine client: a browser there is identified by whois
on the server and needs no local Tailscale LocalAPI. The Mac remains useful for
recording tmux 3.7b fixtures and building the iOS app, but not for running the daemon.

## Install

```bash
cargo install --path .          # puts tether in ~/.cargo/bin
```

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
`TMUX_TMPDIR`. A systemd user unit doesn't see variables set in your shell's rc
files, so if you set `TMUX_TMPDIR` there, set `socket_path` here.

## Publish it on the tailnet

```bash
sudo tailscale serve --bg --https=443 unix:/run/user/<uid>/tether/serve.sock
```

**Upgrade from the loopback-TCP daemon:** run this command to replace its `/` handler.
Until then, the iOS app gets HTTP 502 because nothing is listening on the old target.
The old `port` key is ignored and can be deleted from `config.toml`.

Use Tailscale 1.94 or later. Replace `<uid>` with `id -u`. The canonical browser origin
exists only while `serve.sock` is the sole root handler of one HTTPS Serve entry, with
Funnel off; another handler beside it, a second publication, or a TCP forward to the
socket refuses browser admission. The daemon does not require LocalAPI or Serve to be
available to start, and it does not make Funnel a startup gate: requests marked as
Funnel are refused, and the browser origin becomes unavailable until Serve is safe.
The default Tailscale owner login is allowed; `tether serve --allow-login <login>`
replaces that allowlist.

On tailscaled 1.100 and later, every later `tailscale serve` change needs root because
the CLI updates the whole config containing the Unix target. Another Unix user who
runs tether needs root to publish their socket too. The Tailscale operator remains
trusted and can replace the publication; use `sudo tailscale set --operator=<user>`
to restrict who can change it.

The daemon creates `$XDG_RUNTIME_DIR/tether/` with mode `0700`, requiring it to be a
real directory owned by the daemon user. It refuses a missing Linux `XDG_RUNTIME_DIR`,
a symlink, the wrong owner or any mode other than `0700` with exit 78. It holds an
exclusive lock before replacing stale `serve.sock`/`local.sock` sockets or cleaning
`paste/`, so a second daemon cannot damage the running one. If the existing Serve config still targets
`http://127.0.0.1:7850`, tether logs the one publish command above and `tether enroll`
prints it as the browser refusal.

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
may not be up yet at boot. The backoff (`RestartSteps`, `RestartMaxDelaySec`) needs
systemd 254 or later (`systemctl --version`); an older systemd logs "Unknown key" for
both and restarts every 2 s instead, which still works. Logs go to the journal; `RUST_LOG=debug` (in the unit's `Environment=`) shows more.
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
tether enroll                   # prints a code and the canonical browser URL when available
```

In the app, Add host takes the host's name and the code. The code works once, for 10
minutes (`--ttl` changes that), and 5 wrong tries delete it.

```bash
tether device list              # native devices and enrolled tailnet nodes
tether device add playwright    # a native token for local dev/Playwright, printed once
tether device remove laptop     # revokes its token or node; live sockets close within 10 s
```

These commands only edit files under `~/.local/state/tether/`, so they work whether or
not the daemon runs. That directory also holds `host_id`, the host's identity in the
app: don't copy it to another machine. Enrol a browser/PWA from its shell using the
same one-time code; it enrolls the browser machine's Tailscale node, not an individual
browser profile. Removing the node revokes every browser on that machine.

## When something fails

| Symptom | Cause |
|---|---|
| `GET /auth/info` has no `browserOrigin`, or browser says to publish tether | Serve is missing, has another handler/publication, or Funnel is on; use the command in `browserRefused` and leave Funnel off |
| `403 forbidden` | missing/invalid Tailscale login or Funnel marker; confirm the request goes through Serve and the login is allowed |
| `403 bad_origin` | browser Origin/forwarded host/fetch metadata did not match the canonical Serve origin, or a Serve handler was added beside tether |
| `403 node_refused` | the node is tagged, shared, a subnet router, the box itself, or has a login mismatch; use another node |
| `401 not_enrolled`, or a socket closes with 4401 | enroll this node from its browser/PWA using `tether enroll`, or remove-and-re-enroll it |
| `401 auth_required`, or the native socket closes with 4401 | token is missing or its device was removed; enrol the native app again |
| `503 identity_unavailable` | LocalAPI whois or tailnet state is unavailable; tether retries and never interprets a failed lookup as “not enrolled” |
| `503 auth_unavailable`, or the native socket closes with 4503 | `auth.toml` can't be read, usually a typo from a hand edit; the log names the line. Fix it: native keeps its token and retries |
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
