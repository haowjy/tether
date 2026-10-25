# Trying tether on your iPhone

Everything a computer can check has passed (P5 gate, `evidence/p5-gate/README.md`).
What's left needs your hands: a real tailnet host and your iPhone. Three parts, in order.

## 1. Pick a host

**This Mac (quickest, no ssh).** On this Mac, from the repo:

```bash
git pull && pnpm --dir web install && cargo install --path .
sed -e "s|@HOME@|$HOME|g" -e "s|@PATH@|$PATH|g" contrib/com.jimmyyao.tether.plist \
  > ~/Library/LaunchAgents/com.jimmyyao.tether.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jimmyyao.tether.plist
tether enroll        # prints a one-time code (10 minutes) and the browser URL
```

No sudo is needed. tether publishes itself at `https://jimmys-macbook-air.tail852a76.ts.net`.
The automated checks of the Mac front passed (`evidence/mac-gates/README.md`). The phone
only reaches it while you're logged in to the Mac. To stop it, see `docs/running.md`, "Host on a Mac".

**Or pop-os.** First, on the Mac, run `ssh pop-os` once and accept the host key; after that
I can do the build and the systemd setup. Only the `sudo` line has to be yours. To do it all
yourself, on pop-os:

```bash
cd ~/gitrepos/tether && git pull && pnpm --dir web install && cargo install --path .
mkdir -p ~/.config/systemd/user && cp contrib/tether.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now tether
loginctl enable-linger "$USER"
sudo tailscale serve --bg --https=443 unix:/run/user/$(id -u)/tether/serve.sock
tether enroll
```

`tmux -V` on pop-os decides which tmux the fix in 8db5622 protects. Tell me the version.

## 2. Phone browser checks

Open the URL `tether enroll` printed in Safari on the iPhone and enrol with the code.
Then work through `g3-iphone-checklist.md` items 1–29:

- 1–17: the dock, line field, switcher, and window sizing next to the laptop
- 18–29: touch gestures

Use a scratch session for anything destructive. Note pass or fail per item, and add a
sentence when something feels off. Feel is the point of these items.

## 3. The iOS app

On the Mac:

```bash
cd ios && xcodegen && open Tether.xcodeproj
```

In Xcode, select the Tether target, then Signing & Capabilities, and pick your team.
Select your iPhone ("Hao do you do?") and press Run. Developer Mode must be on, and the
free team's profile lasts 7 days.

In the app, Add a server takes the host's name and a fresh `tether enroll` code. Then run:

- `g3-iphone-checklist.md` items 30–31
- the table in `docs/design/ios-shell.md`, "Device checklist": keyboard restore,
  line-field lending, hardware keys, paste, Keychain prompts, latency under a flood

## Still open after that

- Auth gates G1–G12 (`docs/design/auth.md`, "Probe gates") run on pop-os over the
  tailnet. I can drive most of them once ssh works.
- On a Mac host, the hand-only Mac checks (`evidence/mac-gates/README.md`, "Still needs"):
  - enrol the phone and hold a terminal open for 10 minutes (M6)
  - log out and back in, then confirm tether comes back (M0)
  - quit and reopen Tailscale with a tab open, then confirm it reconnects (M5)
- Claude Code and Codex submitting on paste+Enter (checklist item 10).
