# Design `tether setup`

Jimmy wants one command that installs tether as a background service, publishes it on his tailnet, and prints a link to open on his phone. Requested in his words: "why isn't there just a single executable to run it as a background service itself... and to immediately publish to tailnet... and copy the link". He picked the name `tether setup`. Design it; don't build it.

## Read first
- `AGENTS.md`
- `docs/design/plan.md`: product spec, principles, "Code structure and standards"
- `docs/design/auth.md`: fronts, Serve, the canonical origin, `tether enroll`, gates
- `docs/running.md`: today's manual steps on Linux (systemd user unit and `sudo tailscale serve`) and on a Mac (LaunchAgent, `--publish`)
- `docs/design/decisions.md`: the Mac front entries, "tether never removes its Serve entry", "`tether serve` is Linux-only for now" (check whether it's stale)
- Code: `src/main.rs` (CLI), `src/auth/publish.rs` (the Mac's edit-then-judge Serve write), `src/auth/identity.rs` (`ServeTarget`, `canonical_origin`), `src/auth/localapi.rs`, `contrib/tether.service`, `contrib/com.jimmyyao.tether.plist`
- `.meridian/work/tether-mvp/setup-operator-research.md`: whether a Linux user can write Serve config without root. Short answer: yes, if they are Tailscale's operator. Newer Tailscale (main) also requires a `unix:` target's operator to be a sudoer (`IsLocalAdmin`), and refuses with 401. A non-operator gets 403 `serve config denied`.

## Settled
- One source for the service definitions: setup installs what `contrib/` holds (embedded), not a second copy.
- The resource limits in the unit stay exactly as they are.
- tether stays single-user (Jimmy's devices only). Sharing with other people is out of scope.
- Commits go straight to `main`. Specs state the current rule only. Log each decision, with the alternatives rejected, in `decisions.md`.

## Decide and justify
- **Linux publication.**
  - Options: (a) the one-time `sudo tailscale set --operator=$USER`, then setup writes Serve via LocalAPI using the existing plan/judge code generalised to `ServeTarget::Unix`; (b) setup runs `sudo tailscale serve …` itself; (c) something else.
  - Cover how setup handles 403, 401 and missing HTTPS certificates (`CertDomains` empty while connected) with an actionable message.
  - Say whether the daemon publishes at each start on Linux, or only setup writes. Weigh self-repair against a daemon that writes Tailscale config.
- **Preconditions it checks**, each with the message it prints:
  - tmux installed
  - tailscaled up and logged in
  - Tailscale version (Linux ≥ 1.94)
  - systemd user manager, and linger (`loginctl enable-linger` may need polkit)
  - the binary's real path (`current_exe`) versus `%h/.cargo/bin`
  - an existing unit or plist that differs from the shipped one
- **Idempotency.** What a rerun does, and what it reports.
- **Upgrades.** After `cargo install` of a newer tether, does setup restart the service?
- **Undo.** A teardown command, or a flag, and its name. It must remove tether's Serve entry, the unit or plist, and stop the service, without touching other Serve entries.
- **The output.** The link, a fresh enrolment code, and a terminal QR code: name the crate and its cost, or justify going without. Also: is `tether enroll` still separate, and what does a rerun print?
- **The Mac path.** Write the plist with the HOME and PATH substitution `running.md` describes, bootstrap or kickstart it, wait for publication, then print. Reuse what exists.
- **Structure.** Where the code lives (a module per platform installer, sans-IO planning where it pays) and how it's tested.
- **Real-system gates.** Probes to run on pop-os, on the Mac, and on a Linux container if useful.

## Deliverables
- A new spec, `docs/design/setup.md`, linked from `plan.md`'s subsystem index.
- Updates to `running.md`, so setup is the primary path and the manual steps follow as the fallback.
- `decisions.md` entries.
- Your recommendation, and the open questions for Jimmy, if any.
- Get your own review of the design, structure plus a cold reader, before returning.
- Don't write source code. Don't commit; the lead commits.
