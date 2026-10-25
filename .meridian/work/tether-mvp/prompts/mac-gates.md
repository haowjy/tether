# Run the Mac front's real gates (M0–M8) on this Mac

Run the probe gates in `docs/design/auth.md` (the table under "Probe gates", rows M0–M8) against the real Tailscale app on this Mac, jimmys-macbook-air: Tailscale 1.104.2 Standalone, tailnet name jimmys-macbook-air.tail852a76.ts.net. Setup is described in `docs/running.md`, "Host on a Mac". The design is in auth.md, "The Mac front".

## Setup
- `cargo install --path .` from `/Users/jimmyyao/repos/tether`.
- Install `contrib/com.jimmyyao.tether.plist` into `~/Library/LaunchAgents`, then `launchctl bootstrap gui/$(id -u)`. No sudo.
- For tmux, use an isolated server: `[tmux] socket_name = "tether-gate"` in tether's config (`src/config.rs`). If a tether config already exists, back it up and restore it at the end. **Never attach to, list or kill Jimmy's personal tmux sessions or the default server.** If tether can only use the default server, stop and report instead.

## Constraints
- Don't change the existing Serve config beyond what tether itself publishes. Record the starting config (`tailscale serve status --json`) first. At the end, restore it exactly, then boot out and remove the LaunchAgent.
- Don't run `tailscale bugreport`: it uploads.
- Don't paste the path secret into reports or the work dir. Refer to it as `<secret>`.
- Phone-only steps can't be done by you: M6's iPhone app and Safari parts. Do everything a tailnet client can do from this Mac with curl through `https://jimmys-macbook-air.tail852a76.ts.net`. List what is left for Jimmy.
- Logout/login (M4's Login Items toggle, the logged-out state): do only what you can without logging out, and list the rest.
- CPU: Jimmy's box is busy. No load floods.

## Report
- Per gate: pass, fail or not run, with the command and an excerpt of the evidence.
- Bugs found, with a repro.
- Write the evidence to `.meridian/work/tether-mvp/evidence/mac-gates/README.md`, as excerpts, not raw dumps.
- Edit no source.

## Rerun (after the status ID fix)
The first run (p188) failed at M0 because tether read `Self.StableID` from status; Tailscale names that field `ID`. This was fixed in the commit "Read the host's stable node ID from status's ID field". Rerun every gate, reinstalling first with `cargo install --path .`. The p188 evidence is in `.meridian/work/tether-mvp/evidence/mac-gates/README.md`; update that file in place.
