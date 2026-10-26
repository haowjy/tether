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

## Build from source

The web UI is compiled into the binary, so a change under `web/` needs this too:

```bash
git pull
cargo install --path . --locked --force
tether setup --background
```

`cargo install` replaces `~/.cargo/bin/tether` but leaves a running daemon on the old
build; `tether setup --background` restarts it and prints a fresh enrolment code. (On
Linux, plain `tether setup` runs it in the foreground; macOS refuses that in favour of
`--background`.)

`scripts/preflight.sh full` is the gate before pushing: fmt, clippy with warnings denied,
tests, the release build and the web checks.
