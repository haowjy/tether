# browser-auth: edits other drafts need (revision 5)

browser-auth.md revision 5 keeps the daemon on Unix sockets, but splits the one
`http.sock` into two fronts (`serve.sock` for tailscaled, `local.sock` for the dev
proxy and tests), chooses the lane by the socket instead of the peer's uid, adds a
lock file and moves pastes to `paste/`. These lines in sibling drafts in this
directory go stale. They were left unedited, because each draft has its own owner;
the build that lands them should carry these changes.

Revision 4's list for resource-limits.md (backlog, shell deadline, pass rule, whois
row, units, accept loop, R3 wording) is done in resource-limits revision 2 and is
dropped from here.

## resource-limits.md (revision 2)

| Line | Now | Becomes |
|---|---|---|
| 101, 634, 655 | "the Unix socket" | "the Unix sockets" (`serve.sock`, `local.sock`) |
| 201, limits table, connection permits | "`somaxconn` on the Unix socket†" | "`somaxconn` on each Unix socket†"; both share the 64 permits |
| 236 and 680, whois route cap | "16 waiting" | "16 distinct addresses waiting; a request joining an in-flight or queued call takes no slot" (review 4 L1) |
| 267, ceiling table | "whois†: an answer and its parse — 2 in flight × (64 KiB + parse) — 0.2" | "LocalAPI answers†: 2 whois + 1 tailnet-state read, each 64 KiB + parse — 0.3"; the ceilings rise by about 0.1 MiB |
| 696, §3.7 accept loop | "accepts on the daemon's Unix socket, `$XDG_RUNTIME_DIR/tether/http.sock`" | "accepts on the daemon's two Unix sockets, `serve.sock` and `local.sock` in `$XDG_RUNTIME_DIR/tether/`"; `serve.sock` closes a connection from any uid but tailscaled's at accept |
| 709–710, §3.7 | "the `SO_PEERCRED` peer class (tailscaled peer or local peer)†" | "the front (`Front::Serve` or `Front::Local`)†" |
| 906, disposition | "`SO_PEERCRED` peer class" | "front" |
| "Still open", browser auth's startup refusals | open | answered: the runtime directory's refusals (no `XDG_RUNTIME_DIR` on Linux; wrong owner, mode or type) exit 78; "already running" (the lock is held) exits 1; Funnel is no longer a startup refusal |
| §3.4 running.md, §3.6 CHANGELOG bullet | TCP publication | add browser-auth §5 "running.md": the `sudo tailscale serve … unix:…/serve.sock` command, the upgrade from loopback TCP, and that every later `tailscale serve` change needs sudo |

## Elsewhere in the work item

- `checkpoint.md`: the open auth question moves to "node-identity draft rev 5: D1–D3
  settled by the tech lead (Unix sockets, Tailscale ≥ 1.100, sudo for serve
  changes); awaiting review round 5".
- Any implementation plan step that builds `__Host-tether`, sibling detection,
  `browser_origin`, or the `/auth/browser/*` routes is replaced by `/auth/node/*` and
  the steps in browser-auth.md §3.
