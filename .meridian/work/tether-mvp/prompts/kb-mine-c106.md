Mine chat c106 (the tether-mvp lead session; spans compaction segments, use `--segment` / `--global`) and, where it points you, its spawns p107–p163. Return facts only, with message/segment refs and verbatim quotes. Edit nothing.

I need two things:

1. **Every time Jimmy (the human) corrected an agent** — pushback, repeating an ignored instruction, undoing/redirecting work, or stating a rule because an agent broke it. Also every time the lead itself found a spawned agent violated its brief (known example: spawned coders committing although told "don't commit" — find each occurrence, the spawn id, and what the brief said). For each: session ref + message, date, the quote, what the agent did wrong, what was wanted.

2. **Environment / tooling lessons a future agent on tether must know**, with the evidence: e.g. Docker container CPU ("container cpu usage is through the roof... on docker" — what was running, what was done about it); Docker builds needing node_modules installed inside the container (what broke — host macOS node_modules bind-mounted?); iOS Simulator limits from the agent shell (no software keyboard, simctl can't tap/type, how screenshots/driving were done instead); macOS Tailscale app lacking LocalAPI; TMPDIR=/tmp/tether-meridian-501 for spawns (socket path length); tmux 3.4 subscription crash (who hit it — did it kill Jimmy's real tmux?); pop-os ssh host key blocker; anything else that cost a lane time (sandbox, signing, Xcode, pnpm, playwright, ports).

Also note any decision Jimmy made in c106 that you cannot find reflected in docs/design/decisions.md (grep it), with his words and hedges.
