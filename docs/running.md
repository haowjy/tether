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

[tmux]
program = "tmux"         # an absolute path if the unit's PATH doesn't find it
# socket_name = "work"   # tmux -L work
# socket_path = "/run/user/1000/tmux/default"   # tmux -S <path>; not both
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
