# browser-auth: edits other drafts need (revision 6)

browser-auth.md revision 6 keeps the daemon on two Unix sockets (`serve.sock` for
Serve's HTTP proxy, `local.sock` for the dev proxy and tests), chooses the lane by the
socket, holds a lock file and keeps pastes in `paste/`. It checks no peer uid on
either socket: `serve.sock` is trusted because the serve config must name it exactly
once, as tether's HTTPS entry. The minimum Tailscale is 1.94, and the daemon starts
without LocalAPI. These lines in sibling drafts in this directory go stale. They were
left unedited, because each draft has its own owner; the build that lands them should
carry these changes.

## resource-limits.md (revision 2)

| Line | Now | Becomes |
|---|---|---|
| 101, 634, 655 | "the Unix socket" | "the Unix sockets" (`serve.sock`, `local.sock`) |
| 201, limits table, connection permits | "`somaxconn` on the Unix socket†" | "`somaxconn` on each Unix socket†"; both share the 64 permits |
| 236 and 680, whois route cap | "16 waiting" | "16 distinct addresses waiting; a request joining an in-flight or queued call takes no slot" (review 4 L1) |
| 267, ceiling table | "whois†: an answer and its parse — 2 in flight × (64 KiB + parse) — 0.2" | "LocalAPI answers†: 2 whois + 1 tailnet-state read, each 64 KiB + parse — 0.3"; the ceilings rise by about 0.1 MiB |
| 696, §3.7 accept loop | "accepts on the daemon's Unix socket, `$XDG_RUNTIME_DIR/tether/http.sock`" | "accepts on the daemon's two Unix sockets, `serve.sock` and `local.sock` in `$XDG_RUNTIME_DIR/tether/`"; no uid check at accept |
| 709–710, §3.7 | "the `SO_PEERCRED` peer class (tailscaled peer or local peer)†" | "the front (`Front::Serve` or `Front::Local`)†" |
| 906, disposition | "`SO_PEERCRED` peer class" | "front" |
| "Still open", browser auth's startup refusals | open | answered: the runtime directory's refusals (no `XDG_RUNTIME_DIR` on Linux; wrong owner, mode or type) exit 78; "already running" (the lock is held) exits 1; Funnel is no longer a startup refusal; a LocalAPI failure at startup is no longer an exit |
| §3.4 running.md, §3.6 CHANGELOG bullet | TCP publication | add browser-auth §5 "running.md": the `sudo tailscale serve … unix:…/serve.sock` command, Tailscale 1.94 or later, sudo for every later `tailscale serve` change on 1.100 and later, and the one-command upgrade from loopback TCP |

## client-architecture.md

| Line | Now | Becomes |
|---|---|---|
| 321 and 325, table caption and `originRefused` row | "auth rev 4 §3.8"; `browserRefused: <reason>` → "why browsers can't use this host (`ambiguous_origin`, `not_https`…), with the `tether` command that fixes it" | browser-auth §3.7 and §3.9; `browserRefused` is one message that names the offending Serve entry or reference and carries the `sudo tailscale serve` command that fixes it. There are no reason codes; the client shows the message as given |
| 715–726, §5.11 | "follows auth rev 4's 'Dev mode'"; "connects to the daemon's socket as a local peer"; "refuses callers that did not come through Serve (rev 4's L5)" | follows browser-auth §2 "Next to D1": the proxy connects to `local.sock` and presents a native token; it listens on a Unix socket in a `0700` directory, published with `sudo tailscale serve --bg --https=8443 unix:<socket>`, and forwards Serve's `Tailscale-User-Login`. A login-header check on a TCP port is not a defence, because any local process can write the header |
| 166, `vite.config.ts` row | "the dev proxy of §5.11" | unchanged, but the dev server now runs Vite in middleware mode behind a Node `server.listen(path)`; the file that starts it sits beside `vite.config.ts` |

## Elsewhere in the work item

- `checkpoint.md`: the open auth question moves to "node-identity draft rev 6:
  review 5 (approve with notes) applied; D1–D5 settled; Unix sockets, Tailscale ≥
  1.94, sudo for serve changes on 1.100 and later; ready to land in the specs".
- Any implementation plan step that builds `__Host-tether`, sibling detection,
  `browser_origin`, the `/auth/browser/*` routes, a `SO_PEERCRED` uid check or a
  Tailscale version check is replaced by `/auth/node/*` and the steps in
  browser-auth.md §3.
