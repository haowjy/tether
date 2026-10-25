# Knowledge capture: tether setup and teardown

Repo /Users/jimmyyao/repos/tether, pushed to main as f86c943..e42cbe4. KB: `meridian context kb`.
What landed: `tether setup` (foreground on Linux by default; `--background` installs the systemd
user service or Mac LaunchAgent; Mac refuses the foreground) and `tether teardown`, with the
daemon assembly moved into src/daemon.rs (`open` then `run`).

Already updated in the repo (don't duplicate; link): docs/design/setup.md, docs/design/auth.md,
docs/design/decisions.md (## tether setup), docs/running.md, CHANGELOG, src/setup/AGENTS.md,
src/auth/AGENTS.md, .meridian/work/tether-mvp/device-guide.md.

Sources: work log .meridian/work/tether-mvp/mac-front-implementation.md (2026-10-24 onward),
setup-foreground-spec.md, setup-operator-research.md, evidence/setup-s9/README.md, review reports
/Users/jimmyyao/.meridian/projects/steep-lamp-cloud/spawns/p196,p197,p200,p201,p203/report.md.

Jimmy's own words and decisions, verbatim with hedges:
- Asked for one command that runs tether as a background service, publishes it, prints the link;
  named it `tether setup`; "yes, design and develop tether setup".
- "1. but forgroudn default with --backgroud" (foreground default, `--background` for the service).
- On the Mac's Tailscale log upload: chose "Keep app, accept log".

Cross-cutting lessons worth a KB home if not already there:
- tailscaled's stored shapes differ from what a client may write: `WebServerConfig` keeps only
  `Handlers` (an `HTTPS` field on a Web entry is silently dropped, which broke rerun idempotence);
  LocalAPI status names Self's stable ID `ID`, whois's tailcfg.Node `StableID`. Fixtures must use
  the stored shape.
- Tailscale 1.100+ requires an operator to be sudo-capable (`IsLocalAdmin`) to write a Serve config
  that serves any Unix socket or path (401); a non-operator gets 403 "serve config denied".
- Current macOS `launchctl print-disabled` prints `=> disabled|enabled`, not `true|false`.
- Autosquashed fixups can leave an intermediate commit failing clippy even when the tip passes;
  per-commit preflight caught it.

Return what you updated, or that nothing needed adding, plus contradictions and gaps.
