# tether

A phone-first client for the tmux sessions on a dev server, reached only over a
Tailscale tailnet. A small Rust daemon on the server talks to tmux through control
mode; the phone runs an installable web app with session tabs, a terminal keyboard
built for coding agents, cheap reconnects on bad connections, and a file manager.

Status: scaffold only. The design is in [docs/design/plan.md](docs/design/plan.md),
with a review in [docs/design/plan-review.md](docs/design/plan-review.md).

## Install

Download a binary from [Releases](https://github.com/haowjy/tether/releases)
(static Linux x86_64 and aarch64, macOS arm64) and check it against `SHA256SUMS`:

```bash
curl -fsSLO https://github.com/haowjy/tether/releases/latest/download/tether-linux-x64
curl -fsSLO https://github.com/haowjy/tether/releases/latest/download/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
install -m 755 tether-linux-x64 ~/.local/bin/tether
```

Prereleases (`vX.Y.Z-rc.N`) are not "latest"; pick them from the Releases page.
