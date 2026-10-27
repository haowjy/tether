# Read-only: how portless and tether's Tailscale Serve share pop-os

On Jimmy's Linux dev box (reach it with `ssh homebox`), port 443 on the tailnet
addresses (100.95.150.35, fd7a:...:969a on `tailscale0`) is held by tailscaled for
Tailscale Serve, which proxies `https://pop-os.tail852a76.ts.net` to tether's unix socket
`/run/user/1000/tether/serve.sock` (set up by `tether setup`). Jimmy also runs
"portless" (a local dev proxy giving `*.localhost` URLs) there and says it works now.

**Strictly read-only. Change nothing on homebox**: no installs, restarts, config edits,
`tailscale serve` changes, binding test sockets, or typing into tmux sessions. Use only
inspection commands (`ss -ltnp`, `ps`, `which`, `--version`/`--help`, reading config
files, `systemctl --user status`, `tailscale serve status`, `cat /etc/hosts`,
`journalctl --user` read). `sudo -n` only if it works non-interactively; never prompt.

Report: what portless binary/version is installed and how it is started (service,
shell, tmux); every socket it listens on (address, port); whether anything else holds
80/443 on any address; any portless config or state (`~/.portless` or similar) and what
it says about ports/TLS; `/etc/hosts` entries it added; and whether the two currently
overlap on any address:port. Quote command output excerpts. Note anything that suggests
a past conflict (logs mentioning EADDRINUSE, 443).
